import type { Client, Message } from 'discord.js';

export function isRebeccaSummoned(message: Message, client: Client): boolean {
  if (client.user && message.mentions.has(client.user)) return true;
  const content = message.content.toLowerCase();
  return content.includes('uwu') || content.includes('owo');
}
