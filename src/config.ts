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
  /** Proactive 7.0 corrections; off unless CORRECTIONS_ENABLED is truthy. */
  correctionsEnabled: boolean;
  /** Channel or category IDs where proactive corrections may fire; threads inherit their parent. */
  correctionChannels: string[];
  /** Members holding any of these roles never trigger corrections and can cancel them by answering. */
  trustedRoleIds: string[];
  /** User IDs allowed to clear the self-learning collection. */
  botMaintainerIds: string[];
  /** JSONL file backing the self-learning collection. */
  selfLearningFile: string;
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

  const channelDenylist = parseIdList(process.env.CHANNEL_DENYLIST);
  const userDenylist = parseIdList(process.env.USER_DENYLIST);

  return {
    token,
    openaiEndpoint,
    openaiApiKey,
    openaiModel,
    channelDenylist,
    userDenylist,
    wikiRepo: process.env.WIKI_REPO || 'StarPilotHQ/docs',
    wikiCacheDir: process.env.WIKI_CACHE_DIR || 'data/wiki',
    openaiVision: process.env.OPENAI_VISION === 'true',
    embeddingModel: process.env.EMBEDDING_MODEL || 'baai/bge-base-en-v1.5',
    memoryFile: process.env.MEMORY_FILE || 'data/memories.jsonl',
    correctionsEnabled: isTruthy(process.env.CORRECTIONS_ENABLED),
    correctionChannels: parseIdList(process.env.CORRECTION_CHANNELS),
    trustedRoleIds: parseIdList(process.env.TRUSTED_ROLE_IDS),
    botMaintainerIds: parseIdList(process.env.BOT_MAINTAINER_IDS),
    selfLearningFile: process.env.SELF_LEARNING_FILE || 'data/self-learning.jsonl',
  };
}

function parseIdList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

function isTruthy(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes((value ?? '').trim().toLowerCase());
}

export function isUserDenylisted(userId: string): boolean {
  return loadConfig().userDenylist.includes(userId);
}
