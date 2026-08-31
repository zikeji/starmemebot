import type { Message } from 'discord.js';
import type { Meme } from './types.js';

const CYAN_REACTION = ['🩵', '🧑‍🦯'];
const TRIGGER_CHANCE = 0.1;

export const cyan: Meme = {
  name: 'cyan',
  shouldFire: (message, rng) =>
    message.content.toLowerCase().includes('cyan') && rng() < TRIGGER_CHANCE,
  run: async (message: Message) => {
    for (const emoji of CYAN_REACTION) {
      await message.react(emoji);
    }
  },
};
