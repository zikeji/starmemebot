import { Client, Discord, On } from 'discordx';
import { Events, type Message } from 'discord.js';
import { observeMessage } from '../corrections/watcher.js';
import { createLogger } from '../logger.js';
import { captureTrustedReply } from '../self-learning/trusted-replies.js';

const log = createLogger('corrections');

@Discord()
export class CorrectionWatcher {
  @On({ event: Events.MessageCreate })
  async onMessage([message]: [Message], client: Client): Promise<void> {
    await captureTrustedReply(message, client).catch((err) => log.error({ err }, 'Failed to capture trusted reply'));
    try {
      await observeMessage(message, client);
    } catch (err) {
      log.error({ err }, 'Correction watcher failed');
    }
  }
}
