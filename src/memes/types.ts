import type { Client, Message } from 'discord.js';

export interface Meme {
  name: string;
  /** Matches every message; only dispatched last. Should not log a trigger. */
  isFallback?: boolean;
  shouldFire(message: Message, client: Client, rng: () => number): boolean;
  run(message: Message, client: Client): Promise<void>;
}
