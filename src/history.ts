import type { TextBasedChannel } from 'discord.js';

const HISTORY_LIMIT = 20;
export async function getHistoryContext(channel: TextBasedChannel, tokenLimit = 1000): Promise<string> {
  const messages = await channel.messages.fetch({ limit: HISTORY_LIMIT });
  const lines = [...messages.values()]
    .reverse()
    .map((m) => `${m.author.username}: ${m.content}`)
    .filter((line) => line.trim().length > 0);

  const maxChars = tokenLimit * 4;
  let context = lines.join('\n');
  while (context.length > maxChars && lines.length > 1) {
    lines.shift();
    context = lines.join('\n');
  }
  return context;
}
