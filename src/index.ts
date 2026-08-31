import { Client } from 'discordx';
import { DiscordAPIError, IntentsBitField } from 'discord.js';
import { loadConfig } from './config.js';
import { root as log } from './logger.js';
import './handlers/reactions.js';

const config = loadConfig();

const client = new Client({
  intents: [
    IntentsBitField.Flags.Guilds,
    IntentsBitField.Flags.GuildMessages,
    IntentsBitField.Flags.MessageContent,
  ],
  silent: true,
});

client.login(config.token).catch((err) => {
  log.fatal({ err }, 'Login failed');
  process.exit(1);
});

function shutdown() {
  log.info('Shutting down...');
  client.destroy();
  process.exit(0);
}

process.on('unhandledRejection', (err) => {
  if (err instanceof DiscordAPIError) {
    log.error({ err }, 'Unhandled DiscordAPIError (non-fatal)');
    return;
  }
  log.fatal({ err }, 'Unhandled rejection');
  shutdown();
});

process.on('uncaughtException', (err) => {
  log.fatal({ err }, 'Uncaught exception');
  shutdown();
});

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
