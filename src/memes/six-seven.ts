import type { Message } from 'discord.js';
import { REACTION_EMOJI, ReactionRoller } from '../roller.js';
import { createLogger } from '../logger.js';
import type { Meme } from './types.js';

const log = createLogger('six-seven');
const roller = new ReactionRoller();

export const sixSeven: Meme = {
  name: 'six-seven',
  isFallback: true,
  shouldFire: () => true,
  run: async (message: Message) => {
    const reaction = roller.recordAndRoll(message.channelId);
    if (!reaction) return;
    log.info({ channelId: message.channelId, reaction }, 'Meme reaction triggered');
    for (const emoji of REACTION_EMOJI[reaction]) {
      await message.react(emoji);
    }
  },
};
