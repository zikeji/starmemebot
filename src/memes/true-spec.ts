import type { Message } from 'discord.js';
import type { Meme } from './types.js';

const TrueSpec = '<:TrueSpec:1544080128768872469>';
const TRIGGER_CHANCE = 0.25;

export const trueSpec: Meme = {
  name: 'true-spec',
  shouldFire: (message, _client, rng) =>
    message.content.toLowerCase().includes('cable') && rng() < TRIGGER_CHANCE,
  run: async (message: Message) => {
    await message.react(TrueSpec);
  },
};
