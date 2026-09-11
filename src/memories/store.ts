import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import MiniSearch from 'minisearch';
import { loadConfig } from '../config.js';
import { createLogger } from '../logger.js';

const log = createLogger('memories:store');

export interface MemoryEdit {
  text: string;
  editedAt: string;
  triggeredBy: string;
}

export interface MemoryRecord {
  id: string;
  guildId: string;
  text: string;
  embedding: number[];
  createdAt: string;
  triggeredBy: string;
  relevantUserIds: string[];
  /** Origin channel; audit only — visibility is guild-wide. */
  channelId: string;
  retrievals: number;
  lastRetrievedAt: string | null;
  retrievalSources: { tool: number; passive: number };
  edits: MemoryEdit[];
}

export interface NewMemory {
  guildId: string;
  text: string;
  embedding: number[];
  triggeredBy: string;
  relevantUserIds: string[];
  channelId: string;
}

// Two different scoring scales: MiniSearch lexical (roughly 1 per matched term) vs cosine.
// Both are initial guesses; revisit against real usage data if recall feels off.
const PASSIVE_TOP_K = 3;
const PASSIVE_SCORE_FLOOR = 2;
const TOOL_TOP_K = 5;
// Cosine similarity for bge-family embeddings; unrelated sentences still score ~0.2-0.3.
// Revisit against real usage data if search returns junk or misses obvious matches.
const TOOL_SCORE_FLOOR = 0.35;

let records: MemoryRecord[] = [];
let index: MiniSearch<{ id: string; text: string }> | null = null;
let loaded = false;
let statsDirty = false;
let flushTimer: NodeJS.Timeout | null = null;

function rebuildIndex(): void {
  index = new MiniSearch({ fields: ['text'], storeFields: ['id'], idField: 'id' });
  index.addAll(records.map((r) => ({ id: r.id, text: r.text })));
}

export async function loadMemories(): Promise<void> {
  const { memoryFile } = loadConfig();
  let raw = '';
  try {
    raw = await readFile(memoryFile, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      records = [];
      rebuildIndex();
      loaded = true;
      log.info({ memoryFile }, 'No memories file yet; starting with an empty store');
      return;
    }
    throw err;
  }
  records = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line): MemoryRecord | null => {
      try {
        return JSON.parse(line) as MemoryRecord;
      } catch {
        // Torn tail line from a crash mid-append; drop it.
        log.warn('Skipping unparsable memory line');
        return null;
      }
    })
    .filter((r): r is MemoryRecord => r !== null);
  rebuildIndex();
  loaded = true;
  log.info({ count: records.length }, 'Memories loaded');
}

function ensureLoaded(): void {
  if (!loaded) throw new Error('Memory store used before loadMemories()');
}

async function persistAll(): Promise<void> {
  const { memoryFile } = loadConfig();
  await mkdir(dirname(memoryFile), { recursive: true });
  const tmp = `${memoryFile}.tmp`;
  await writeFile(tmp, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  await rename(tmp, memoryFile);
}

// Single writer: concurrent turns appending at once must not interleave tmp-file rewrites.
let persistChain: Promise<void> = Promise.resolve();
function serializedPersist(): Promise<void> {
  const run = persistChain.then(persistAll, persistAll);
  persistChain = run.catch(() => {});
  return run;
}

/** Telemetry writes are debounced; the next structural write flushes them too. */
function scheduleStatsFlush(): void {
  statsDirty = true;
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    if (!statsDirty) return;
    statsDirty = false;
    serializedPersist().catch((err) => log.error({ err }, 'Failed to flush memory stats'));
  }, 10_000);
  flushTimer.unref?.();
}

process.on('beforeExit', () => {
  if (statsDirty) void serializedPersist().catch(() => {});
});

export async function appendMemory(mem: NewMemory): Promise<MemoryRecord> {
  ensureLoaded();
  const record: MemoryRecord = {
    ...mem,
    id: `mem_${randomUUID().slice(0, 12)}`,
    createdAt: new Date().toISOString(),
    retrievals: 0,
    lastRetrievedAt: null,
    retrievalSources: { tool: 0, passive: 0 },
    edits: [],
  };
  records.push(record);
  index?.add({ id: record.id, text: record.text });
  try {
    await serializedPersist();
  } catch (err) {
    // Roll back by identity — a concurrent append may have pushed after us
    // before our persist settled, so records.pop() could remove the wrong one.
    const idx = records.indexOf(record);
    if (idx !== -1) records.splice(idx, 1);
    index?.discard(record.id);
    throw err;
  }
  statsDirty = false;
  return record;
}

export async function updateMemoryText(
  guildId: string,
  id: string,
  text: string,
  embedding: number[],
  triggeredBy: string,
): Promise<MemoryRecord | null> {
  ensureLoaded();
  const record = records.find((r) => r.guildId === guildId && r.id === id);
  if (!record) return null;
  const oldText = record.text;
  const oldEmbedding = record.embedding;
  const myEdit = { text: record.text, editedAt: new Date().toISOString(), triggeredBy };
  record.edits.push(myEdit);
  record.text = text;
  record.embedding = embedding;
  index?.discard(id);
  index?.add({ id, text });
  try {
    await serializedPersist();
  } catch (err) {
    // Only revert if our edit is still the current one — a concurrent update to
    // the same id that landed meanwhile must not be clobbered by our rollback.
    if (record.text === text) {
      record.text = oldText;
      record.embedding = oldEmbedding;
      const editIdx = record.edits.indexOf(myEdit);
      if (editIdx !== -1) record.edits.splice(editIdx, 1);
      index?.discard(id);
      index?.add({ id, text: oldText });
    }
    throw err;
  }
  statsDirty = false;
  return record;
}

export function getMemoryTextById(guildId: string, id: string): string | null {
  ensureLoaded();
  return records.find((r) => r.guildId === guildId && r.id === id)?.text ?? null;
}

function bumpRetrieval(record: MemoryRecord, source: 'tool' | 'passive'): void {
  record.retrievals += 1;
  record.lastRetrievedAt = new Date().toISOString();
  record.retrievalSources[source] += 1;
  scheduleStatsFlush();
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

export interface ScoredMemory {
  record: MemoryRecord;
  score: number;
}

export async function searchByVector(guildId: string, queryVector: number[]): Promise<ScoredMemory[]> {
  ensureLoaded();
  const hits = records
    .filter((r) => r.guildId === guildId)
    // Stale-dimension records (EMBEDDING_MODEL changed) rank last, not NaN-scrambled.
    .map((r) => ({ record: r, score: r.embedding.length === queryVector.length ? cosine(queryVector, r.embedding) : -1 }))
    // Floor BEFORE bumping telemetry: only memories actually surfaced count as retrieved.
    .filter((h) => h.score >= TOOL_SCORE_FLOOR)
    .sort((a, b) => b.score - a.score)
    .slice(0, TOOL_TOP_K);
  for (const hit of hits) bumpRetrieval(hit.record, 'tool');
  return hits;
}

/** Free lexical recall for passive injection — names and exact phrases. */
export function passiveRecall(guildId: string, queryText: string): ScoredMemory[] {
  ensureLoaded();
  if (!index || queryText.trim().length === 0) return [];
  const byId = new Map(records.filter((r) => r.guildId === guildId).map((r) => [r.id, r]));
  // MiniSearch indexes every guild; filter to this guild's hits BEFORE taking the top few,
  // or a busy guild crowds out a quiet guild's own matches.
  const scored = index
    .search(queryText, { prefix: true, fuzzy: 0.2 })
    .map((h) => {
      const record = byId.get(h.id);
      return record ? { record, score: h.score } : null;
    })
    .filter((s): s is ScoredMemory => s !== null && s.score >= PASSIVE_SCORE_FLOOR)
    .slice(0, PASSIVE_TOP_K);
  for (const hit of scored) bumpRetrieval(hit.record, 'passive');
  return scored;
}
