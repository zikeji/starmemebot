import { describe, expect, it, vi } from 'vitest';
import { extractLinkedChannelIds, isDenylistedWithAncestors } from './tools.js';

vi.stubEnv('DISCORD_TOKEN', 'test-token');
vi.stubEnv('OPENAI_ENDPOINT', 'https://example.test');
vi.stubEnv('OPENAI_API_KEY', 'test-key');
vi.stubEnv('OPENAI_MODEL', 'test-model');
vi.stubEnv('CHANNEL_DENYLIST', '');

const GUILD_ID = 'g1';
const CATEGORY_ID = 'cat1';
const CHANNEL_ID = 'chan1';
const THREAD_ID = 'thread1';

function makeClient(denylist: string[], opts: { threadInGuildCache?: boolean; restFails?: boolean } = {}) {
  const category = { id: CATEGORY_ID, parentId: null, isDMBased: () => false };
  const channel = { id: CHANNEL_ID, parentId: CATEGORY_ID, isDMBased: () => false };
  const thread = { id: THREAD_ID, parentId: CHANNEL_ID, isDMBased: () => false };
  const guildCache = new Map<string, unknown>([
    [CATEGORY_ID, category],
    [CHANNEL_ID, channel],
  ]);
  if (opts.threadInGuildCache) guildCache.set(THREAD_ID, thread);
  const restFetch = vi.fn(async (id: string) => {
    if (opts.restFails) throw new Error('REST down');
    if (id === THREAD_ID) return thread;
    if (id === CHANNEL_ID) return channel;
    if (id === CATEGORY_ID) return category;
    throw new Error('unknown id');
  });
  const client = {
    guilds: { cache: new Map([[GUILD_ID, { channels: { cache: guildCache } }]]) },
    channels: { fetch: restFetch },
  };
  vi.stubEnv('CHANNEL_DENYLIST', denylist.join(','));
  return { client: client as never, restFetch };
}

describe('isDenylistedWithAncestors', () => {
  it('fast-returns false when the denylist is empty (no cache or REST access needed)', async () => {
    const { client, restFetch } = makeClient([]);
    const result = await isDenylistedWithAncestors(client, GUILD_ID, THREAD_ID);
    expect(result).toBe(false);
    expect(restFetch).not.toHaveBeenCalled();
  });

  it('denies a channel listed directly', async () => {
    const { client } = makeClient([CHANNEL_ID]);
    expect(await isDenylistedWithAncestors(client, GUILD_ID, CHANNEL_ID)).toBe(true);
  });

  it('denies a thread whose parent channel is denylisted (cache hit)', async () => {
    const { client, restFetch } = makeClient([CHANNEL_ID], { threadInGuildCache: true });
    expect(await isDenylistedWithAncestors(client, GUILD_ID, THREAD_ID)).toBe(true);
    expect(restFetch).not.toHaveBeenCalled();
  });

  it('falls back to REST for threads missing from the guild cache and still denies', async () => {
    const { client, restFetch } = makeClient([CHANNEL_ID], { threadInGuildCache: false });
    expect(await isDenylistedWithAncestors(client, GUILD_ID, THREAD_ID)).toBe(true);
    expect(restFetch).toHaveBeenCalled();
  });

  it('allows when the resolvable chain contains nothing denylisted', async () => {
    const { client } = makeClient(['unrelated-id'], { threadInGuildCache: false });
    expect(await isDenylistedWithAncestors(client, GUILD_ID, THREAD_ID)).toBe(false);
  });

  it('allows when REST fails but nothing in the resolvable chain is denylisted', async () => {
    // Fail-open on unresolvable ancestors is the known trade-off; here even REST
    // success would not find a denylisted ancestor, so the result is allow either way.
    const { client } = makeClient(['unrelated-id'], { restFails: true });
    expect(await isDenylistedWithAncestors(client, GUILD_ID, THREAD_ID)).toBe(false);
  });
});

describe('extractLinkedChannelIds', () => {
  it('extracts channel ids from message links', () => {
    const content = 'look at https://discord.com/channels/1387432184121393333/1514672842585800896/ and this one';
    expect(extractLinkedChannelIds({ content } as never)).toEqual(['1514672842585800896']);
  });

  it('is repeatable on the same input (matchAll does not advance lastIndex)', () => {
    const content =
      'https://discord.com/channels/111/222/333 https://discordapp.com/channels/111/444 and https://discord.com/channels/111/555/999';
    const first = extractLinkedChannelIds({ content } as never);
    const second = extractLinkedChannelIds({ content } as never);
    expect(first).toEqual(['222', '444', '555']);
    expect(second).toEqual(first);
  });
});
