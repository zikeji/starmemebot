import type { Client, Message } from 'discord.js';
import { isUserDenylisted, loadConfig } from '../config.js';
import { isDenylistedWithAncestors } from '../llm/tools.js';
import { createLogger } from '../logger.js';
import { appendEntry } from './store.js';

const log = createLogger('self-learning');

export async function captureTrustedReply(message: Message, client: Client): Promise<void> {
  const { trustedRoleIds } = loadConfig();
  if (trustedRoleIds.length === 0 || message.author.bot || !message.guildId) return;
  if (!message.reference?.messageId || message.mentions.repliedUser?.id !== client.user?.id) return;
  if (isUserDenylisted(message.author.id)) return;
  if (!message.member?.roles.cache.some((r) => trustedRoleIds.includes(r.id))) return;
  if (await isDenylistedWithAncestors(client, message.guildId, message.channelId)) return;
  const rebecca = await message.fetchReference().catch(() => null);
  if (!rebecca) return;
  await appendEntry({
    kind: 'trusted-reply',
    guildId: message.guildId,
    channelId: message.channelId,
    messageId: message.id,
    authorId: message.author.id,
    reply: message.content,
    rebeccaMessageId: rebecca.id,
    rebeccaText: rebecca.content,
  });
  log.info({ messageId: message.id, authorId: message.author.id }, 'Trusted reply to Rebecca captured');
}
