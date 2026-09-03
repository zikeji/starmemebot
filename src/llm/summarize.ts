import type { Client } from 'discord.js';
import { loadConfig } from '../config.js';
import { createLogger } from '../logger.js';
import { buildUserContent, complete, MAX_TOOL_ROUNDS, type ChatMessage } from './completion.js';
import { SUMMARY_SYSTEM_PROMPT } from './prompts.js';
import { executeToolCall, TOOL_DEFINITIONS, type ToolContext } from './tools.js';

const log = createLogger('llm:summarize');

const SUMMARY_TIMEOUT_MS = 120_000;
// Reasoning models burn output tokens on hidden reasoning before content,
// so this needs generous headroom over the visible summary length.
const SUMMARY_MAX_TOKENS = 3000;
const SUMMARY_MAX_TOKENS_CEILING = 8000;

export async function summarizeChannel(
  channelName: string,
  chatContext: string,
  images: string[],
  client: Client,
  viewer: { guildId: string; userId: string },
): Promise<string> {
  const { openaiEndpoint, openaiApiKey, openaiModel } = loadConfig();
  const userText = `Channel: #${channelName}\n\nConversation:\n${chatContext}\n\nTask: summarize this conversation.`;
  const messages: ChatMessage[] = [
    { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
    { role: 'user', content: buildUserContent(userText, images) },
  ];
  const readMessagesDef = TOOL_DEFINITIONS.find((t) => t.function.name === 'read_messages');
  if (!readMessagesDef) throw new Error('read_messages tool definition missing');
  const tools = [readMessagesDef];
  const toolCtx: ToolContext = { client, guildId: viewer.guildId, viewerId: viewer.userId };
  // Reasoning-heavy models can exhaust the output budget before writing visible content
  // (finish_reason "length", empty content); steer reasoning to low and retry with a
  // doubled budget if it still runs out.
  let maxTokens = SUMMARY_MAX_TOKENS;
  const completeOpts = () => ({
    timeoutMs: SUMMARY_TIMEOUT_MS,
    maxTokens,
    reasoning: { effort: 'low', exclude: true },
  });

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    let data;
    try {
      data = await complete(openaiEndpoint, openaiApiKey, openaiModel, messages, tools, completeOpts());
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (images.length > 0 && typeof status === 'number' && status < 500) {
        log.warn({ err }, 'Model rejected image input; retrying summary without attachments');
        images.length = 0;
        messages[1] = { role: 'user', content: buildUserContent(userText, []) };
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
        log.error(
          {
            finishReason: choice.finish_reason,
            hasToolCalls: Boolean(toolCalls?.length),
            contentLength: assistant.content?.length ?? 0,
            round: round + 1,
            maxTokens,
          },
          'Summarizer returned empty content',
        );
        if (choice.finish_reason === 'length' && maxTokens < SUMMARY_MAX_TOKENS_CEILING) {
          maxTokens = Math.min(maxTokens * 2, SUMMARY_MAX_TOKENS_CEILING);
          log.warn({ maxTokens }, 'Retrying summary with a larger output budget');
          round -= 1;
          continue;
        }
        throw new Error('Empty response from model');
      }
      if (round > 0) log.info({ rounds: round + 1 }, 'Summary produced after tool use');
      return text;
    }

    log.info(
      { round: round + 1, calls: toolCalls.map((c) => ({ tool: c.function.name, args: c.function.arguments })) },
      'Summarizer requested tool calls',
    );
    messages.push(assistant);
    for (const call of toolCalls) {
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(call.function.arguments);
      } catch {
        messages.push({ role: 'tool', tool_call_id: call.id, content: 'Error: invalid JSON arguments.' });
        continue;
      }
      const result = await executeToolCall(toolCtx, call.function.name, args);
      log.info({ tool: call.function.name, resultPreview: result.slice(0, 200) }, 'Tool result returned to summarizer');
      messages.push({ role: 'tool', tool_call_id: call.id, content: result });
    }
  }
  throw new Error('Unreachable');
}
