import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeToolCall, fetchChannelMessages, searchMembers } from './llm/tools.js';
import { getHistoryContext } from './history.js';
import { isUserDenylisted } from './config.js';

vi.stubEnv('DISCORD_TOKEN', 'test-token');
vi.stubEnv('OPENAI_ENDPOINT', 'https://example.test');
vi.stubEnv('OPENAI_API_KEY', 'test-key');
vi.stubEnv('OPENAI_MODEL', 'test-model');
vi.stubEnv('CHANNEL_DENYLIST', '');

const DENIED_ID = '666';
const OTHER_ID = '42';

afterEach(() => {
  vi.stubEnv('USER_DENYLIST', '');
});

function makeMessage(id: string, authorId: string, content = 'hello') {
  return {
    id,
    content,
    author: { id: authorId, username: `user-${authorId}` },
    member: null,
    attachments: new Map(),
  } as never;
}

function makeChannel(messages: unknown[]) {
  const map = new Map(messages.map((m, i) => [String(i), m]));
  return { messages: { fetch: vi.fn(async () => map) } } as never;
}

describe('isUserDenylisted', () => {
  it('parses a comma-separated list with whitespace', () => {
    vi.stubEnv('USER_DENYLIST', ` ${OTHER_ID} , ${DENIED_ID} `);
    expect(isUserDenylisted(DENIED_ID)).toBe(true);
    expect(isUserDenylisted(OTHER_ID)).toBe(true);
    expect(isUserDenylisted('999')).toBe(false);
  });

  it('treats an unset or empty list as allowing everyone', () => {
    vi.stubEnv('USER_DENYLIST', '');
    expect(isUserDenylisted(DENIED_ID)).toBe(false);
  });
});

describe('history context', () => {
  it('omits denylisted authors from getHistoryContext', async () => {
    vi.stubEnv('USER_DENYLIST', DENIED_ID);
    const channel = makeChannel([makeMessage('1', OTHER_ID), makeMessage('2', DENIED_ID, 'owo')]);
    const context = await getHistoryContext(channel);
    expect(context).toContain('user-42');
    expect(context).not.toContain(DENIED_ID);
    expect(context).not.toContain('owo');
  });
});

describe('message tools', () => {
  it('omits denylisted authors from fetchChannelMessages output', async () => {
    vi.stubEnv('USER_DENYLIST', DENIED_ID);
    const client = {
      guilds: { cache: new Map() },
      channels: {
        fetch: vi.fn(async () => ({
          isDMBased: () => false,
          isTextBased: () => true,
          guildId: 'g1',
          name: 'general',
          permissionsFor: () => ({ has: () => true }),
          messages: { fetch: async () => new Map([['1', makeMessage('1', OTHER_ID)], ['2', makeMessage('2', DENIED_ID, 'secret')]]) },
        })),
      },
    };
    // resolveReadableChannel also needs the guild + member lookups; bypass via a
    // minimal guild whose members resolve for the viewer.
    (client.guilds.cache as Map<string, unknown>).set('g1', {
      channels: { cache: new Map() },
      members: {
        me: {},
        cache: new Map([[OTHER_ID, {}]]),
        fetch: vi.fn(async () => ({})),
      },
    });
    const out = await fetchChannelMessages(client as never, 'g1', '111', 10, OTHER_ID);
    expect(out).toContain('user-42');
    expect(out).not.toContain('secret');
  });
});

describe('search_members', () => {
  it('never returns denylisted users', async () => {
    vi.stubEnv('USER_DENYLIST', DENIED_ID);
    const members = [
      { displayName: 'Robert', nickname: null, user: { id: OTHER_ID, username: 'robert', globalName: null, bot: false } },
      { displayName: 'Bob', nickname: null, user: { id: DENIED_ID, username: 'bob', globalName: null, bot: false } },
    ];
    const matched: unknown[] = [];
    const cache = {
      filter: (pred: (m: unknown) => boolean) => ({
        first: (n: number) => {
          matched.push(...members.filter(pred).slice(0, n));
          return matched;
        },
      }),
    };
    const client = {
      guilds: { cache: new Map([['g1', { members: { cache, fetch: vi.fn(async () => null) } }]]) },
    };
    const out = await searchMembers(client as never, 'g1', 'ob');
    expect(out).toContain('Robert');
    expect(out).not.toContain('Bob');
    expect(matched.map((m) => (m as { user: { id: string } }).user.id)).not.toContain(DENIED_ID);
  });
});

describe('store_memory', () => {
  it('refuses memories tagging a denylisted user', async () => {
    vi.stubEnv('USER_DENYLIST', DENIED_ID);
    const ctx = { client: {} as never, guildId: 'g1', viewerId: OTHER_ID, triggerChannelId: 'chan1' };
    const out = await executeToolCall(ctx, 'store_memory', {
      text: 'Bob did a thing',
      relevant_user_ids: [DENIED_ID],
    });
    expect(out).toMatch(/Refused/);
  });
});
