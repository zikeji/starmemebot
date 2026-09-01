import MiniSearch from 'minisearch';
import { createLogger } from '../logger.js';
import { fetchWikiPages } from './fetcher.js';
import { loadConfig } from '../config.js';
import type { WikiPage, WikiSearchResult } from './types.js';

const log = createLogger('wiki');

const SNIPPET_CHARS = 300;

let index: MiniSearch<WikiPage> | null = null;
let pages: WikiPage[] = [];
let state: 'not_started' | 'ready' | 'failed' = 'not_started';

export function getWikiStatus() {
  return state;
}

export async function initWiki(): Promise<void> {
  const { wikiRepo, wikiCacheDir } = loadConfig();
  try {
    pages = await fetchWikiPages(wikiRepo, wikiCacheDir);
    index = new MiniSearch({
      fields: ['title', 'content'],
      storeFields: ['title', 'url', 'path'],
    });
    index.addAll(pages.map((p) => ({ ...p })));
    state = 'ready';
    log.info(`Wiki index ready (${pages.length} pages)`);
  } catch (err) {
    state = 'failed';
    log.error({ err }, 'Wiki init failed');
  }
}

export function searchWiki(query: string, topK = 3): WikiSearchResult[] {
  if (!index) return [];
  const hits = index.search(query, { prefix: true, fuzzy: 0.2, boost: { title: 2 } }).slice(0, topK);
  return hits.map((hit) => {
    const page = pages.find((p) => p.path === hit.id);
    const lower = page?.content.toLowerCase() ?? '';
    let snippetStart = 0;
    const firstTerm = query.trim().split(/\s+/)[0]?.toLowerCase();
    if (firstTerm && page) {
      const pos = lower.indexOf(firstTerm);
      if (pos > SNIPPET_CHARS) snippetStart = pos - SNIPPET_CHARS / 2;
    }
    const snippet = (page?.content ?? '')
      .slice(snippetStart, snippetStart + SNIPPET_CHARS)
      .replace(/\s+/g, ' ')
      .trim();
    return { title: hit.title, url: hit.url, score: hit.score, snippet };
  });
}
