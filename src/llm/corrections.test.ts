import type { Client, Message } from 'discord.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateCorrection } from './corrections.js';

vi.stubEnv('DISCORD_TOKEN', 'test-token');
vi.stubEnv('OPENAI_ENDPOINT', 'https://example.test');
vi.stubEnv('OPENAI_API_KEY', 'test-key');
vi.stubEnv('OPENAI_MODEL', 'test-model');

const anchor = { id: 'm1', guildId: 'g1', channelId: 'c1', author: { id: '42' } } as unknown as Message;
const candidate = { authorId: '42', displayName: 'Someone', messages: ['which branch'], installStringIssues: [] };

function modelReturns(finishReason: string, message: object): void {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ choices: [{ finish_reason: finishReason, message }] })));
}

const run = () => generateCorrection({} as Client, anchor, 'context', [candidate]);

describe('generateCorrection', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('treats a reply cut off by the token cap as an error, not as silence', async () => {
    modelReturns('length', { role: 'assistant', content: '' });
    await expect(run()).rejects.toThrow('cut off');
  });

  it('never posts the fragment of a cut-off reply', async () => {
    modelReturns('length', { role: 'assistant', content: '@' });
    await expect(run()).rejects.toThrow('cut off');
  });

  it('stays silent only when the model asks to', async () => {
    modelReturns('tool_calls', {
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 't1', type: 'function', function: { name: 'stay_silent', arguments: '{}' } }],
    });
    expect(await run()).toEqual({ kind: 'silent' });
  });

  it('fills in the mention for a candidate tag', async () => {
    modelReturns('stop', { role: 'assistant', content: '@P1 use `stable`' });
    expect(await run()).toEqual({ kind: 'reply', text: '<@42> use `stable`' });
  });
});
