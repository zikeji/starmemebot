import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendMemory, getMemoryTextById, loadMemories, passiveRecall, searchByVector, updateMemoryText, type NewMemory } from './store.js';

process.env.DISCORD_TOKEN ??= 'test-token';
process.env.OPENAI_ENDPOINT ??= 'https://example.invalid/v1';
process.env.OPENAI_API_KEY ??= 'test-key';
process.env.OPENAI_MODEL ??= 'test-model';

const GUILD = 'guild1';
const OTHER_GUILD = 'guild2';

function memory(text: string, embedding: number[], guildId = GUILD): NewMemory {
  return { guildId, text, embedding, triggeredBy: 'user1', relevantUserIds: [], channelId: 'chan1' };
}

describe('memory store', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'memtest-'));
    process.env.MEMORY_FILE = join(dir, 'memories.jsonl');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.MEMORY_FILE;
  });

  it('appends, reloads from disk, and survives torn tail lines', async () => {
    await loadMemories();
    const stored = await appendMemory(memory('zikeji drives a Fiesta', [1, 0]));
    expect(stored.id).toMatch(/^mem_/);
    expect(stored.retrievals).toBe(0);

    const { appendFile } = await import('node:fs/promises');
    await appendFile(process.env.MEMORY_FILE!, '{"torn');
    await loadMemories();
    expect(getMemoryTextById(GUILD, stored.id)).toBe('zikeji drives a Fiesta');
  });

  it('ranks by cosine similarity and scopes to guild', async () => {
    await loadMemories();
    await appendMemory(memory('the taco incident', [1, 0]));
    await appendMemory(memory('nebula fireworks night', [0, 1]));
    await appendMemory(memory('other server secret', [1, 0], OTHER_GUILD));

    const hits = await searchByVector(GUILD, [0.9, 0.1]);
    expect(hits[0]!.record.text).toBe('the taco incident');
    expect(hits.every((h) => h.record.guildId === GUILD)).toBe(true);
    expect(hits[0]!.record.retrievals).toBe(1);
    expect(hits[0]!.record.retrievalSources.tool).toBe(1);
  });

  it('passive recall matches names lexically and counts passive retrievals', async () => {
    await loadMemories();
    const noah = await appendMemory(memory('Noah once shipped on a Friday', [1, 0]));
    await appendMemory(memory('unrelated stardust fact', [0, 1]));

    const hits = passiveRecall(GUILD, 'remember when noah shipped');
    expect(hits.map((h) => h.record.id)).toContain(noah.id);
    const record = hits.find((h) => h.record.id === noah.id)!.record;
    expect(record.retrievalSources.passive).toBe(1);
    expect(record.retrievalSources.tool).toBe(0);
    expect(passiveRecall(OTHER_GUILD, 'noah shipped')).toHaveLength(0);
  });

  it('updates keep edit history, preserve counters, and refresh text in the index', async () => {
    await loadMemories();
    const stored = await appendMemory(memory('zikeji drives a Fiesta', [1, 0]));
    await searchByVector(GUILD, [1, 0]); // 1 tool retrieval

    const updated = await updateMemoryText(GUILD, stored.id, 'zikeji drives a red Fiesta', [1, 0.1], 'user2');
    expect(updated?.text).toBe('zikeji drives a red Fiesta');
    expect(updated?.retrievals).toBe(1);
    expect(updated?.edits).toHaveLength(1);
    expect(updated?.edits[0]).toMatchObject({ text: 'zikeji drives a Fiesta', triggeredBy: 'user2' });

    expect(passiveRecall(GUILD, 'zikeji red fiesta').map((h) => h.record.id)).toContain(stored.id);
    expect(await updateMemoryText(GUILD, 'mem_missing', 'x', [0], 'user2')).toBeNull();
  });

  it('concurrent appends all survive and persist', async () => {
    await loadMemories();
    const stored = await Promise.all(
      Array.from({ length: 5 }, (_, i) => appendMemory(memory(`memory number ${i}`, [1, i / 10]))),
    );
    await loadMemories();
    for (const s of stored) {
      expect(getMemoryTextById(GUILD, s.id)).toBe(s.text);
    }
  });
});
