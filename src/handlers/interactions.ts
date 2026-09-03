import { Client, Discord, On } from 'discordx';
import { Events, type Interaction } from 'discord.js';
import { createLogger } from '../logger.js';

const log = createLogger('interactions');

// discordx does not auto-route interactions; decorators only register metadata.
@Discord()
export class InteractionRouter {
  @On({ event: Events.InteractionCreate })
  async onInteraction([interaction]: [Interaction], client: Client): Promise<void> {
    try {
      await client.executeInteraction(interaction);
    } catch (err) {
      log.error({ err }, 'Interaction execution failed');
    }
  }
}
