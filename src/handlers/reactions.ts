import { Client, Discord, On } from 'discordx';
import type { Message } from 'discord.js';
import { REACTION_EMOJI, ReactionRoller } from '../roller.js';
import { getHistoryContext } from '../history.js';
import { safeGenerateSpaceReply } from '../llm.js';
import { createLogger } from '../logger.js';

const log = createLogger('reactions');
const roller = new ReactionRoller();

@Discord()
export class MemeReactions {
  @On({ event: 'messageCreate' })
  async onMessage([message]: [Message], client: Client): Promise<void> {
    if (message.author.bot || !message.guild || !message.channel.isTextBased()) return;

    const content = message.content.toLowerCase();
    if (content.includes('uwu') || content.includes('owo')) {
      await this.replySpace(message, client);
      return;
    }

    const reaction = roller.recordAndRoll(message.channelId);
    if (!reaction) return;
    log.info({ channelId: message.channelId, reaction }, 'Meme reaction triggered');
    for (const emoji of REACTION_EMOJI[reaction]) {
      await message.react(emoji);
    }
  }

  private async replySpace(message: Message, client: Client): Promise<void> {
    if (client.user && message.author.id === client.user.id) return;
    const history = await getHistoryContext(message.channel).catch(() => '');
    const reply = await safeGenerateSpaceReply(history);
    await message.reply(reply);
  }
}
