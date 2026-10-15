import type { Message } from 'discord.js';
import { createLogger } from '../logger.js';
import type { Meme } from './types.js';

const log = createLogger('unicorn');
const LisaFrankUnicorn = '<:Lisa_Frank_Unicorn:1557149001701134347>';
const MIN_COOLDOWN_MESSAGES = 4;
const MAX_COOLDOWN_MESSAGES = 10;
const COOLDOWN_RESET_MS = 15 * 60 * 1000;

interface ChannelCooldown {
  needed: number;
  seen: number;
  lastAt: number;
}

export class UnicornCooldown {
  private channels = new Map<string, ChannelCooldown>();

  recordAndCheck(channelId: string, now: number = Date.now(), rng: () => number = Math.random): boolean {
    const state = this.channels.get(channelId);
    if (state) {
      state.seen += 1;
      if (state.seen < state.needed && now - state.lastAt < COOLDOWN_RESET_MS) return false;
    }
    const span = MAX_COOLDOWN_MESSAGES - MIN_COOLDOWN_MESSAGES + 1;
    this.channels.set(channelId, {
      needed: MIN_COOLDOWN_MESSAGES + Math.floor(rng() * span),
      seen: 0,
      lastAt: now,
    });
    return true;
  }
}

const cooldown = new UnicornCooldown();

export const unicorn: Meme = {
  name: 'unicorn',
  shouldFire: (message) => message.content.toLowerCase().includes('unicorn'),
  run: async (message: Message) => {
    if (!cooldown.recordAndCheck(message.channelId)) return;
    log.info({ channelId: message.channelId }, 'Unicorn reaction triggered');
    await message.react(LisaFrankUnicorn);
  },
};
