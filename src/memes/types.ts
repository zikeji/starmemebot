import type { Client, Message } from 'discord.js';

export interface Meme {
  name: string;
  shouldFire(message: Message, client: Client, rng: () => number): boolean;
  run(message: Message, client: Client): Promise<void>;
}
