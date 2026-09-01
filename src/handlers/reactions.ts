import { readFileSync } from 'node:fs';
import { Client, Discord, On, Once } from 'discordx';
import { ActivityType, Events, type Message } from 'discord.js';
import { memes } from '../memes/index.js';
import { createLogger } from '../logger.js';
import { initWiki } from '../wiki/wiki.js';

const log = createLogger('memes');

function getCommitHash(): string | null {
  const fromEnv = process.env.COMMIT_SHA;
  if (fromEnv) return fromEnv.slice(0, 7);
  try {
    const head = readFileSync('.git/HEAD', 'utf-8').trim();
    if (head.startsWith('ref: ')) {
      const refPath = '.git/' + head.slice(5);
      return readFileSync(refPath, 'utf-8').trim().slice(0, 7);
    }
    return head.slice(0, 7);
  } catch {
    return null;
  }
}

@Discord()
export class MemeReactions {
  @Once({ event: Events.ClientReady })
  async ready([client]: [Client]): Promise<void> {
    log.info(`Logged in as ${client.user!.tag}`);
    log.info(`Bot is in ${client.guilds.cache.size} guild(s):`);
    for (const guild of client.guilds.cache.values()) {
      log.info(`  - ${guild.name} (${guild.id})`);
    }

    const commitHash = getCommitHash();
    if (commitHash) {
      client.user!.setActivity({ name: commitHash, type: ActivityType.Watching });
    }

    void initWiki();
  }

  @On({ event: Events.MessageCreate })
  async onMessage([message]: [Message], client: Client): Promise<void> {
    if (message.author.bot || !message.guild || !message.channel.isTextBased()) return;

    for (const meme of memes) {
      if (!meme.shouldFire(message, client, Math.random)) continue;
      if (!meme.isFallback) {
        log.debug(
          { meme: meme.name, channelId: message.channelId, author: message.author.username, content: message.content },
          'Meme triggered',
        );
      }
      try {
        await meme.run(message, client);
      } catch (err) {
        log.error({ err, meme: meme.name }, 'Failed to run meme');
      }
      return;
    }
  }
}
