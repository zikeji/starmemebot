import type { Message } from 'discord.js';
import { createLogger } from '../logger.js';

const log = createLogger('llm:vision');

const MAX_IMAGES = 3;
const SUMMARY_MAX_IMAGES = 8;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const TOTAL_IMAGE_BUDGET_BYTES = 12 * 1024 * 1024;

let visionSupportCache: boolean | null = null;
let visionProbePromise: Promise<boolean> | null = null;

export async function modelSupportsVision(
  endpoint: string,
  apiKey: string,
  model: string,
  fallback: boolean,
): Promise<boolean> {
  if (visionSupportCache !== null) return visionSupportCache;
  if (!visionProbePromise) {
    visionProbePromise = probeVision(endpoint, apiKey, model, fallback)
      .then((supported) => {
        visionSupportCache = supported;
        return supported;
      })
      .catch((err) => {
        // Never let a failed probe poison the single-flight promise.
        visionProbePromise = null;
        throw err;
      });
  }
  return visionProbePromise;
}

async function probeVision(endpoint: string, apiKey: string, model: string, fallback: boolean): Promise<boolean> {
  try {
    const res = await fetch(`${endpoint}/models`, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (res.ok) {
      const data = (await res.json()) as { data?: Array<{ id: string; architecture?: { modality?: string } }> };
      const entry = data.data?.find((m) => m.id === model);
      const inputModality = entry?.architecture?.modality?.split('->')[0] ?? '';
      return inputModality.includes('image') ? true : (log.info({ model }, 'Model listing has no image input capability; falling back to config'), fallback);
    }
    log.info({ status: res.status }, 'Models endpoint unavailable; falling back to config for vision support');
  } catch (err) {
    log.info({ err }, 'Models endpoint probe failed; falling back to config for vision support');
  }
  return fallback;
}

interface ImageAttachment {
  contentType: string | null;
  size: number;
  url: string;
}

async function downloadImageAttachments(attachments: ImageAttachment[], max: number): Promise<string[]> {
  const dataUrls: string[] = [];
  for (const attachment of attachments.slice(0, max)) {
    const res = await fetch(attachment.url).catch(() => null);
    if (!res?.ok) {
      log.warn({ url: attachment.url, status: res?.status }, 'Failed to download image attachment');
      continue;
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    dataUrls.push(`data:${attachment.contentType};base64,${buffer.toString('base64')}`);
  }
  if (dataUrls.length > 0) {
    log.info({ count: dataUrls.length }, 'Attaching Discord images to LLM request');
  }
  return dataUrls;
}

export async function collectImageAttachments(message: Message, enabled: boolean): Promise<string[]> {
  if (!enabled) return [];
  const attachments = [...message.attachments.values()].filter(
    (a) => a.contentType?.startsWith('image/') && a.size <= MAX_IMAGE_BYTES,
  );
  if (attachments.length === 0) return [];
  return downloadImageAttachments(attachments, MAX_IMAGES);
}

export async function collectImagesFromMessages(
  messages: Array<{ attachments: Map<string, ImageAttachment> }>,
  enabled: boolean,
): Promise<string[]> {
  if (!enabled) return [];
  const candidates = messages
    .flatMap((m) => [...m.attachments.values()])
    .filter((a) => a.contentType?.startsWith('image/') && a.size <= MAX_IMAGE_BYTES);
  // Base64 inflates by ~4/3; budget raw bytes so the request body stays sane.
  let budget = TOTAL_IMAGE_BUDGET_BYTES;
  const withinBudget = candidates.filter((a) => {
    if (budget - a.size < 0) return false;
    budget -= a.size;
    return true;
  });
  return downloadImageAttachments(withinBudget, SUMMARY_MAX_IMAGES);
}
