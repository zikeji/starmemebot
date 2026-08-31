import type { Client, Message } from 'discord.js';
import { getHistoryContext } from '../history.js';
import { safeGenerateSpaceReply } from '../llm.js';
import type { Meme } from './types.js';

export const rebeccaReply: Meme = {
  name: 'rebecca-reply',
  shouldFire: (message) => {
    const content = message.content.toLowerCase();
    return content.includes('uwu') || content.includes('owo');
  },
  run: async (message: Message, _client: Client) => {
    const history = await getHistoryContext(message.channel).catch(() => '');
    const reply = await safeGenerateSpaceReply(history);
    await message.reply(reply);
  },
};
