import type { Client, Message } from 'discord.js';
import { getHistoryContext } from '../history.js';
import { safeGenerateSpaceReply } from '../llm/rebecca.js';
import { root as log } from '../logger.js';
import type { Meme } from './types.js';

const TYPING_INTERVAL_MS = 8_000;

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
const MOOD_BASE_CHANCE = 0.01;
const MOOD_CHANCE_INCREMENT = 0.01;
const MOOD_MAX_CHANCE = 0.15;

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
    const history = await getHistoryContext(message.channel).catch(() => '');
    let typing = true;
    const keepTyping = (async () => {
      while (typing) {
        if (message.channel.isSendable()) await message.channel.sendTyping().catch(() => {});
        await new Promise((r) => setTimeout(r, TYPING_INTERVAL_MS));
      }
    })();
    try {
      const extraPrompt = rollBehavior();
      const reply = await safeGenerateSpaceReply(history, { extraSystemPrompt: extraPrompt, client, triggerMessage: message });
      const sent = await message.reply(reply);
      // Discord generates link previews even for named markdown links; suppress them.
      await sent.suppressEmbeds().catch((err) => log.warn({ err }, 'Failed to suppress embeds'));
    } finally {
      typing = false;
      await keepTyping;
    }
  },
};
