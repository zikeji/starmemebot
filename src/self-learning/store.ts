import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { loadConfig } from '../config.js';
import { createLogger } from '../logger.js';

const log = createLogger('self-learning');

export const FEEDBACK_DAILY_CAP = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

export type FeedbackCategory = 'gap' | 'disputed' | 'uncertain';
export const FEEDBACK_CATEGORIES: readonly FeedbackCategory[] = ['gap', 'disputed', 'uncertain'];

export type ActivityOutcome = 'posted' | 'silent' | 'error' | 'trusted-cancelled' | 'emptied';

interface EntryBase {
  at: string;
  guildId: string;
  channelId: string;
}

export interface AdminCorrectionEntry extends EntryBase {
  kind: 'admin-correction';
  messageId: string;
  correctorId: string;
  original: string;
  correction: string;
  rewritten: string | null;
}

export interface FeedbackEntry extends EntryBase {
  kind: 'feedback';
  category: FeedbackCategory;
  messageId: string;
  authorId: string;
  context: string;
  note: string;
}

export interface ActivityEntry extends EntryBase {
  kind: 'activity';
  outcome: ActivityOutcome;
  triggerMessageIds: string[];
  pinged: string[];
  removed: Array<{ authorId: string; reason: string }>;
  text: string | null;
}

export type SelfLearningEntry = AdminCorrectionEntry | FeedbackEntry | ActivityEntry;

export type NewEntry =
  | Omit<AdminCorrectionEntry, 'at'>
  | Omit<FeedbackEntry, 'at'>
  | Omit<ActivityEntry, 'at'>;

let writeQueue: Promise<unknown> = Promise.resolve();

function serialized<T>(write: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(write, write);
  writeQueue = run.catch(() => undefined);
  return run;
}

export function jumpLink(entry: { guildId: string; channelId: string; messageId: string }): string {
  return `https://discord.com/channels/${entry.guildId}/${entry.channelId}/${entry.messageId}`;
}

export function appendEntry(entry: NewEntry, now: Date = new Date()): Promise<void> {
  return serialized(async () => {
    const { selfLearningFile } = loadConfig();
    await mkdir(dirname(selfLearningFile), { recursive: true });
    await appendFile(selfLearningFile, `${JSON.stringify({ ...entry, at: now.toISOString() })}\n`, 'utf8');
  });
}

export async function readEntries(): Promise<SelfLearningEntry[]> {
  const { selfLearningFile } = loadConfig();
  let raw: string;
  try {
    raw = await readFile(selfLearningFile, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const entries: SelfLearningEntry[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as SelfLearningEntry);
    } catch {
      log.warn('Skipping unreadable self-learning line');
    }
  }
  return entries;
}

export function clearEntriesUpTo(cutoff: Date): Promise<number> {
  return serialized(async () => {
    const { selfLearningFile } = loadConfig();
    const kept = (await readEntries()).filter((e) => Date.parse(e.at) > cutoff.getTime());
    await mkdir(dirname(selfLearningFile), { recursive: true });
    await writeFile(selfLearningFile, kept.map((e) => `${JSON.stringify(e)}\n`).join(''), 'utf8');
    return kept.length;
  });
}

export async function feedbackRefusal(messageId: string, now: Date = new Date()): Promise<string | null> {
  const feedback = (await readEntries()).filter((e): e is FeedbackEntry => e.kind === 'feedback');
  if (feedback.some((e) => e.messageId === messageId)) return 'Feedback was already logged for this message.';
  const recent = feedback.filter((e) => now.getTime() - Date.parse(e.at) < DAY_MS);
  if (recent.length >= FEEDBACK_DAILY_CAP) return 'The daily feedback limit is reached.';
  return null;
}
