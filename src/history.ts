import type { Message, TextBasedChannel } from 'discord.js';

const HISTORY_LIMIT = 20;

export function formatMessageLine(m: Message): string {
  const displayName = m.member?.displayName ?? m.author.username;
  return `${displayName} (@${m.author.username}, id: ${m.author.id}, mention: <@${m.author.id}>): ${m.content}`;
}

export async function getHistoryContext(channel: TextBasedChannel, tokenLimit = 1000): Promise<string> {
  const messages = await channel.messages.fetch({ limit: HISTORY_LIMIT });
  const lines = [...messages.values()]
    .reverse()
    .filter((m) => m.content.trim().length > 0)
    .map(formatMessageLine);

  const maxChars = tokenLimit * 4;
  let context = lines.join('\n');
  while (context.length > maxChars && lines.length > 1) {
    lines.shift();
    context = lines.join('\n');
  }
  return context;
}
