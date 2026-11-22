import { Client, Discord, On } from 'discordx';
import { Events, type Message } from 'discord.js';
import { observeMessage } from '../corrections/watcher.js';
import { createLogger } from '../logger.js';

const log = createLogger('corrections');

@Discord()
export class CorrectionWatcher {
  @On({ event: Events.MessageCreate })
  async onMessage([message]: [Message], client: Client): Promise<void> {
    try {
      await observeMessage(message, client);
    } catch (err) {
      log.error({ err }, 'Correction watcher failed');
    }
  }
}
