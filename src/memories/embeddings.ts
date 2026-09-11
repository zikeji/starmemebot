import { loadConfig } from '../config.js';
import { createLogger } from '../logger.js';

const log = createLogger('memories:embed');

export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const { openaiEndpoint, openaiApiKey, embeddingModel } = loadConfig();
  const res = await fetch(`${openaiEndpoint}/embeddings`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openaiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: embeddingModel, input: texts }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw Object.assign(new Error(`Embeddings API error ${res.status}: ${await res.text()}`), {
      status: res.status,
    });
  }
  const data = (await res.json()) as { data: Array<{ embedding: number[] }> };
  const vectors = data.data.map((d) => d.embedding);
  if (vectors.length !== texts.length || vectors.some((v) => v.length === 0)) {
    throw new Error('Embeddings API returned a mismatched payload');
  }
  log.debug({ count: vectors.length, dims: vectors[0].length }, 'Embedded texts');
  return vectors;
}
