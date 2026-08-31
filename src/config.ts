import dotenv from 'dotenv';
dotenv.config();

export interface BotConfig {
  token: string;
  openaiEndpoint: string;
  openaiApiKey: string;
  openaiModel: string;
}

export function loadConfig(): BotConfig {
  const token = process.env.DISCORD_TOKEN;
  if (!token) throw new Error('DISCORD_TOKEN is required');

  const openaiEndpoint = process.env.OPENAI_ENDPOINT;
  if (!openaiEndpoint) throw new Error('OPENAI_ENDPOINT is required');

  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) throw new Error('OPENAI_API_KEY is required');

  const openaiModel = process.env.OPENAI_MODEL;
  if (!openaiModel) throw new Error('OPENAI_MODEL is required');

  return { token, openaiEndpoint, openaiApiKey, openaiModel };
}
