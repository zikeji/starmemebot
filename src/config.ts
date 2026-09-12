import dotenv from 'dotenv';
dotenv.config();

export interface BotConfig {
  token: string;
  openaiEndpoint: string;
  openaiApiKey: string;
  openaiModel: string;
  /** Comma-separated channel IDs the LLM tools may never read (history context is unaffected). */
  channelDenylist: string[];
  /** Comma-separated user IDs Rebecca ignores entirely: no memes, no replies, and they are erased from all context/tools. */
  userDenylist: string[];
  /** GitHub repo (owner/name) backing https://wiki.firestar.link — must have a docs/ dir of markdown. */
  wikiRepo: string;
  wikiCacheDir: string;
  /**
   * Manual override for image input support. Only consulted when the endpoint's
   * /models listing doesn't expose capability info.
   */
  openaiVision: boolean;
  /** OpenAI-compatible embedding model for memory search. Pick-once: baked into stored vectors. */
  embeddingModel: string;
  /** JSONL file backing the memory store. */
  memoryFile: string;
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

  const userDenylist = (process.env.USER_DENYLIST ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

  return {
    token,
    openaiEndpoint,
    openaiApiKey,
    openaiModel,
    channelDenylist,
    userDenylist,
    wikiRepo: process.env.WIKI_REPO || 'StarPilot-Docs/docs',
    wikiCacheDir: process.env.WIKI_CACHE_DIR || 'data/wiki',
    openaiVision: process.env.OPENAI_VISION === 'true',
    embeddingModel: process.env.EMBEDDING_MODEL || 'baai/bge-base-en-v1.5',
    memoryFile: process.env.MEMORY_FILE || 'data/memories.jsonl',
  };
}

export function isUserDenylisted(userId: string): boolean {
  return loadConfig().userDenylist.includes(userId);
}
