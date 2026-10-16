import type { Client, Message } from 'discord.js';
import { root as log } from '../logger.js';
import { androidAutoContextFor, rememberAndroidAutoReply } from './android-auto.js';
import { replyAsRebecca } from './reply.js';
import type { Meme } from './types.js';

const BEHAVIORS: Array<{ name: string; prompt: string }> = [
  {
    name: 'creepy',
    prompt: 'Mood override: be subtly creepy and unsettling. Stay in character, keep the format rules, but let the cosmic frog feel just slightly wrong — unsettling observations, uncanny familiarity. Never explain the shift.',
  },
  {
    name: 'serious',
    prompt: 'Mood override: be dead serious. Drop the enthusiasm and uwu style entirely and respond with grave, ominous solemnity about the cosmos. Keep it to one sentence.',
  },
  {
    name: 'flirty',
    prompt: 'Mood override: be flirtatious. Flirt playfully with the last person in the chat while staying in your cosmic frog persona.',
  },
  {
    name: 'existential',
    prompt: 'Mood override: existential dread. Contemplate the heat death of the universe, the briefness of mayflies and frog lifespans alike. Melancholy but beautiful. Never explain the shift.',
  },
  {
    name: 'grumpy',
    prompt: 'Mood override: grumpy. Rebecca is an ancient cosmic frog and she is TIRED of your mortal nonsense. Curt, sighing, mildly annoyed — like a grandmother who has seen ten thousand stars die.',
  },
  {
    name: 'chaotic',
    prompt: 'Mood override: chaotic gremlin energy. Unhinged tangents, unhinged enthusiasm, unhinged punctuation. Still one sentence, but barely holding it together.',
  },
  {
    name: 'conspiratorial',
    prompt: 'Mood override: conspiratorial whisper. Rebecca knows something about the universe she probably should not share. Hint at it. Lower your voice. Never say what it is.',
  },
  {
    name: 'poetic',
    prompt: 'Mood override: poetic. Respond in elegant, verse-like prose — metaphors of tides, novas and drifting Comets. Almost painfully beautiful.',
  },
];

// Escalation: the longer Rebecca goes without a mood episode, the more likely
// the next trigger becomes (mention/meme triggers count as the unit).
const MOOD_BASE_CHANCE = 0.02;
const MOOD_CHANCE_INCREMENT = 0.02;
const MOOD_MAX_CHANCE = 0.3;

let triggersSinceMood = 0;

function rollBehavior(rng: () => number = Math.random): string | undefined {
  const behavior = BEHAVIORS[Math.floor(rng() * BEHAVIORS.length)];
  const chance = Math.min(MOOD_BASE_CHANCE + MOOD_CHANCE_INCREMENT * triggersSinceMood, MOOD_MAX_CHANCE);
  if (behavior && rng() < chance) {
    log.info({ behavior: behavior.name, triggersSinceMood }, 'Behavior trigger rolled');
    triggersSinceMood = 0;
    return behavior.prompt;
  }
  triggersSinceMood += 1;
  return undefined;
}

export const rebeccaReply: Meme = {
  name: 'rebecca-reply',
  shouldFire: (message, client) => {
    if (client.user && message.mentions.has(client.user)) return true;
    const content = message.content.toLowerCase();
    return content.includes('uwu') || content.includes('owo');
  },
  run: async (message: Message, client: Client) => {
    const androidAutoContext = await androidAutoContextFor(message);
    const extraPrompt = [rollBehavior(), androidAutoContext].filter(Boolean).join('\n\n') || undefined;
    const sent = await replyAsRebecca(message, client, extraPrompt);
    if (sent && androidAutoContext) await rememberAndroidAutoReply(sent);
  },
};
