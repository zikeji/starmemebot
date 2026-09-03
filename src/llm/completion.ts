export const LLM_TIMEOUT_MS = 15_000;
export const MAX_OUTPUT_TOKENS = 400;
export const MAX_TOOL_ROUNDS = 3;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentPart[];
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ChatCompletionResponse {
  choices: Array<{
    message: ChatMessage & { content: string | null };
    finish_reason: string;
  }>;
}

export function buildUserContent(text: string, images: string[]): string | ContentPart[] {
  if (images.length === 0) return text;
  return [{ type: 'text', text }, ...images.map((url) => ({ type: 'image_url' as const, image_url: { url } }))];
}

export async function complete(
  endpoint: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  tools: readonly unknown[] | undefined,
  opts: { timeoutMs?: number; maxTokens?: number } = {},
): Promise<ChatCompletionResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? LLM_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${endpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        tools,
        tool_choice: 'auto',
        max_tokens: opts.maxTokens ?? MAX_OUTPUT_TOKENS,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) {
    const body = await res.text();
    throw Object.assign(new Error(`API error ${res.status}: ${body}`), { status: res.status });
  }
  return (await res.json()) as ChatCompletionResponse;
}
