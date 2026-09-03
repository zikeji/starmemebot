import type { Channel, Client, Message, TextChannel } from 'discord.js';
import { ChannelType } from 'discord.js';
import { loadConfig } from '../config.js';
import { formatMessageLine } from '../history.js';
import { createLogger } from '../logger.js';
import { getWikiStatus, searchWiki } from '../wiki/wiki.js';

const log = createLogger('llm:tools');
const TOOL_MESSAGE_LIMIT = 15;
const MAX_READ_COUNT = 100;
const MAX_SEARCH_RESULTS = 10;
const ACTIVITY_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_LISTED_CHANNELS = 20;

export interface ChannelSummary {
  id: string;
  name: string;
}

export interface MessageCursor {
  before?: string;
  after?: string;
  around?: string;
}

export const TOOL_DEFINITIONS = [
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

function isDenylistedId(channelId: string): boolean {
  return loadConfig().channelDenylist.includes(channelId);
}

function logDenied(channelId: string, via: string) {
  log.info({ channelId, via }, 'Channel is denylisted (or its parent is); excluding from tool access');
}

/** Walks up thread → channel → category. Cache first, REST fallback — a cache miss must never grant access. */
export async function isDenylistedWithAncestors(client: Client, guildId: string, channelId: string): Promise<boolean> {
  if (loadConfig().channelDenylist.length === 0) return false;
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return false;
  let currentId: string | null = channelId;
  for (let depth = 0; currentId && depth < 5; depth++) {
    if (isDenylistedId(currentId)) {
      logDenied(channelId, depth === 0 ? 'self' : `ancestor ${currentId}`);
      return true;
    }
    const resolved: Channel | null | undefined =
      guild.channels.cache.get(currentId) ?? (await client.channels.fetch(currentId).catch(() => null));
    currentId = resolved && !resolved.isDMBased() ? resolved.parentId : null;
  }
  return false;
}

export interface ToolContext {
  client: Client;
  guildId: string;
  viewerId: string;
  triggerChannelId?: string;
}

export async function executeToolCall(ctx: ToolContext, name: string, args: Record<string, unknown>): Promise<string> {
  if (name === 'fetch_channel_messages') {
    const channelId = String(args.channel_id ?? '');
    const limit = Number(args.limit ?? 10);
    log.info({ channelId, limit, triggerChannel: ctx.triggerChannelId }, 'Executing fetch_channel_messages');
    return fetchChannelMessages(ctx.client, ctx.guildId, channelId, limit, ctx.viewerId).catch((err) => {
      log.error({ err, channelId }, 'Tool execution failed');
      return 'Error: failed to fetch messages.';
    });
  }
  if (name === 'read_messages') {
    const channelId = String(args.channel_id ?? '');
    const count = Number(args.count ?? 20);
    const cursor = {
      before: args.before ? String(args.before) : undefined,
      after: args.after ? String(args.after) : undefined,
      around: args.around ? String(args.around) : undefined,
    };
    log.info({ channelId, count, cursor, triggerChannel: ctx.triggerChannelId }, 'Executing read_messages');
    return readMessages(ctx.client, ctx.guildId, channelId, count, cursor, ctx.viewerId).catch((err) => {
      log.error({ err, channelId }, 'Tool execution failed');
      return 'Error: failed to fetch messages.';
    });
  }
  if (name === 'search_members') {
    const query = String(args.query ?? '');
    log.info({ query, triggerChannel: ctx.triggerChannelId }, 'Executing search_members');
    return searchMembers(ctx.client, ctx.guildId, query).catch((err) => {
      log.error({ err, query }, 'Tool execution failed');
      return 'Error: failed to search members.';
    });
  }
  if (name === 'search_wiki') {
    const query = String(args.query ?? '');
    if (getWikiStatus() !== 'ready') return 'Error: wiki index is unavailable right now.';
    log.info({ query, triggerChannel: ctx.triggerChannelId }, 'Executing search_wiki');
    const results = searchWiki(query);
    return results.length === 0
      ? `No wiki pages found for "${query}".`
      : `Wiki results for "${query}":\n${results.map((r) => `- ${r.title} (${r.url}): ${r.snippet}`).join('\n')}`;
  }
  log.warn({ tool: name }, 'LLM called unknown tool');
  return `Error: unknown tool ${name}.`;
}

const CHANNEL_LINK_RE = /discord(?:app)?\.com\/channels\/\d+\/(\d+)(?:\/\d+)?/g;

export function extractLinkedChannelIds(message: Message): string[] {
  const ids = new Set<string>();
  for (const match of message.content.matchAll(CHANNEL_LINK_RE)) {
    ids.add(match[1]);
  }
  return [...ids];
}

export async function resolveReadableChannel(
  client: Client,
  guildId: string,
  channelId: string,
  viewerId: string,
): Promise<ChannelSummary | null> {
  if (!/^\d+$/.test(channelId)) return null;
  if (await isDenylistedWithAncestors(client, guildId, channelId)) return null;
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
    const channel = await resolveReadableChannel(client, guild.id, id, viewer.id);
    if (channel) relevant.push(channel);
  }
  const PROBE_LIMIT = 60;
  let probed = 0;
  const sorted = mutuallyReadable.sort((a, b) => (a as TextChannel).rawPosition - (b as TextChannel).rawPosition);
  for (const ch of sorted.values()) {
    if (relevant.length >= MAX_LISTED_CHANNELS) break;
    if (probed >= PROBE_LIMIT) {
      log.debug({ skipped: sorted.size - probed }, 'Activity probe limit reached; remaining channels unlisted');
      break;
    }
    if (relevant.some((r) => r.id === ch.id)) continue;
    probed += 1;
    if (await isDenylistedWithAncestors(client, guild.id, ch.id)) continue;
    const last = await (ch as TextChannel).messages.fetch({ limit: 1 }).catch(() => null);
    const lastMessage = last?.first();
    if (lastMessage && Date.now() - lastMessage.createdTimestamp < ACTIVITY_WINDOW_MS) {
      relevant.push({ id: ch.id, name: ch.name });
    }
  }
  return relevant.sort((a, b) => a.name.localeCompare(b.name));
}

export async function readMessages(
  client: Client,
  guildId: string,
  channelId: string,
  count: number,
  cursor: MessageCursor,
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

export async function fetchChannelMessages(
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

export async function searchMembers(client: Client, guildId: string, query: string): Promise<string> {
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
