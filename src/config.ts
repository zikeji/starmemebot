import dotenv from 'dotenv';
dotenv.config();

export interface BotConfig {
  token: string;
  openaiEndpoint: string;
  openaiApiKey: string;
  openaiModel: string;
  /** Comma-separated channel IDs the LLM tools may never read (history context is unaffected). */
  channelDenylist: string[];
  /** GitHub repo (owner/name) backing https://wiki.firestar.link — must have a docs/ dir of markdown. */
  wikiRepo: string;
  wikiCacheDir: string;
  /**
   * Manual override for image input support. Only consulted when the endpoint's
   * /models listing doesn't expose capability info.
   */
  openaiVision: boolean;
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

  const channelDenylist = (process.env.CHANNEL_DENYLIST ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

  return {
    token,
    openaiEndpoint,
    openaiApiKey,
    openaiModel,
    channelDenylist,
    wikiRepo: process.env.WIKI_REPO || 'StarPilot-Docs/docs',
    wikiCacheDir: process.env.WIKI_CACHE_DIR || 'data/wiki',
    openaiVision: process.env.OPENAI_VISION === 'true',
  };
}
