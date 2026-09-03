import MiniSearch from 'minisearch';
import { createLogger } from '../logger.js';
import { fetchWikiPages } from './fetcher.js';
import { loadConfig } from '../config.js';
import type { WikiSearchResult } from './types.js';

const log = createLogger('wiki');

const SNIPPET_CHARS = 300;

interface WikiSection {
  /** Unique index id: page path (#anchor suffix for heading sections). */
  path: string;
  title: string;
  content: string;
  url: string;
}

let index: MiniSearch<WikiSection> | null = null;
const sections = new Map<string, WikiSection>();
let state: 'not_started' | 'ready' | 'failed' = 'not_started';

export function getWikiStatus() {
  return state;
}

function slugify(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

/** Split a page into heading-anchored sections (plus one whole-page doc as fallback). */
function buildSections(page: { path: string; title: string; content: string; url: string }): WikiSection[] {
  const out: WikiSection[] = [];
  const lines = page.content.split('\n');
  const headingRe = /^(#{2,6})\s+(.+?)\s*#*$/;
  const slugCounts = new Map<string, number>();
  const uniqueSlug = (heading: string): string => {
    const base = slugify(heading);
    const n = slugCounts.get(base) ?? 0;
    slugCounts.set(base, n + 1);
    return n === 0 ? base : `${base}-${n}`;
  };
  let current: WikiSection = { path: page.path, title: page.title, content: '', url: page.url };
  for (const line of lines) {
    const match = line.match(headingRe);
    if (match) {
      out.push(current);
      const slug = uniqueSlug(match[2]);
      current = {
        path: `${page.path}#${slug}`,
        title: `${page.title} › ${match[2]}`,
        content: '',
        url: `${page.url}#${slug}`,
      };
    } else {
      current.content += line + '\n';
    }
  }
  out.push(current);
  // Very small sections carry no signal; keep any with real content.
  return out.filter((s) => s.title === page.title || s.content.trim().length > 20);
}

export async function initWiki(): Promise<void> {
  const { wikiRepo, wikiCacheDir } = loadConfig();
  try {
    const pages = await fetchWikiPages(wikiRepo, wikiCacheDir);
    sections.clear();
    const docs: WikiSection[] = [];
    for (const page of pages) {
      for (const section of buildSections(page)) {
        if (sections.has(section.path)) {
          log.warn({ path: section.path }, 'Duplicate wiki section id; skipping');
          continue;
        }
        sections.set(section.path, section);
        docs.push(section);
      }
    }
    index = new MiniSearch({
      fields: ['title', 'content'],
      storeFields: ['title', 'url'],
      idField: 'path',
    });
    index.addAll(docs);
    state = 'ready';
    log.info(`Wiki index ready (${pages.length} pages, ${docs.length} anchored sections)`);
  } catch (err) {
    state = 'failed';
    log.error({ err }, 'Wiki init failed');
  }
}

export function searchWiki(query: string, topK = 3): WikiSearchResult[] {
  if (!index) return [];
  const hits = index.search(query, { prefix: true, fuzzy: 0.2, boost: { title: 2 } }).slice(0, topK);
  return hits.map((hit) => {
    const section = sections.get(hit.id);
    const lower = section?.content.toLowerCase() ?? '';
    let snippetStart = 0;
    const firstTerm = query.trim().split(/\s+/)[0]?.toLowerCase();
    if (firstTerm && section) {
      const pos = lower.indexOf(firstTerm);
      if (pos > SNIPPET_CHARS) snippetStart = pos - SNIPPET_CHARS / 2;
    }
    const snippet = (section?.content ?? '')
      .slice(snippetStart, snippetStart + SNIPPET_CHARS)
      .replace(/\s+/g, ' ')
      .trim();
    return { title: hit.title, url: hit.url, score: hit.score, snippet };
  });
}
