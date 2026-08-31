import { Client, Discord, On, Once } from 'discordx';
import { Events, type Message } from 'discord.js';
import { REACTION_EMOJI, ReactionRoller } from '../roller.js';
import { getHistoryContext } from '../history.js';
import { safeGenerateSpaceReply } from '../llm.js';
import { createLogger } from '../logger.js';

const log = createLogger('reactions');
const roller = new ReactionRoller();

@Discord()
export class MemeReactions {
  @Once({ event: Events.ClientReady })
  async ready([client]: [Client]): Promise<void> {
    log.info(`Logged in as ${client.user!.tag}`);
    log.info(`Bot is in ${client.guilds.cache.size} guild(s):`);
    for (const guild of client.guilds.cache.values()) {
      log.info(`  - ${guild.name} (${guild.id})`);
    }
  }

  @On({ event: Events.MessageCreate })
  async onMessage([message]: [Message], client: Client): Promise<void> {
    if (message.author.bot || !message.guild || !message.channel.isTextBased()) return;

    const content = message.content.toLowerCase();
    log.debug(
      { guildId: message.guildId, channelId: message.channelId, author: message.author.username, content: message.content },
      'Message seen',
    );

    if (content.includes('uwu') || content.includes('owo')) {
      log.info({ channelId: message.channelId, author: message.author.username }, 'uwu/owo detected, replying');
      try {
        await this.replySpace(message, client);
      } catch (err) {
        log.error({ err }, 'Failed to reply');
      }
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
