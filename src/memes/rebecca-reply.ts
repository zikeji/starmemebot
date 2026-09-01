import type { Client, Message } from 'discord.js';
import { getHistoryContext } from '../history.js';
import { safeGenerateSpaceReply } from '../llm.js';
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
];

function rollBehavior(rng: () => number = Math.random): string | undefined {
  const behavior = BEHAVIORS[Math.floor(rng() * BEHAVIORS.length)];
  if (behavior && rng() < 0.01) {
    log.info({ behavior: behavior.name }, 'Behavior trigger rolled');
    return behavior.prompt;
  }
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
