/**
 * GDELT source adapter — Global Database of Events, Language and Tone.
 *
 * https://www.gdeltproject.org/ — public, free API, 15-min refresh.
 * Validates the multi-source architecture (VISION.md §6 — "微信之后的下一站").
 *
 * Use case: cross-validate WeChat-internal claims against global news.
 * Example: someone in a group claims "美军航母失火" — query GDELT for the
 * same event to see independent reporting and cross-source corroboration.
 *
 * GDELT Doc 2.0 API (no auth required):
 *   GET https://api.gdeltproject.org/api/v2/doc/doc?
 *       query=<terms>&format=json&maxrecords=20&timespan=7d
 *
 * Response shape:
 *   { articles: [{ url, title, seendate, domain, language, sourcecountry,
 *                  socialimage }, ...] }
 *
 * Mapping to our domain model:
 *   - Each article → WxObject (kind='link', sourceAdapter='gdelt')
 *   - Article ID = sha1(url) — stable across refetches
 *   - text field = title (the searchable content)
 *   - metadata = { url, domain, language, country, seendate }
 */

import type { SourceAdapter, SourceFetchOptions } from '../adapters/source';
import type { WxObject, AnyDomainEntity } from '../types/domain';
import { createHash } from 'crypto';

export interface GdeltArticle {
  url: string;
  title?: string;
  seendate?: string;            // GDELT format: YYYYMMDDHHMMSS
  domain?: string;
  language?: string;
  sourcecountry?: string;
  socialimage?: string;
}

export interface GdeltFetcher {
  /** Inject for testing; default uses global fetch. */
  (url: string): Promise<{ articles: GdeltArticle[] }>;
}

// GDELT public API enforces "≤1 request per 5 seconds". We track the last
// fetch timestamp module-globally so back-to-back invocations across
// command runs don't trip the rate limit.
let lastGdeltFetchAt = 0;
const GDELT_MIN_INTERVAL_MS = 5500;   // 5s + small safety margin

async function throttledGdeltFetch(url: string): Promise<Response> {
  const now = Date.now();
  const wait = lastGdeltFetchAt + GDELT_MIN_INTERVAL_MS - now;
  if (wait > 0) {
    await new Promise(resolve => setTimeout(resolve, wait));
  }
  lastGdeltFetchAt = Date.now();
  return fetch(url);
}

const DEFAULT_FETCHER: GdeltFetcher = async (url) => {
  let resp = await throttledGdeltFetch(url);
  if (resp.status === 429) {
    // Back off and retry once with a longer wait
    await new Promise(r => setTimeout(r, 6000));
    resp = await throttledGdeltFetch(url);
  }
  if (!resp.ok) throw new Error(`GDELT API ${resp.status}: ${(await resp.text().catch(() => '')).slice(0, 200)}`);
  // GDELT 2.0 returns plain-text error messages when the query is malformed
  // (e.g. "Your search expression is invalid"). Detect and surface those
  // before attempting JSON parse.
  const body = await resp.text();
  const trimmed = body.trim();
  if (!trimmed.startsWith('{')) {
    throw new Error(`GDELT query rejected: ${trimmed.slice(0, 200)}`);
  }
  let data: any;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error(`GDELT non-JSON response: ${body.slice(0, 200)}`);
  }
  return { articles: Array.isArray(data?.articles) ? data.articles : [] };
};

export interface GdeltSourceOptions {
  fetcher?: GdeltFetcher;
  /** Default time window in days for queries that don't specify one. */
  defaultTimespanDays?: number;
}

export class GdeltSource implements SourceAdapter {
  readonly id = 'gdelt';
  readonly displayName = 'GDELT (全球新闻事件库)';

  private fetcher: GdeltFetcher;
  private defaultTimespanDays: number;

  constructor(opts: GdeltSourceOptions = {}) {
    this.fetcher = opts.fetcher || DEFAULT_FETCHER;
    this.defaultTimespanDays = opts.defaultTimespanDays ?? 7;
  }

  async isReady(): Promise<boolean> {
    // GDELT public API requires no auth and is free — always "ready" in
    // principle. A real readiness check would ping the API, but we want
    // isReady() to be cheap (no network) — assume true and let actual
    // fetch errors surface naturally.
    return true;
  }

  capabilities() {
    return {
      hasVoice: false,
      hasImage: false,
      hasVideo: false,
      supportsLiveStream: true,    // 15-min update cadence, polling-friendly
    };
  }

  async *fetch(opts: SourceFetchOptions): AsyncIterable<AnyDomainEntity[]> {
    const query = String(opts.filter?.query || '').trim();
    if (!query) return;
    const maxRecords = Number(opts.filter?.maxrecords) || 20;
    const timespan = this.computeTimespan(opts);

    // GDELT's keyword tokenizer rejects short Chinese terms ("keyword too
    // short"). The caller must own the query — they can add modifiers like
    // `sourcelang:zho` (Chinese sources only), `sourcecountry:CH` (China),
    // or quoted phrases themselves. Auto-prepending `sourcelang:zho` was a
    // mistake (broke 2-char Chinese keywords).
    const explicitLang = opts.filter?.lang ? ` sourcelang:${String(opts.filter.lang)}` : '';
    const fullQuery = `${query}${explicitLang}`;

    const url = `https://api.gdeltproject.org/api/v2/doc/doc` +
      `?query=${encodeURIComponent(fullQuery)}` +
      `&format=json` +
      `&maxrecords=${maxRecords}` +
      `&timespan=${timespan}`;

    const { articles } = await this.fetcher(url);
    if (articles.length === 0) {
      yield [];
      return;
    }

    const objects: WxObject[] = articles.map((a) => this.articleToObject(a, query));
    yield objects;
  }

  /** Build a deterministic id from the URL so re-fetches deduplicate. */
  static articleId(url: string): string {
    const h = createHash('sha1').update(url).digest('hex').slice(0, 16);
    return `obj:gdelt:${h}`;
  }

  /** Internal: derive a GDELT timespan parameter from SourceFetchOptions. */
  private computeTimespan(opts: SourceFetchOptions): string {
    if (opts.since) {
      const days = Math.max(1, Math.ceil(
        (Date.now() - new Date(opts.since).getTime()) / 86_400_000,
      ));
      return `${days}d`;
    }
    return `${this.defaultTimespanDays}d`;
  }

  private articleToObject(a: GdeltArticle, query: string): WxObject {
    const url = a.url || '';
    const id = GdeltSource.articleId(url);
    const title = a.title || '(无标题)';
    const occurredAt = parseGdeltDate(a.seendate) || new Date().toISOString();

    const metadata: Record<string, string | number | boolean> = {
      url,
      query,
    };
    if (a.domain) metadata.domain = a.domain;
    if (a.language) metadata.language = a.language;
    if (a.sourcecountry) metadata.country = a.sourcecountry;
    if (a.seendate) metadata.seendate = a.seendate;

    return {
      id,
      type: 'object',
      kind: 'link',
      createdAt: new Date().toISOString(),
      sourceAdapter: 'gdelt',
      sourceId: url,
      text: title,
      occurredAt,
      metadata,
    };
  }
}

/** Convert YYYYMMDDHHMMSS → ISO. Returns null for invalid input. */
export function parseGdeltDate(s: string | undefined): string | null {
  if (!s || s.length < 14) return null;
  const y = s.slice(0, 4);
  const m = s.slice(4, 6);
  const d = s.slice(6, 8);
  const hh = s.slice(8, 10);
  const mm = s.slice(10, 12);
  const ss = s.slice(12, 14);
  if (!/^\d{4}$/.test(y)) return null;
  const iso = `${y}-${m}-${d}T${hh}:${mm}:${ss}Z`;
  const t = Date.parse(iso);
  if (isNaN(t)) return null;
  return new Date(t).toISOString();
}
