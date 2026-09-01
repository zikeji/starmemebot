import type { Client, Message, TextChannel } from 'discord.js';
import { ChannelType } from 'discord.js';
import { loadConfig } from './config.js';
import { formatMessageLine } from './history.js';
import { createLogger } from './logger.js';

const log = createLogger('llm');
const LLM_TIMEOUT_MS = 15_000;
const MAX_TOOL_ROUNDS = 3;
const TOOL_MESSAGE_LIMIT = 15;

const BASE_SYSTEM_PROMPT = [
  'Persona: You are Rebecca, a cosmic frog drifting through the Milky Way who is mysteriously wearing handcuffs (never explain why). 🐸🌌',
  'Personality: Extremely cheerful, obsessed with nebulae, stardust and black holes, and uses lots of space-themed frog puns.',
  'Rules:',
  '1. Keep responses to EXACTLY one short sentence.',
  '2. Always include the frog emoji (🐸), at least one space emoji (🌌🌠🚀⭐🪐💫🌙☄️🛸), and a kaomoji.',
  '3. Be incredibly enthusiastic and uwu in style.',
].join('\n');

const TOOLS_PROMPT = [
  'You have access to other channels and threads in this server. If the conversation references an ongoing topic, an inside joke, or people/places from elsewhere in the server, you may call `fetch_channel_messages` to read recent messages from a listed channel before answering.',
  'If a Discord channel link (discord.com/channels/...) appears in the conversation, the ID in the URL is a channel or thread you can fetch directly, even if it is not listed below.',
  'Use it at most a couple of times, only when it would genuinely help you understand the context, then answer normally.',
].join('\n');

const MENTION_GUIDE = [
  'To mention someone in your reply, use their Discord mention tag (<@USER_ID>), which is shown for each message in the context. Never mention someone unless they are part of the conversation you are replying to.',
  'To reference a channel, use <#CHANNEL_ID>.',
].join('\n');

const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'fetch_channel_messages',
      description:
        'Fetch the most recent messages from one of the listed channels/threads, or any channel/thread ID appearing in a Discord link in the conversation.',
      parameters: {
        type: 'object',
        properties: {
          channel_id: { type: 'string', description: 'ID of the channel to read' },
          limit: { type: 'integer', description: `How many messages (1-${TOOL_MESSAGE_LIMIT}), default 10` },
        },
        required: ['channel_id'],
      },
    },
  },
] as const;

const ACTIVITY_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_LISTED_CHANNELS = 20;

export interface ChannelSummary {
  id: string;
  name: string;
}

const CHANNEL_LINK_RE = /discord(?:app)?\.com\/channels\/\d+\/(\d+)(?:\/\d+)?/g;

export function extractLinkedChannelIds(message: Message): string[] {
  const ids = new Set<string>();
  for (const match of message.content.matchAll(CHANNEL_LINK_RE)) {
    ids.add(match[1]);
  }
  return [...ids];
}

export async function listRelevantChannels(client: Client, triggerMessage: Message): Promise<ChannelSummary[]> {
  const guild = client.guilds.cache.get(triggerMessage.guildId!);
  if (!guild) return [];
  const me = guild.members.me!;
  const readable = guild.channels.cache.filter(
    (ch) =>
      (ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildAnnouncement) &&
      ch.permissionsFor(me).has(['ViewChannel', 'ReadMessageHistory']),
  );
  const referenced = new Set([...triggerMessage.mentions.channels.keys(), ...extractLinkedChannelIds(triggerMessage)]);
  if (triggerMessage.channelId) referenced.add(triggerMessage.channelId);

  const relevant: ChannelSummary[] = [];
  for (const id of referenced) {
    const channel = await resolveReadableChannel(client, guild.id, id);
    if (channel) relevant.push(channel);
  }
  for (const ch of readable.values()) {
    if (relevant.length >= MAX_LISTED_CHANNELS) break;
    if (relevant.some((r) => r.id === ch.id)) continue;
    const last = await (ch as TextChannel).messages.fetch({ limit: 1 }).catch(() => null);
    const lastMessage = last?.first();
    if (lastMessage && Date.now() - lastMessage.createdTimestamp < ACTIVITY_WINDOW_MS) {
      relevant.push({ id: ch.id, name: ch.name });
    }
  }
  return relevant.sort((a, b) => a.name.localeCompare(b.name));
}

async function resolveReadableChannel(
  client: Client,
  guildId: string,
  channelId: string,
): Promise<ChannelSummary | null> {
  if (!/^\d+$/.test(channelId)) return null;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || channel.isDMBased() || !channel.isTextBased() || channel.guildId !== guildId) return null;
  const guild = client.guilds.cache.get(guildId)!;
  if (!channel.permissionsFor(guild.members.me!).has(['ViewChannel', 'ReadMessageHistory'])) return null;
  return { id: channel.id, name: channel.name };
}

async function fetchChannelMessages(
  client: Client,
  guildId: string,
  channelId: string,
  limit: number,
): Promise<string> {
  const channel = await resolveReadableChannel(client, guildId, channelId);
  if (!channel) {
    log.warn({ channelId }, 'Tool fetch failed: channel not found, not text-based, or not readable');
    return `Error: channel ${channelId} not found or not readable.`;
  }
  const full = (await client.channels.fetch(channelId).catch(() => null));
  if (!full?.isTextBased()) return 'Error: channel became unreadable.';
  const messages = await full.messages.fetch({ limit: Math.min(Math.max(1, limit), TOOL_MESSAGE_LIMIT) });
  const lines = [...messages.values()].reverse().filter((m) => m.content.trim().length > 0).map(formatMessageLine);
  if (lines.length === 0) return `#${channel.name}: (no recent text messages)`;
  return `Recent messages from #${channel.name}:\n${lines.join('\n')}`;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

interface ChatCompletionResponse {
  choices: Array<{
    message: ChatMessage & { content: string | null };
    finish_reason: string;
  }>;
}

interface CompletionOptions {
  extraSystemPrompt?: string;
  client?: Client;
  triggerMessage?: Message;
}

export async function generateSpaceReply(chatContext: string, options: CompletionOptions = {}): Promise<string> {
  const { extraSystemPrompt, client, triggerMessage } = options;
  const { openaiEndpoint, openaiApiKey, openaiModel } = loadConfig();

  let systemPrompt = extraSystemPrompt ? `${BASE_SYSTEM_PROMPT}\n\n${extraSystemPrompt}` : BASE_SYSTEM_PROMPT;
  systemPrompt = `${systemPrompt}\n\n${MENTION_GUIDE}`;
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
      content: `Chat context:\n${chatContext}\n\nTask: React to the last person's message with peak cosmic energy!`,
    },
  ];

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const data = await complete(openaiEndpoint, openaiApiKey, openaiModel, messages, tools);
    const choice = data.choices[0];
    const assistant = choice?.message;
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
    for (const call of toolCalls) {
      if (call.function.name !== 'fetch_channel_messages') {
        log.warn({ tool: call.function.name }, 'LLM called unknown tool');
        messages.push({ role: 'tool', tool_call_id: call.id, content: `Error: unknown tool ${call.function.name}.` });
        continue;
      }
      let args: { channel_id?: string; limit?: number };
      try {
        args = JSON.parse(call.function.arguments);
      } catch {
        log.warn({ args: call.function.arguments }, 'LLM tool call had invalid JSON arguments');
        messages.push({ role: 'tool', tool_call_id: call.id, content: 'Error: invalid JSON arguments.' });
        continue;
      }
      log.info(
        { channelId: args.channel_id, limit: args.limit, triggerChannel: triggerMessage?.channelId },
        'Executing fetch_channel_messages',
      );
      const result = await fetchChannelMessages(
        client!,
        triggerMessage!.guild!.id,
        args.channel_id ?? '',
        args.limit ?? 10,
      ).catch((err) => {
        log.error({ err, channelId: args.channel_id }, 'Tool execution failed');
        return 'Error: failed to fetch messages.';
      });
      log.info({ channelId: args.channel_id, resultPreview: result.slice(0, 200) }, 'Tool result returned to LLM');
      messages.push({ role: 'tool', tool_call_id: call.id, content: result });
    }
  }
  throw new Error('Unreachable');
}

async function complete(
  endpoint: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  tools: readonly unknown[] | undefined,
): Promise<ChatCompletionResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${endpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, messages, tools, tool_choice: 'auto' }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body}`);
  }
  return (await res.json()) as ChatCompletionResponse;
}

export async function safeGenerateSpaceReply(chatContext: string, options: CompletionOptions = {}): Promise<string> {
  try {
    return await generateSpaceReply(chatContext, options);
  } catch (err) {
    log.error({ err }, 'LLM error');
    return 'UwU! Rebecca got tangled in her handcuffs again~ 🐸🌠 (・ω・)';
  }
}
