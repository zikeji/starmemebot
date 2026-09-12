import type { Channel, Client, Message, TextChannel } from 'discord.js';
import { ChannelType } from 'discord.js';
import { isUserDenylisted, loadConfig } from '../config.js';
import { formatMessageLine } from '../history.js';
import { createLogger } from '../logger.js';
import { embed } from '../memories/embeddings.js';
import { guardMemoryUpdate, guardNewMemory } from '../memories/guard.js';
import { appendMemory, getMemoryTextById, searchByVector, updateMemoryText } from '../memories/store.js';
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
      name: 'react_to_message',
      description:
        'Add a single-emoji reaction to the message you are replying to. You can use this on its own (reaction instead of a reply) or together with a reply.',
      parameters: {
        type: 'object',
        properties: {
          emoji: { type: 'string', description: 'A unicode emoji (e.g. 👍, 🐸) or a custom emoji as <a:name:id>' },
        },
        required: ['emoji'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'stay_silent',
      description: 'Do not respond at all. Use when silence is genuinely better than any reply.',
      parameters: { type: 'object', properties: {} },
    },
  },
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
  {
    type: 'function',
    function: {
      name: 'search_memories',
      description:
        'Search your long-term memories for this server (semantic match). Use when a memory, inside joke or past event is referenced and you need the details. Returns ids you can pass to update_memory.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What to look for, in natural language' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'store_memory',
      description:
        'Store a one-sentence memory for later recall. Only when a user asks you to remember something, or clearly wants it kept. You MUST call search_memories first this turn to check it is not already stored.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The memory as one self-contained sentence' },
          relevant_user_ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Discord user ids the memory is about or that were part of the moment',
          },
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_memory',
      description:
        'Refine an existing memory (same fact, reworded, extended or corrected) by id. You MUST call search_memories first this turn to find the id. The new text must still capture the original memory.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Memory id from a previous search_memories result' },
          text: { type: 'string', description: 'The refined memory text' },
        },
        required: ['id', 'text'],
      },
    },
  },
] as const;

function isDenylistedId(channelId: string): boolean {
  return loadConfig().channelDenylist.includes(channelId);
}

/** Walks up thread → channel → category. Cache first, REST fallback — a cache miss must never grant access. */
export async function isDenylistedWithAncestors(client: Client, guildId: string, channelId: string): Promise<boolean> {
  if (loadConfig().channelDenylist.length === 0) return false;
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return false;
  let currentId: string | null = channelId;
  for (let depth = 0; currentId && depth < 5; depth++) {
    if (isDenylistedId(currentId)) {
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
  /** Message to react to when the model calls react_to_message. */
  reactTarget?: Message;
}

/** Marker result that ends the loop with silence. */
export const TOOL_SILENT = '__stay_silent__';

const UNICODE_EMOJI_RE = /\p{Extended_Pictographic}/u;
const CUSTOM_EMOJI_RE = /^<a?:.+:\d+>$/;

export async function executeToolCall(ctx: ToolContext, name: string, args: Record<string, unknown>): Promise<string> {
  if (name === 'react_to_message') {
    const emoji = String(args.emoji ?? '').trim();
    if (!ctx.reactTarget) return 'Error: no message to react to.';
    // Discord accepts exactly one emoji per reaction; reject multi-emoji strings like "🐸⭐".
    const pictographicCount = [...emoji].filter((ch) => UNICODE_EMOJI_RE.test(ch)).length;
    if (!CUSTOM_EMOJI_RE.test(emoji) && pictographicCount !== 1) {
      return `Error: "${emoji}" is not a single valid emoji.`;
    }
    return ctx.reactTarget
      .react(emoji)
      .then(() => `Reacted to the message with ${emoji}.`)
      .catch((err) => {
        log.error({ err, emoji }, 'Failed to react');
        return 'Error: failed to react (missing permission or invalid emoji for this channel).';
      });
  }
  if (name === 'stay_silent') {
    return TOOL_SILENT;
  }
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
  if (name === 'search_memories') {
    const query = String(args.query ?? '');
    if (!ctx.triggerChannelId || (await isDenylistedWithAncestors(ctx.client, ctx.guildId, ctx.triggerChannelId))) {
      return 'Error: memory search is not available in this channel.';
    }
    log.info({ query }, 'Executing search_memories');
    try {
      const [vector] = await embed([query]);
      const hits = await searchByVector(ctx.guildId, vector);
      if (hits.length === 0) return 'No matching memories.';
      return `Memories (best first, with similarity):\n${hits
        .map(
          (h) =>
            `- [${h.record.id}, ${new Date(h.record.createdAt).toISOString().slice(0, 10)}, match ${h.score.toFixed(2)}] ${h.record.text}`,
        )
        .join('\n')}`;
    } catch (err) {
      log.error({ err }, 'search_memories failed');
      return 'Error: memory search failed.';
    }
  }
  if (name === 'store_memory') {
    const text = String(args.text ?? '').trim();
    const relevantUserIds = Array.isArray(args.relevant_user_ids) ? args.relevant_user_ids.map(String) : [];
    if (text.length === 0) return 'Error: empty memory text.';
    if (relevantUserIds.some(isUserDenylisted)) {
      return 'Refused: memories cannot be stored about this user.';
    }
    if (!ctx.triggerChannelId || (await isDenylistedWithAncestors(ctx.client, ctx.guildId, ctx.triggerChannelId))) {
      return 'Error: memories cannot be stored from this channel.';
    }
    const verdict = await guardNewMemory(text);
    if (!verdict.allow) {
      log.warn(
        { text, reason: verdict.reason, guildId: ctx.guildId, channelId: ctx.triggerChannelId, triggeredBy: ctx.viewerId },
        'Memory store denied by guard',
      );
      return `Refused: this memory was blocked by the safety filter (${verdict.reason}). Do not retry it; reply normally.`;
    }
    try {
      const [embedding] = await embed([text]);
      const record = await appendMemory({
        guildId: ctx.guildId,
        text,
        embedding,
        triggeredBy: ctx.viewerId,
        relevantUserIds,
        channelId: ctx.triggerChannelId,
      });
      log.info(
        { id: record.id, text, guildId: ctx.guildId, channelId: ctx.triggerChannelId, triggeredBy: ctx.viewerId },
        'Memory stored',
      );
      return `Stored as ${record.id}.`;
    } catch (err) {
      log.error({ err }, 'store_memory failed');
      return 'Error: failed to store the memory (embedding API issue?).';
    }
  }
  if (name === 'update_memory') {
    const id = String(args.id ?? '').trim();
    const text = String(args.text ?? '').trim();
    if (text.length === 0) return 'Error: empty memory text.';
    if (!ctx.triggerChannelId || (await isDenylistedWithAncestors(ctx.client, ctx.guildId, ctx.triggerChannelId))) {
      return 'Error: memories cannot be edited from this channel.';
    }
    let existing: string | null;
    try {
      existing = getMemoryTextById(ctx.guildId, id);
    } catch (err) {
      log.error({ err }, 'Memory store unavailable for update');
      return 'Error: memory store is unavailable right now.';
    }
    if (!existing) return 'Error: no memory with that id (call search_memories for current ids).';
    const verdict = await guardMemoryUpdate(existing, text);
    if (!verdict.allow || verdict.preserved === false) {
      log.warn(
        { id, oldText: existing, newText: text, reason: verdict.reason, guildId: ctx.guildId, channelId: ctx.triggerChannelId, triggeredBy: ctx.viewerId },
        'Memory update denied by guard',
      );
      return `Refused: the edit was blocked (${verdict.reason}). The new text must stay faithful to the original memory; reply normally instead.`;
    }
    try {
      const [embedding] = await embed([text]);
      const record = await updateMemoryText(ctx.guildId, id, text, embedding, ctx.viewerId);
      if (!record) return 'Error: memory vanished before the edit landed.';
      log.info(
        { id, text, guildId: ctx.guildId, channelId: ctx.triggerChannelId, triggeredBy: ctx.viewerId },
        'Memory updated',
      );
      return `Updated ${id}.`;
    } catch (err) {
      log.error({ err }, 'update_memory failed');
      return 'Error: failed to update the memory (embedding API issue?).';
    }
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
  const lines = [...messages.values()].reverse().filter((m) => !isUserDenylisted(m.author.id) && (m.content.trim().length > 0 || m.attachments.size > 0)).map(formatMessageLine);
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
  const lines = [...messages.values()].reverse().filter((m) => !isUserDenylisted(m.author.id) && m.content.trim().length > 0).map(formatMessageLine);
  if (lines.length === 0) return `#${channel.name}: (no recent text messages)`;
  return `Recent messages from #${channel.name}:\n${lines.join('\n')}`;
}

function formatMemberLine(m: { displayName: string; nickname?: string | null; user: { id: string; username: string; bot: boolean } }): string {
  return `${m.displayName} (@${m.user.username}, id: ${m.user.id}, mention: <@${m.user.id}>${m.nickname ? `, nickname: ${m.nickname}` : ''}, bot: ${m.user.bot})`;
}

export async function searchMembers(client: Client, guildId: string, query: string): Promise<string> {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return 'Error: guild not found.';
  if (/^\d+$/.test(query)) {
    // Raw user ID: Discord's query search can't resolve snowflakes — fetch directly.
    const member = await guild.members.fetch(query).catch(() => null);
    if (member && !isUserDenylisted(member.id)) {
      return `Members matching "${query}":\n${formatMemberLine(member)}`;
    }
    return `No members found matching "${query}".`;
  }
  // Cache may be partial for large guilds; ask Discord for current members.
  await guild.members.fetch({ query, limit: MAX_SEARCH_RESULTS }).catch(() => null);
  const q = query.toLowerCase();
  const matches = guild.members.cache
    .filter(
      (m) =>
        !isUserDenylisted(m.user.id) &&
        (m.displayName.toLowerCase().includes(q) ||
          m.user.username.toLowerCase().includes(q) ||
          (m.user.globalName?.toLowerCase().includes(q) ?? false)),
    )
    .first(MAX_SEARCH_RESULTS);
  if (!matches?.length) return `No members found matching "${query}".`;
  const lines = matches.map(formatMemberLine);
  return `Members matching "${query}":\n${lines.join('\n')}`;
}
