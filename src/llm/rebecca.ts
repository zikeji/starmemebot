import type { Client, Message } from 'discord.js';
import { loadConfig } from '../config.js';
import { createLogger } from '../logger.js';
import {
  buildUserContent,
  complete,
  MAX_OUTPUT_TOKENS,
  MAX_TOOL_ROUNDS,
  type ChatCompletionResponse,
  type ChatMessage,
} from './completion.js';

// Reasoning models can eat 400 tokens on hidden thinking before writing a word.
const REBECCA_MAX_TOKENS_CEILING = 1600;
import {
  BASE_SYSTEM_PROMPT,
  MEMORY_GUIDE,
  MENTION_GUIDE,
  SERVER_CONTEXT,
  TOOLS_PROMPT,
} from './prompts.js';
import {
  executeToolCall,
  isDenylistedWithAncestors,
  listRelevantChannels,
  TOOL_DEFINITIONS,
  TOOL_SILENT,
  type ToolContext,
} from './tools.js';
import { collectImageAttachments, modelSupportsVision } from './vision.js';
import { passiveRecall } from '../memories/store.js';

const log = createLogger('llm:rebecca');

export interface CompletionOptions {
  extraSystemPrompt?: string;
  client?: Client;
  triggerMessage?: Message;
}

export type RebeccaOutcome =
  | { kind: 'reply'; text: string }
  | { kind: 'silent' };

export async function generateSpaceReply(
  chatContext: string,
  options: CompletionOptions = {},
): Promise<RebeccaOutcome> {
  const { extraSystemPrompt, client, triggerMessage } = options;
  const { openaiEndpoint, openaiApiKey, openaiModel, openaiVision } = loadConfig();
  const vision = await modelSupportsVision(openaiEndpoint, openaiApiKey, openaiModel, openaiVision);
  const images = triggerMessage ? await collectImageAttachments(triggerMessage, vision) : [];

  let systemPrompt = extraSystemPrompt ? `${BASE_SYSTEM_PROMPT}\n\n${extraSystemPrompt}` : BASE_SYSTEM_PROMPT;
  systemPrompt = `${systemPrompt}\n\n${SERVER_CONTEXT}\n\n${MENTION_GUIDE}`;
  // Offered only when the memory tools are (client + guild) so the prompt never
  // advertises capabilities missing from the tool schema (e.g. DMs).
  if (client && triggerMessage?.guild) {
    systemPrompt = `${systemPrompt}\n\n${MEMORY_GUIDE}`;
  }
  if (triggerMessage?.guild) {
    const now = new Date();
    const channelName = 'name' in triggerMessage.channel ? triggerMessage.channel.name : 'unknown';
    systemPrompt = `${systemPrompt}\n\n${[
      'Reality check:',
      `- Current date and time: ${now.toUTCString().replace('GMT', 'UTC')} (${now.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })})`,
      `- Server: ${triggerMessage.guild.name} (${triggerMessage.guild.memberCount} members)`,
      `- Channel you are replying in: #${channelName}`,
    ].join('\n')}`;
  }
  const channels = client && triggerMessage ? await listRelevantChannels(client, triggerMessage) : [];
  if (client && channels.length > 0) {
    const channelList = channels.map((c) => `- ${c.name} (id: ${c.id})`).join('\n');
    systemPrompt = `${systemPrompt}\n\n${TOOLS_PROMPT}\n\nAvailable channels:\n${channelList}`;
    log.debug({ count: channels.length, channels: channels.map((c) => c.name) }, 'Tool access offered to LLM');
  }
  // react/silent are always available; memory tools need a client+guild (their execution
  // dereferences both); the channel tools only when there is a list to advertise.
  const alwaysTools = client && triggerMessage?.guild
    ? ['react_to_message', 'stay_silent', 'search_memories', 'store_memory', 'update_memory']
    : ['react_to_message', 'stay_silent'];
  const tools = client && channels.length > 0 ? TOOL_DEFINITIONS : TOOL_DEFINITIONS.filter((t) =>
    alwaysTools.includes(t.function.name),
  );

  // Passive memory recall: free lexical hits from the trigger + recent history, injected as
  // background knowledge. Never in denylisted channels; silent when nothing scores.
  // Memory is an enhancement — any store failure here degrades to "no injection".
  if (triggerMessage?.guild && client) {
    try {
      const denylisted = !triggerMessage.channelId
        || (await isDenylistedWithAncestors(client, triggerMessage.guild.id, triggerMessage.channelId));
      if (!denylisted) {
        const query = `${triggerMessage.content}\n${chatContext.split('\n').slice(-5).join(' ')}`;
        const hits = passiveRecall(triggerMessage.guild.id, query);
        if (hits.length > 0) {
          const lines = hits.map(
            (h) => `- [${h.record.id}, ${new Date(h.record.createdAt).toISOString().slice(0, 10)}] ${h.record.text}`,
          );
          systemPrompt = `${systemPrompt}\n\nMemories that may be relevant (surfaced automatically; may be stale or wrong — use judgment, don't recite them unprompted):\n${lines.join('\n')}`;
        }
      }
    } catch (err) {
      log.warn({ err }, 'Passive memory recall skipped');
    }
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: buildUserContent(
        `Chat context:\n${chatContext}\n\nTask: Reply to the last person's message with peak cosmic energy (or react/stay silent only when that genuinely fits better)!`,
        images,
      ),
    },
  ];

  // Reasoning models can burn the output budget on hidden reasoning before content;
  // steer to low effort and retry with a doubled budget when finish_reason is "length".
  let maxTokens = MAX_OUTPUT_TOKENS;
  let reactedThisCall = false;
  // One reaction usually says it; two is theatrical; more is spam.
  const MAX_REACTIONS = 2;
  let reactions = 0;
  // store/update require a search_memories call earlier in the turn (dedup nudge).
  let memorySearchedThisTurn = false;
  const completeOpts = () => ({
    maxTokens,
    reasoning: { effort: 'low', exclude: true },
  });

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    let data: ChatCompletionResponse;
    try {
      data = await complete(openaiEndpoint, openaiApiKey, openaiModel, messages, tools, completeOpts());
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (images.length > 0 && typeof status === 'number' && status < 500) {
        log.warn({ err }, 'Model rejected image input; retrying without attachments');
        images.length = 0;
        messages[1] = {
          role: 'user',
          content: buildUserContent(
            `Chat context:\n${chatContext}\n\nTask: Reply to the last person's message with peak cosmic energy (or react/stay silent only when that genuinely fits better)!`,
            [],
          ),
        };
        data = await complete(openaiEndpoint, openaiApiKey, openaiModel, messages, tools, completeOpts());
      } else {
        throw err;
      }
    }
    const choice = data.choices[0];
    const assistant = choice?.message;
    if (!assistant) throw new Error('Empty response from model');

    const toolCalls = assistant.tool_calls;
    if (!toolCalls?.length || round === MAX_TOOL_ROUNDS) {
      const text = assistant.content?.trim();
      if (!text) {
        // React-only turn: the reaction already landed; treat missing text as silence.
        if (reactedThisCall) {
          log.info('Rebecca reacted and had nothing more to say');
          return { kind: 'silent' };
        }
        log.error(
          {
            finishReason: choice.finish_reason,
            hasToolCalls: Boolean(toolCalls?.length),
            contentLength: assistant.content?.length ?? 0,
            round: round + 1,
            maxTokens,
          },
          'Rebecca got empty content',
        );
        if (choice.finish_reason === 'length' && maxTokens < REBECCA_MAX_TOKENS_CEILING) {
          maxTokens = Math.min(maxTokens * 2, REBECCA_MAX_TOKENS_CEILING);
          log.warn({ maxTokens }, 'Retrying Rebecca reply with a larger output budget');
          round -= 1;
          continue;
        }
        throw new Error('Empty response from model');
      }
      if (round > 0) log.info({ rounds: round + 1 }, 'LLM reply produced after tool use');
      return { kind: 'reply', text };
    }

    log.info(
      {
        round: round + 1,
        calls: toolCalls.map((c) => ({ tool: c.function.name, args: c.function.arguments })),
      },
      'LLM requested tool calls',
    );
    messages.push(assistant);
    const toolCtx: ToolContext = {
      client: client!,
      guildId: triggerMessage!.guild!.id,
      viewerId: triggerMessage!.author.id,
      triggerChannelId: triggerMessage?.channelId,
      reactTarget: triggerMessage,
    };
    for (const call of toolCalls) {
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(call.function.arguments);
      } catch {
        log.warn({ tool: call.function.name, args: call.function.arguments }, 'LLM tool call had invalid JSON arguments');
        messages.push({ role: 'tool', tool_call_id: call.id, content: 'Error: invalid JSON arguments.' });
        continue;
      }
      if (call.function.name === 'react_to_message' && reactions >= MAX_REACTIONS) {
        log.info({ reactions }, 'Reaction cap reached; refusing further react_to_message calls');
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: 'Error: reaction limit reached. Reply with text or call stay_silent.',
        });
        continue;
      }
      if (
        (call.function.name === 'store_memory' || call.function.name === 'update_memory') &&
        !memorySearchedThisTurn
      ) {
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: 'Error: call search_memories first this turn to check for duplicates and find current ids.',
        });
        continue;
      }
      const result = await executeToolCall(toolCtx, call.function.name, args);
      if (result === TOOL_SILENT) {
        log.info('Rebecca chose silence');
        return { kind: 'silent' };
      }
      if (call.function.name === 'react_to_message' && !result.startsWith('Error:')) {
        reactedThisCall = true;
        reactions += 1;
      }
      if (call.function.name === 'search_memories' && !result.startsWith('Error:')) {
        memorySearchedThisTurn = true;
      }
      log.info({ tool: call.function.name, resultPreview: result.slice(0, 200) }, 'Tool result returned to LLM');
      messages.push({ role: 'tool', tool_call_id: call.id, content: result });
    }
  }
  throw new Error('Unreachable');
}

export async function safeGenerateSpaceReply(
  chatContext: string,
  options: CompletionOptions = {},
): Promise<RebeccaOutcome> {
  try {
    return await generateSpaceReply(chatContext, options);
  } catch (err) {
    log.error({ err }, 'LLM error');
    return { kind: 'reply', text: 'UwU! Rebecca got tangled in her handcuffs again~ 🐸🌠 (・ω・)' };
  }
}
