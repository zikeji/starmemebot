import type { Message } from 'discord.js';
import { ReactionRoller } from '../roller.js';
import { createLogger } from '../logger.js';
import type { Meme } from './types.js';

const log = createLogger('erich');
const PIN = '📌';
const roller = new ReactionRoller(1);

export const erich: Meme = {
  name: 'erich',
  shouldFire: (message) => message.content.toLowerCase().includes('erich'),
  run: async (message: Message) => {
    const reaction = roller.recordAndRoll(message.channelId);
    if (!reaction) return;
    log.info({ channelId: message.channelId }, 'Pin reaction triggered');
    await message.react(PIN);
  },
};
