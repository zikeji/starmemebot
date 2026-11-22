import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildExport } from './export.js';
import { appendEntry, clearEntriesUpTo, FEEDBACK_DAILY_CAP, feedbackRefusal, readEntries } from './store.js';

process.env.DISCORD_TOKEN ??= 'test-token';
process.env.OPENAI_ENDPOINT ??= 'https://example.invalid/v1';
process.env.OPENAI_API_KEY ??= 'test-key';
process.env.OPENAI_MODEL ??= 'test-model';

const base = { guildId: 'g', channelId: 'c' };
const feedback = (messageId: string) => ({
  ...base,
  kind: 'feedback' as const,
  category: 'gap' as const,
  messageId,
  authorId: 'u',
  context: 'someone: how do I get 7.0 from 6.7.9',
  note: 'asked about upgrading from 6.7.9',
});

describe('self-learning store', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'selflearn-'));
    process.env.SELF_LEARNING_FILE = join(dir, 'self-learning.jsonl');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.SELF_LEARNING_FILE;
  });

  it('refuses a second note for the same message', async () => {
    await appendEntry(feedback('m1'));
    expect(await feedbackRefusal('m1')).toMatch(/already/);
    expect(await feedbackRefusal('m2')).toBeNull();
  });

  it('caps feedback per rolling day', async () => {
    const yesterday = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await appendEntry(feedback('old'), yesterday);
    for (let i = 0; i < FEEDBACK_DAILY_CAP; i++) await appendEntry(feedback(`m${i}`));
    expect(await feedbackRefusal('new')).toMatch(/limit/);
  });

  it('clears only entries included in the export', async () => {
    await appendEntry(feedback('m1'), new Date('2026-11-21T10:00:00Z'));
    await appendEntry(feedback('m2'), new Date('2026-11-21T12:00:00Z'));
    expect(await clearEntriesUpTo(new Date('2026-11-21T11:00:00Z'))).toBe(1);
    expect((await readEntries()).map((e) => (e.kind === 'feedback' ? e.messageId : ''))).toEqual(['m2']);
  });

  it('does not lose appends that race a clear', async () => {
    await appendEntry(feedback('old'), new Date('2026-11-21T10:00:00Z'));
    const cleared = clearEntriesUpTo(new Date('2026-11-21T11:00:00Z'));
    const appended = appendEntry(feedback('new'), new Date('2026-11-21T12:00:00Z'));
    await Promise.all([cleared, appended]);
    expect((await readEntries()).map((e) => (e.kind === 'feedback' ? e.messageId : ''))).toEqual(['new']);
  });

  it('exports stats, corrections, feedback and activity', async () => {
    await appendEntry(feedback('m1'));
    await appendEntry({ ...base, kind: 'admin-correction', messageId: 'r1', correctorId: 'admin', original: 'use Dom', correction: 'it is testing now', rewritten: 'use `testing`' });
    await appendEntry({ ...base, kind: 'activity', outcome: 'posted', triggerMessageIds: ['t1'], pinged: ['u'], removed: [], text: '<@u> it is `stable` now' });
    await appendEntry({ ...base, kind: 'activity', outcome: 'trusted-cancelled', triggerMessageIds: [], pinged: [], removed: [{ authorId: 'u2', reason: 'trusted-answer' }], text: null });
    await appendEntry({ ...base, kind: 'trusted-reply', messageId: 'f1', authorId: 'firestar', reply: 'they can also use /share-route', rebeccaMessageId: 'r2', rebeccaText: 'open a ticket' });
    const text = buildExport(await readEntries());
    expect(text).toContain('Correction checks: 2 (posted 1, silent 0, rejected 0, trusted-cancelled 1');
    expect(text).toContain('gap 1');
    expect(text).toContain('it is testing now');
    expect(text).toContain('https://discord.com/channels/g/c/t1');
    expect(text).toContain('Trusted replies to Rebecca: 1');
    expect(text).toContain('they can also use /share-route');
  });
});
