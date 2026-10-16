import type { Message } from 'discord.js';
import { describe, expect, it } from 'vitest';
import {
  androidAutoContextFor,
  ChannelCooldown,
  isAndroidAutoReply,
  mentionsAndroidAuto,
  rememberAndroidAutoReply,
} from '../src/memes/android-auto.js';

const MINUTE = 60 * 1000;

describe('mentionsAndroidAuto', () => {
  it.each(['android auto when', 'ANDROID AUTO', 'Android-Auto pls', 'androidauto', 'android  auto'])(
    'matches %s',
    (content) => expect(mentionsAndroidAuto(content)).toBe(true),
  );

  it.each(['android phone', 'auto lane change', 'my android does auto updates', 'Android Automotive', 'android automatically updates'])('ignores %s', (content) =>
    expect(mentionsAndroidAuto(content)).toBe(false),
  );
});

describe('ChannelCooldown', () => {
  it('is ready before anything fired', () => {
    expect(new ChannelCooldown(10 * MINUTE).isReady('c1', 0)).toBe(true);
  });

  it('blocks the same channel until the cooldown elapses', () => {
    const cooldown = new ChannelCooldown(10 * MINUTE);
    cooldown.start('c1', 0);
    expect(cooldown.isReady('c1', 9 * MINUTE)).toBe(false);
    expect(cooldown.isReady('c1', 10 * MINUTE)).toBe(true);
  });

  it('tracks channels independently', () => {
    const cooldown = new ChannelCooldown(10 * MINUTE);
    cooldown.start('c1', 0);
    expect(cooldown.isReady('c2', 0)).toBe(true);
  });
});

describe('Android Auto reply tracking', () => {
  it('recognizes remembered replies', async () => {
    await rememberAndroidAutoReply({ id: 'm1', channelId: 'c1' });
    expect(await isAndroidAutoReply('m1')).toBe(true);
    expect(await isAndroidAutoReply('m2')).toBe(false);
  });
});

function fakeMessage(content: string, repliedTo?: { id: string; content?: string }): Message {
  return {
    content,
    reference: repliedTo ? { messageId: repliedTo.id } : null,
    fetchReference: async () => {
      if (repliedTo?.content === undefined) throw new Error('Unknown Message');
      return { content: repliedTo.content };
    },
  } as unknown as Message;
}

describe('androidAutoContextFor', () => {
  it('attaches when the message mentions Android Auto', async () => {
    expect(await androidAutoContextFor(fakeMessage('does android auto work wired?'))).toBeDefined();
  });

  it('skips unrelated messages that are not replies', async () => {
    expect(await androidAutoContextFor(fakeMessage('hi rebecca'))).toBeUndefined();
  });

  it('attaches when replying to a remembered Android Auto reply', async () => {
    await rememberAndroidAutoReply({ id: 'aa-reply', channelId: 'c1' });
    expect(await androidAutoContextFor(fakeMessage('so no carplay?', { id: 'aa-reply' }))).toBeDefined();
  });

  it('attaches when replying to a message that mentions Android Auto', async () => {
    const message = fakeMessage('same question', { id: 'other', content: 'is android auto out yet' });
    expect(await androidAutoContextFor(message)).toBeDefined();
  });

  it('skips replies to unrelated messages', async () => {
    const message = fakeMessage('lol', { id: 'other-2', content: 'nice weather' });
    expect(await androidAutoContextFor(message)).toBeUndefined();
  });

  it('skips replies whose referenced message cannot be fetched', async () => {
    expect(await androidAutoContextFor(fakeMessage('what?', { id: 'deleted' }))).toBeUndefined();
  });
});
