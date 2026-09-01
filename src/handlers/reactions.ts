import { Client, Discord, On, Once } from 'discordx';
import { Events, type Message } from 'discord.js';
import { memes } from '../memes/index.js';
import { createLogger } from '../logger.js';

const log = createLogger('memes');

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

    log.debug(
      { guildId: message.guildId, channelId: message.channelId, author: message.author.username, content: message.content },
      'Message seen',
    );

    for (const meme of memes) {
      if (!meme.shouldFire(message, client, Math.random)) continue;
      try {
        await meme.run(message, client);
      } catch (err) {
        log.error({ err, meme: meme.name }, 'Failed to run meme');
      }
      return;
    }
  }
}
