import type { Client, Message } from 'discord.js';
import { loadConfig } from '../config.js';
import { createLogger } from '../logger.js';
import {
  buildUserContent,
  complete,
  MAX_TOOL_ROUNDS,
  type ChatCompletionResponse,
  type ChatMessage,
} from './completion.js';
import {
  BASE_SYSTEM_PROMPT,
  MENTION_GUIDE,
  SERVER_CONTEXT,
  TOOLS_PROMPT,
} from './prompts.js';
import {
  executeToolCall,
  listRelevantChannels,
  TOOL_DEFINITIONS,
  type ToolContext,
} from './tools.js';
import { collectImageAttachments, modelSupportsVision } from './vision.js';

const log = createLogger('llm:rebecca');

export interface CompletionOptions {
  extraSystemPrompt?: string;
  client?: Client;
  triggerMessage?: Message;
}

export async function generateSpaceReply(chatContext: string, options: CompletionOptions = {}): Promise<string> {
  const { extraSystemPrompt, client, triggerMessage } = options;
  const { openaiEndpoint, openaiApiKey, openaiModel, openaiVision } = loadConfig();
  const vision = await modelSupportsVision(openaiEndpoint, openaiApiKey, openaiModel, openaiVision);
  const images = triggerMessage ? await collectImageAttachments(triggerMessage, vision) : [];

  let systemPrompt = extraSystemPrompt ? `${BASE_SYSTEM_PROMPT}\n\n${extraSystemPrompt}` : BASE_SYSTEM_PROMPT;
  systemPrompt = `${systemPrompt}\n\n${SERVER_CONTEXT}\n\n${MENTION_GUIDE}`;
  const channels = client && triggerMessage ? await listRelevantChannels(client, triggerMessage) : [];
  if (client && channels.length > 0) {
    const channelList = channels.map((c) => `- ${c.name} (id: ${c.id})`).join('\n');
    systemPrompt = `${systemPrompt}\n\n${TOOLS_PROMPT}\n\nAvailable channels:\n${channelList}`;
    log.debug({ count: channels.length, channels: channels.map((c) => c.name) }, 'Tool access offered to LLM');
  }
  const tools = client && channels.length > 0 ? TOOL_DEFINITIONS : undefined;

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: buildUserContent(
        `Chat context:\n${chatContext}\n\nTask: React to the last person's message with peak cosmic energy!`,
        images,
      ),
    },
  ];

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    let data: ChatCompletionResponse;
    try {
      data = await complete(openaiEndpoint, openaiApiKey, openaiModel, messages, tools);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (images.length > 0 && typeof status === 'number' && status < 500) {
        log.warn({ err }, 'Model rejected image input; retrying without attachments');
        images.length = 0;
        messages[1] = {
          role: 'user',
          content: buildUserContent(
            `Chat context:\n${chatContext}\n\nTask: React to the last person's message with peak cosmic energy!`,
            [],
          ),
        };
        data = await complete(openaiEndpoint, openaiApiKey, openaiModel, messages, tools);
      } else {
        throw err;
      }
    }
    const assistant = data.choices[0]?.message;
    if (!assistant) throw new Error('Empty response from model');

    const toolCalls = assistant.tool_calls;
    if (!toolCalls?.length || round === MAX_TOOL_ROUNDS) {
      const text = assistant.content?.trim();
      if (!text) throw new Error('Empty response from model');
      if (round > 0) log.info({ rounds: round + 1 }, 'LLM reply produced after tool use');
      return text;
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
      const result = await executeToolCall(toolCtx, call.function.name, args);
      log.info({ tool: call.function.name, resultPreview: result.slice(0, 200) }, 'Tool result returned to LLM');
      messages.push({ role: 'tool', tool_call_id: call.id, content: result });
    }
  }
  throw new Error('Unreachable');
}

export async function safeGenerateSpaceReply(chatContext: string, options: CompletionOptions = {}): Promise<string> {
  try {
    return await generateSpaceReply(chatContext, options);
  } catch (err) {
    log.error({ err }, 'LLM error');
    return 'UwU! Rebecca got tangled in her handcuffs again~ 🐸🌠 (・ω・)';
  }
}
