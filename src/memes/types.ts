import type { Client, Message } from 'discord.js';

export interface Meme {
  name: string;
  shouldFire(message: Message, rng: () => number): boolean;
  run(message: Message, client: Client): Promise<void>;
}
