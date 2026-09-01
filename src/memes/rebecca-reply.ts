import type { Message } from 'discord.js';
import { getHistoryContext } from '../history.js';
import { safeGenerateSpaceReply } from '../llm.js';
import type { Meme } from './types.js';

const TYPING_INTERVAL_MS = 8_000;

export const rebeccaReply: Meme = {
  name: 'rebecca-reply',
  shouldFire: (message, client) => {
    if (client.user && message.mentions.has(client.user)) return true;
    const content = message.content.toLowerCase();
    return content.includes('uwu') || content.includes('owo');
  },
  run: async (message: Message) => {
    const history = await getHistoryContext(message.channel).catch(() => '');
    let typing = true;
    const keepTyping = (async () => {
      while (typing) {
        if (message.channel.isSendable()) await message.channel.sendTyping().catch(() => {});
        await new Promise((r) => setTimeout(r, TYPING_INTERVAL_MS));
      }
    })();
    try {
      const reply = await safeGenerateSpaceReply(history);
      await message.reply(reply);
    } finally {
      typing = false;
      await keepTyping;
    }
  },
};
