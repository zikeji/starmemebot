import { MessageFlags, type Client, type Message } from 'discord.js';
import { isUserDenylisted, loadConfig } from '../config.js';
import { formatMessageLine } from '../history.js';
import { generateCorrection, type CorrectionCandidate } from '../llm/corrections.js';
import { createLogger } from '../logger.js';
import { isRebeccaSummoned } from '../memes/summon.js';
import { appendEntry, type ActivityOutcome } from '../self-learning/store.js';
import { createStore } from '../store.js';
import { matchesCorrectionTrigger } from './facts.js';
import { installStringIssues } from './install-string.js';
import { checkTargets } from './targets.js';
import { CorrectionScheduler, type CheckEntry, type DroppedCheck, type FiredCheck } from './scheduler.js';

const log = createLogger('corrections');
const HISTORY_FETCH_LIMIT = 30;
const CONTEXT_LINES_BEFORE_TRIGGER = 5;
const CORRECTION_POST_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const REPLY_WINDOW_SLACK_MS = 5_000;

const correctionPosts = createStore<true>('correction-posts', { ttl: CORRECTION_POST_TTL_MS });
const guildByChannel = new Map<string, string>();
let activeClient: Client | null = null;

const scheduler = new CorrectionScheduler({
  onFire: (check) => {
    scheduler.startCooldown(check.channelId);
    void fireCheck(check).catch((err) => log.error({ err, channelId: check.channelId }, 'Correction check failed'));
  },
  onDrop: (check) => {
    void recordDrop(check).catch((err) => log.error({ err }, 'Failed to record dropped check'));
  },
});

export function startCorrectionCooldown(channelId: string): void {
  scheduler.startCooldown(channelId);
}

export async function isCorrectionPost(messageId: string): Promise<boolean> {
  return (await correctionPosts.get(messageId).catch(() => undefined)) === true;
}

export async function observeMessage(message: Message, client: Client): Promise<void> {
  const config = loadConfig();
  if (!config.correctionsEnabled) return;
  if (message.author.bot || !message.guildId || isUserDenylisted(message.author.id)) return;
  if (!isAllowedChannel(message, config.correctionChannels)) return;
  activeClient = client;
  guildByChannel.set(message.channelId, message.guildId);

  if (isTrusted(message, config.trustedRoleIds)) {
    await cancelAnsweredAuthors(message);
    scheduler.bump(message.channelId);
    return;
  }
  if (isRebeccaSummoned(message, client)) {
    scheduler.remove(message.channelId, message.author.id, 'mentioned-rebecca');
    scheduler.bump(message.channelId);
    return;
  }
  if (matchesCorrectionTrigger(message.content)) {
    log.debug({ channelId: message.channelId, author: message.author.username }, 'Correction candidate queued');
    scheduler.trigger(message.channelId, message.author.id, message.id);
    return;
  }
  scheduler.bump(message.channelId);
}

function isAllowedChannel(message: Message, allowlist: string[]): boolean {
  if (allowlist.length === 0) return false;
  const channel = message.channel;
  const ancestors = [channel.id];
  if (!channel.isDMBased()) {
    if (channel.parentId) ancestors.push(channel.parentId);
    if (channel.isThread() && channel.parent?.parentId) ancestors.push(channel.parent.parentId);
  }
  return ancestors.some((id) => allowlist.includes(id));
}

async function endWithoutPost(
  guildId: string,
  check: FiredCheck,
  outcome: ActivityOutcome,
  text: string | null = null,
): Promise<void> {
  scheduler.clearCooldown(check.channelId);
  await recordActivity(guildId, check, outcome, text, []);
}

function isTrusted(message: Message, trustedRoleIds: string[]): boolean {
  return trustedRoleIds.length > 0 && Boolean(message.member?.roles.cache.some((r) => trustedRoleIds.includes(r.id)));
}

async function cancelAnsweredAuthors(message: Message): Promise<void> {
  const pending = scheduler.pendingAuthors(message.channelId);
  if (pending.length === 0) return;
  const repliedTo = message.reference?.messageId ? await message.fetchReference().catch(() => null) : null;
  for (const entry of pending) {
    if (message.mentions.users.has(entry.authorId) || answers(repliedTo, entry)) {
      log.info({ channelId: message.channelId, authorId: entry.authorId, by: message.author.id }, 'Trusted answer cancels correction');
      scheduler.remove(message.channelId, entry.authorId, 'trusted-answer');
    }
  }
}

function answers(repliedTo: Message | null, entry: CheckEntry): boolean {
  if (!repliedTo || repliedTo.author.id !== entry.authorId) return false;
  return entry.messageIds.includes(repliedTo.id) || repliedTo.createdTimestamp >= entry.joinedAt - REPLY_WINDOW_SLACK_MS;
}

async function fireCheck(check: FiredCheck): Promise<void> {
  const client = activeClient;
  const guildId = guildByChannel.get(check.channelId);
  if (!client || !guildId) return;
  const channel = await client.channels.fetch(check.channelId).catch(() => null);
  if (!channel?.isTextBased() || !channel.isSendable()) {
    await endWithoutPost(guildId, check, 'error');
    return;
  }

  const fetched = await channel.messages.fetch({ limit: HISTORY_FETCH_LIMIT });
  const history = [...fetched.values()].reverse().filter((m) => !isUserDenylisted(m.author.id));
  const triggerIds = new Set(check.entries.flatMap((e) => e.messageIds));
  const firstTriggerIndex = history.findIndex((m) => triggerIds.has(m.id));
  const window = history.slice(Math.max(0, firstTriggerIndex - CONTEXT_LINES_BEFORE_TRIGGER));
  const triggers = await resolveTriggers(channel, window, [...triggerIds]);
  const anchor = triggers.at(-1);
  if (!anchor) {
    await endWithoutPost(guildId, check, 'silent');
    return;
  }

  const inWindow = new Set(window.map((m) => m.id));
  const scrolledOff = triggers.filter((m) => !inWindow.has(m.id)).map((m) => `(earlier trigger message) ${formatMessageLine(m)}`);
  const repliedLines: string[] = [];
  for (const trigger of triggers) {
    const refId = trigger.reference?.messageId;
    if (!refId || inWindow.has(refId)) continue;
    const ref = await trigger.fetchReference().catch(() => null);
    if (ref && !isUserDenylisted(ref.author.id)) repliedLines.push(`(earlier message being replied to) ${formatMessageLine(ref)}`);
  }
  const chatContext = [...repliedLines, ...scrolledOff, ...window.map(formatMessageLine)].join('\n');

  const candidates: CorrectionCandidate[] = check.entries.map((entry) => {
    const own = triggers.filter((m) => m.author.id === entry.authorId);
    return {
      authorId: entry.authorId,
      displayName: own[0]?.member?.displayName ?? own[0]?.author.username ?? entry.authorId,
      messages: own.map((m) => m.content),
      installStringIssues: own.flatMap((m) => installStringIssues(m.content)),
    };
  });

  let outcome;
  try {
    outcome = await generateCorrection(client, anchor, chatContext, candidates);
  } catch (err) {
    log.error({ err }, 'Correction LLM call failed');
    await endWithoutPost(guildId, check, 'error');
    return;
  }
  if (outcome.kind === 'silent') {
    log.info({ channelId: check.channelId }, 'Correction check ended in silence');
    await endWithoutPost(guildId, check, 'silent');
    return;
  }

  const pingable = check.entries.map((e) => e.authorId);
  const { addressed, strays } = checkTargets(outcome.text, pingable);
  if (strays.length > 0 || addressed.length === 0) {
    log.warn({ channelId: check.channelId, strays, addressed }, 'Correction addressed someone outside the check; not posting');
    await endWithoutPost(guildId, check, 'rejected', outcome.text);
    return;
  }
  const lastSeenId = history.at(-1)?.id;
  if (lastSeenId && (await answeredSince(channel, lastSeenId, pingable))) {
    log.info({ channelId: check.channelId }, 'Trusted member answered while the correction was being written');
    await endWithoutPost(guildId, check, 'trusted-cancelled', outcome.text);
    return;
  }
  let sent: Message;
  try {
    sent = await channel.send({
      content: outcome.text.slice(0, 2000),
      allowedMentions: { parse: [], users: pingable },
      flags: MessageFlags.SuppressEmbeds,
    });
  } catch (err) {
    log.error({ err, channelId: check.channelId }, 'Failed to post correction');
    await endWithoutPost(guildId, check, 'error', outcome.text);
    return;
  }
  scheduler.startCooldown(check.channelId);
  await correctionPosts.set(sent.id, true).catch((err) => log.warn({ err }, 'Failed to remember correction post'));
  log.info({ channelId: check.channelId, pinged: addressed }, 'Correction posted');
  await recordActivity(guildId, check, 'posted', sent.content, addressed);
}

async function answeredSince(
  channel: { messages: { fetch(options: { after: string; limit: number }): Promise<Map<string, Message>> } },
  afterId: string,
  authorIds: string[],
): Promise<boolean> {
  const { trustedRoleIds } = loadConfig();
  const newer = await channel.messages.fetch({ after: afterId, limit: 50 }).catch(() => new Map<string, Message>());
  return [...newer.values()].some(
    (m) =>
      isTrusted(m, trustedRoleIds) &&
      authorIds.some((id) => m.mentions.users.has(id) || m.mentions.repliedUser?.id === id),
  );
}

async function resolveTriggers(
  channel: { messages: { fetch(id: string): Promise<Message> } },
  window: Message[],
  ids: string[],
): Promise<Message[]> {
  const byId = new Map(window.map((m) => [m.id, m]));
  const resolved: Message[] = [];
  for (const id of ids) {
    const message = byId.get(id) ?? (await channel.messages.fetch(id).catch(() => null));
    if (message) resolved.push(message);
  }
  return resolved.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

async function recordDrop(check: DroppedCheck): Promise<void> {
  const guildId = guildByChannel.get(check.channelId);
  if (!guildId) return;
  const outcome: ActivityOutcome = check.removed.some((r) => r.reason === 'trusted-answer') ? 'trusted-cancelled' : 'emptied';
  await appendEntry({
    kind: 'activity',
    guildId,
    channelId: check.channelId,
    outcome,
    triggerMessageIds: [],
    pinged: [],
    removed: check.removed,
    text: null,
  });
}

async function recordActivity(
  guildId: string,
  check: FiredCheck,
  outcome: ActivityOutcome,
  text: string | null,
  pinged: string[],
): Promise<void> {
  await appendEntry({
    kind: 'activity',
    guildId,
    channelId: check.channelId,
    outcome,
    triggerMessageIds: check.entries.flatMap((e) => e.messageIds),
    pinged,
    removed: check.removed,
    text,
  }).catch((err) => log.error({ err }, 'Failed to record correction activity'));
}
