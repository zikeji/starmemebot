import type { Channel, Client, Message, TextChannel } from 'discord.js';
import { ChannelType } from 'discord.js';
import { loadConfig } from './config.js';
import { formatMessageLine } from './history.js';
import { createLogger } from './logger.js';
import { getWikiStatus, searchWiki } from './wiki/wiki.js';

const log = createLogger('llm');
const LLM_TIMEOUT_MS = 15_000;
const MAX_OUTPUT_TOKENS = 300;
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

const SERVER_CONTEXT = [
  'Context: This Discord server is built around the StarPilot project — a fork of OpenPilot, the open source ADAS (advanced driver assistance) software by comma.ai (https://comma.ai).',
  'Repos: StarPilot — https://github.com/firestar5683/StarPilot; upstream OpenPilot — https://github.com/commaai/openpilot.',
  'The primary maintainer is "firestar" (also known as "firestar4430" or "firestar5683"; Discord user id 446126627701915653, mention <@446126627701915653>) — all these names refer to the same person.',
  'Conversations may mix project talk (forks, devices, dashcams, car models) with casual memes. Whenever someone asks anything about StarPilot/OpenPilot (installing, setup, cars, hardware, features, troubleshooting), you MUST call search_wiki BEFORE replying, then point at the single most relevant section as a markdown link like [Getting Started](https://wiki.firestar.link/getting-started/) — use the exact anchored URL from the search result, including the #section part. Never paste a bare URL, and never explain the topic yourself. If nothing in the wiki fits, defer to the community or source code. Keep your reply playful.',
].join('\n');

const TOOLS_PROMPT = [
  'You have access to other channels and threads in this server. If the conversation references an ongoing topic, an inside joke, or people/places from elsewhere in the server, you may call `fetch_channel_messages` to read recent messages from a listed channel before answering.',
  'If a Discord channel link (discord.com/channels/...) appears in the conversation, the ID in the URL is a channel or thread you can fetch directly, even if it is not listed below.',
  'Use it at most a couple of times, only when it would genuinely help you understand the context, then answer normally.',
].join('\n');

const MENTION_GUIDE = [
  'To mention someone in your reply, use their Discord mention tag (<@USER_ID>), which is shown for each message in the context. Never mention someone unless they are part of the conversation you are replying to.',
  'To reference a channel, use <#CHANNEL_ID>.',
  'Discord message links look like discord.com/channels/{guildId}/{channelId}/{messageId}. If one appears in the conversation, use read_messages with around: {messageId} to see the linked message in context.',
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
  {
    type: 'function',
    function: {
      name: 'read_messages',
      description:
        'Read message history from a specific channel or thread, including attachment metadata. Supports count 1-100 and an optional cursor (before/after/around a message ID) for precise reads, e.g. around a linked message. Discord message links look like discord.com/channels/{guildId}/{channelId}/{messageId} — the middle ID is the channel and the last is the message.',
      parameters: {
        type: 'object',
        properties: {
          channel_id: { type: 'string', description: 'ID of the channel or thread to read' },
          count: { type: 'integer', description: 'How many messages (1-100), default 20' },
          before: { type: 'string', description: 'Message ID: fetch messages before this one' },
          after: { type: 'string', description: 'Message ID: fetch messages after this one' },
          around: { type: 'string', description: 'Message ID: fetch messages around this one' },
        },
        required: ['channel_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_members',
      description: 'Search server members by (partial) nickname or username, e.g. to find out who someone is.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Name or partial name to search for' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_wiki',
      description:
        'Search the StarPilot wiki (https://wiki.firestar.link/) for project documentation. You MUST call this before answering ANY question about StarPilot/OpenPilot (install, setup, cars, hardware, features, troubleshooting), even if you think you know the answer. Reply with the single most relevant page URL as a markdown link.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search keywords' },
        },
        required: ['query'],
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
  // Privacy: only channels the triggering user can ALSO view may be offered or fetched,
  // otherwise public-channel users could extract private-channel content through the LLM.
  const viewer = await guild.members.fetch(triggerMessage.author.id).catch(() => null);
  if (!viewer) return [];
  const mutuallyReadable = guild.channels.cache.filter(
    (ch) =>
      (ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildAnnouncement) &&
      ch.permissionsFor(me).has(['ViewChannel', 'ReadMessageHistory']) &&
      ch.permissionsFor(viewer).has('ViewChannel'),
  );
  const referenced = new Set([...triggerMessage.mentions.channels.keys(), ...extractLinkedChannelIds(triggerMessage)]);
  if (triggerMessage.channelId) referenced.add(triggerMessage.channelId);

  const relevant: ChannelSummary[] = [];
  for (const id of referenced) {
    if (await isDenylistedWithAncestors(client, id)) continue;
    const channel = await resolveReadableChannel(client, guild.id, id, viewer.id);
    if (channel) relevant.push(channel);
  }
  for (const ch of mutuallyReadable.values()) {
    if (relevant.length >= MAX_LISTED_CHANNELS) break;
    if (relevant.some((r) => r.id === ch.id)) continue;
    if (await isDenylistedWithAncestors(client, ch.id)) continue;
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
  viewerId: string,
): Promise<ChannelSummary | null> {
  if (!/^\d+$/.test(channelId)) return null;
  if (await isDenylistedWithAncestors(client, channelId)) return null;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || channel.isDMBased() || !channel.isTextBased() || channel.guildId !== guildId) return null;
  const guild = client.guilds.cache.get(guildId)!;
  const me = guild.members.me!;
  const viewer = guild.members.cache.get(viewerId) ?? (await guild.members.fetch(viewerId).catch(() => null));
  if (!viewer) return null;
  if (
    !channel.permissionsFor(me).has(['ViewChannel', 'ReadMessageHistory']) ||
    !channel.permissionsFor(viewer).has('ViewChannel')
  ) {
    return null;
  }
  return { id: channel.id, name: channel.name };
}

const MAX_READ_COUNT = 100;

async function readMessages(
  client: Client,
  guildId: string,
  channelId: string,
  count: number,
  cursor: { before?: string; after?: string; around?: string },
  viewerId: string,
): Promise<string> {
  const channel = await resolveReadableChannel(client, guildId, channelId, viewerId);
  if (!channel) {
    log.warn({ channelId, viewerId }, 'Tool fetch denied: channel not found or not readable by both bot and viewer');
    return 'Error: channel not found or not readable.';
  }
  const full = await client.channels.fetch(channelId).catch(() => null);
  if (!full?.isTextBased()) return 'Error: channel became unreadable.';
  const limit = Math.min(Math.max(1, count), MAX_READ_COUNT);
  const messages = await full.messages
    .fetch({ limit, before: cursor.before, after: cursor.after, around: cursor.around })
    .catch((err) => {
      log.error({ err, channelId, cursor }, 'read_messages fetch failed');
      return null;
    });
  if (!messages) return 'Error: failed to fetch messages (invalid message ID cursor?).';
  const lines = [...messages.values()].reverse().filter((m) => m.content.trim().length > 0 || m.attachments.size > 0).map(formatMessageLine);
  if (lines.length === 0) return `#${channel.name}: (no messages in range)`;
  return `Messages from #${channel.name}:\n${lines.join('\n')}`;
}

async function fetchChannelMessages(
  client: Client,
  guildId: string,
  channelId: string,
  limit: number,
  viewerId: string,
): Promise<string> {
  const channel = await resolveReadableChannel(client, guildId, channelId, viewerId);
  if (!channel) {
    log.warn({ channelId, viewerId }, 'Tool fetch denied: channel not found or not readable by both bot and viewer');
    return 'Error: channel not found or not readable.';
  }
  const full = (await client.channels.fetch(channelId).catch(() => null));
  if (!full?.isTextBased()) return 'Error: channel became unreadable.';
  const messages = await full.messages.fetch({ limit: Math.min(Math.max(1, limit), TOOL_MESSAGE_LIMIT) });
  const lines = [...messages.values()].reverse().filter((m) => m.content.trim().length > 0).map(formatMessageLine);
  if (lines.length === 0) return `#${channel.name}: (no recent text messages)`;
  return `Recent messages from #${channel.name}:\n${lines.join('\n')}`;
}

const MAX_SEARCH_RESULTS = 10;

async function searchMembers(client: Client, guildId: string, query: string): Promise<string> {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return 'Error: guild not found.';
  // Cache may be partial for large guilds; ask Discord for current members.
  await guild.members.fetch({ query, limit: MAX_SEARCH_RESULTS }).catch(() => null);
  const q = query.toLowerCase();
  const matches = guild.members.cache
    .filter(
      (m) =>
        m.displayName.toLowerCase().includes(q) ||
        m.user.username.toLowerCase().includes(q) ||
        (m.user.globalName?.toLowerCase().includes(q) ?? false),
    )
    .first(MAX_SEARCH_RESULTS);
  if (!matches?.length) return `No members found matching "${query}".`;
  const lines = matches.map(
    (m) =>
      `${m.displayName} (@${m.user.username}, id: ${m.user.id}, mention: <@${m.user.id}>${m.nickname ? `, nickname: ${m.nickname}` : ''}, bot: ${m.user.bot})`,
  );
  return `Members matching "${query}":\n${lines.join('\n')}`;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentPart[];
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

const MAX_IMAGES = 3;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

let visionSupportCache: boolean | null = null;

function isDenylistedId(channelId: string): boolean {
  return loadConfig().channelDenylist.includes(channelId);
}

function logDenied(channelId: string, via: string) {
  log.info({ channelId, via }, 'Channel is denylisted (or its parent is); excluding from tool access');
}

async function isDenylistedWithAncestors(client: Client, channelId: string): Promise<boolean> {
  let currentId: string | null = channelId;
  for (let depth = 0; currentId && depth < 5; depth++) {
    if (isDenylistedId(currentId)) {
      logDenied(channelId, depth === 0 ? 'self' : `ancestor ${currentId}`);
      return true;
    }
    const parent: Channel | null = await client.channels.fetch(currentId).catch(() => null);
    currentId = parent && !parent.isDMBased() ? parent.parentId : null;
  }
  return false;
}

async function modelSupportsVision(endpoint: string, apiKey: string, model: string, fallback: boolean): Promise<boolean> {
  if (visionSupportCache !== null) return visionSupportCache;
  try {
    const res = await fetch(`${endpoint}/models`, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (res.ok) {
      const data = (await res.json()) as { data?: Array<{ id: string; architecture?: { modality?: string } }> };
      const entry = data.data?.find((m) => m.id === model);
      const inputModality = entry?.architecture?.modality?.split('->')[0] ?? '';
      visionSupportCache = inputModality.includes('image');
      if (visionSupportCache) return visionSupportCache;
      log.info({ model }, 'Model listing has no image input capability; falling back to config');
    } else {
      log.info({ status: res.status }, 'Models endpoint unavailable; falling back to config for vision support');
    }
  } catch (err) {
    log.info({ err }, 'Models endpoint probe failed; falling back to config for vision support');
  }
  visionSupportCache = fallback;
  return fallback;
}

export async function collectImageAttachments(message: Message, enabled: boolean): Promise<string[]> {
  if (!enabled) return [];
  const attachments = [...message.attachments.values()].filter(
    (a) => a.contentType?.startsWith('image/') && a.size <= MAX_IMAGE_BYTES,
  );
  if (attachments.length === 0) return [];
  const dataUrls: string[] = [];
  for (const attachment of attachments.slice(0, MAX_IMAGES)) {
    const res = await fetch(attachment.url).catch(() => null);
    if (!res?.ok) {
      log.warn({ url: attachment.url, status: res?.status }, 'Failed to download image attachment');
      continue;
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    dataUrls.push(`data:${attachment.contentType};base64,${buffer.toString('base64')}`);
  }
  if (dataUrls.length > 0) {
    log.info({ count: dataUrls.length }, 'Attaching Discord images to LLM request');
  }
  return dataUrls;
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

function buildUserContent(chatContext: string, images: string[]): string | ContentPart[] {
  const text = `Chat context:\n${chatContext}\n\nTask: React to the last person's message with peak cosmic energy!`;
  if (images.length === 0) return text;
  return [{ type: 'text', text }, ...images.map((url) => ({ type: 'image_url' as const, image_url: { url } }))];
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
      content: buildUserContent(chatContext, images),
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
        messages[1] = { role: 'user', content: buildUserContent(chatContext, []) };
        data = await complete(openaiEndpoint, openaiApiKey, openaiModel, messages, tools);
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
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(call.function.arguments);
      } catch {
        log.warn({ tool: call.function.name, args: call.function.arguments }, 'LLM tool call had invalid JSON arguments');
        messages.push({ role: 'tool', tool_call_id: call.id, content: 'Error: invalid JSON arguments.' });
        continue;
      }
      let result: string;
      if (call.function.name === 'fetch_channel_messages') {
        const channelId = String(args.channel_id ?? '');
        const limit = Number(args.limit ?? 10);
        log.info({ channelId, limit, triggerChannel: triggerMessage?.channelId }, 'Executing fetch_channel_messages');
        result = await fetchChannelMessages(
          client!,
          triggerMessage!.guild!.id,
          channelId,
          limit,
          triggerMessage!.author.id,
        ).catch((err) => {
          log.error({ err, channelId }, 'Tool execution failed');
          return 'Error: failed to fetch messages.';
        });
      } else if (call.function.name === 'read_messages') {
        const channelId = String(args.channel_id ?? '');
        const count = Number(args.count ?? 20);
        const cursor = {
          before: args.before ? String(args.before) : undefined,
          after: args.after ? String(args.after) : undefined,
          around: args.around ? String(args.around) : undefined,
        };
        log.info({ channelId, count, cursor, triggerChannel: triggerMessage?.channelId }, 'Executing read_messages');
        result = await readMessages(
          client!,
          triggerMessage!.guild!.id,
          channelId,
          count,
          cursor,
          triggerMessage!.author.id,
        ).catch((err) => {
          log.error({ err, channelId }, 'Tool execution failed');
          return 'Error: failed to fetch messages.';
        });
      } else if (call.function.name === 'search_members') {
        const query = String(args.query ?? '');
        log.info({ query, triggerChannel: triggerMessage?.channelId }, 'Executing search_members');
        result = await searchMembers(client!, triggerMessage!.guild!.id, query).catch((err) => {
          log.error({ err, query }, 'Tool execution failed');
          return 'Error: failed to search members.';
        });
      } else if (call.function.name === 'search_wiki') {
        const query = String(args.query ?? '');
        if (getWikiStatus() !== 'ready') {
          result = 'Error: wiki index is unavailable right now.';
        } else {
          log.info({ query, triggerChannel: triggerMessage?.channelId }, 'Executing search_wiki');
          const results = searchWiki(query);
          result =
            results.length === 0
              ? `No wiki pages found for "${query}".`
              : `Wiki results for "${query}":\n${results
                  .map((r) => `- ${r.title} (${r.url}): ${r.snippet}`)
                  .join('\n')}`;
        }
      } else {
        log.warn({ tool: call.function.name }, 'LLM called unknown tool');
        result = `Error: unknown tool ${call.function.name}.`;
      }
      log.info({ tool: call.function.name, resultPreview: result.slice(0, 200) }, 'Tool result returned to LLM');
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
      body: JSON.stringify({ model, messages, tools, tool_choice: 'auto', max_tokens: MAX_OUTPUT_TOKENS }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) {
    const body = await res.text();
    throw Object.assign(new Error(`API error ${res.status}: ${body}`), { status: res.status });
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
