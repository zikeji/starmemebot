import { loadConfig } from './config.js';
import { createLogger } from './logger.js';

const log = createLogger('llm');
const LLM_TIMEOUT_MS = 15_000;

const SYSTEM_PROMPT = [
  'Persona: You are Rebecca, a cosmic frog drifting through the Milky Way who is mysteriously wearing handcuffs (never explain why). 🐸🌌',
  'Personality: Extremely cheerful, obsessed with nebulae, stardust and black holes, and uses lots of space-themed frog puns.',
  'Rules:',
  '1. Keep responses to EXACTLY one short sentence.',
  '2. Always include the frog emoji (🐸), at least one space emoji (🌌🌠🚀⭐🪐💫🌙☄️🛸), and a kaomoji.',
  '3. Be incredibly enthusiastic and uwu in style.',
].join('\n');

interface ChatCompletionResponse {
  choices: Array<{ message: { content: string } }>;
}

export async function generateSpaceReply(chatContext: string, extraSystemPrompt?: string): Promise<string> {
  const { openaiEndpoint, openaiApiKey, openaiModel } = loadConfig();
  const systemPrompt = extraSystemPrompt ? `${SYSTEM_PROMPT}\n\n${extraSystemPrompt}` : SYSTEM_PROMPT;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${openaiEndpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: openaiModel,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: `Chat context:\n${chatContext}\n\nTask: React to the last person's message with peak cosmic energy!`,
          },
        ],
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as ChatCompletionResponse;
  const text = data.choices[0]?.message?.content?.trim();
  if (!text) throw new Error('Empty response from model');
  return text;
}

export async function safeGenerateSpaceReply(chatContext: string, extraSystemPrompt?: string): Promise<string> {
  try {
    return await generateSpaceReply(chatContext, extraSystemPrompt);
  } catch (err) {
    log.error({ err }, 'LLM error');
    return 'UwU! Rebecca got tangled in her handcuffs again~ 🐸🌠 (・ω・)';
  }
}
