import { describe, it, expect, vi } from 'vitest';
import { GdeltSource, parseGdeltDate, type GdeltArticle, type GdeltFetcher } from '../../../src/core/sources/gdelt-source';

function makeFetcher(articles: GdeltArticle[]): GdeltFetcher {
  return vi.fn().mockResolvedValue({ articles });
}

describe('parseGdeltDate', () => {
  it('parses well-formed YYYYMMDDHHMMSS', () => {
    expect(parseGdeltDate('20260417093045')).toBe('2026-04-17T09:30:45.000Z');
  });

  it('returns null for too-short input', () => {
    expect(parseGdeltDate('20260417')).toBeNull();
    expect(parseGdeltDate('')).toBeNull();
    expect(parseGdeltDate(undefined)).toBeNull();
  });

  it('returns null for invalid date components', () => {
    expect(parseGdeltDate('xxxx0417093045')).toBeNull();
  });
});

describe('GdeltSource', () => {
  describe('basic contract', () => {
    it('reports id and displayName', () => {
      const s = new GdeltSource();
      expect(s.id).toBe('gdelt');
      expect(s.displayName).toContain('GDELT');
    });

    it('isReady is cheap and true', async () => {
      const s = new GdeltSource({ fetcher: vi.fn() });
      expect(await s.isReady()).toBe(true);
    });

    it('reports capabilities — no media, supports streaming', () => {
      const c = new GdeltSource().capabilities();
      expect(c.hasVoice).toBe(false);
      expect(c.hasImage).toBe(false);
      expect(c.hasVideo).toBe(false);
      expect(c.supportsLiveStream).toBe(true);
    });
  });

  describe('articleId', () => {
    it('produces stable ids for the same URL', () => {
      expect(GdeltSource.articleId('https://example.com/a')).toBe(GdeltSource.articleId('https://example.com/a'));
    });

    it('different URLs yield different ids', () => {
      expect(GdeltSource.articleId('https://a.com')).not.toBe(GdeltSource.articleId('https://b.com'));
    });

    it('id is namespaced and short', () => {
      const id = GdeltSource.articleId('https://example.com');
      expect(id).toMatch(/^obj:gdelt:[a-f0-9]{16}$/);
    });
  });

  describe('fetch', () => {
    it('yields nothing when query is empty', async () => {
      const s = new GdeltSource({ fetcher: makeFetcher([]) });
      const batches: any[][] = [];
      for await (const b of s.fetch({})) batches.push(b);
      expect(batches).toEqual([]);
    });

    it('yields empty batch when API returns no articles', async () => {
      const s = new GdeltSource({ fetcher: makeFetcher([]) });
      const batches: any[][] = [];
      for await (const b of s.fetch({ filter: { query: 'foo' } })) batches.push(b);
      expect(batches).toEqual([[]]);
    });

    it('yields converted WxObjects when API returns articles', async () => {
      const articles: GdeltArticle[] = [
        {
          url: 'https://newsroom.example/article-1',
          title: 'Earthquake hits city X',
          seendate: '20260417120000',
          domain: 'newsroom.example',
          language: 'eng',
          sourcecountry: 'US',
        },
        {
          url: 'https://other.example/2',
          title: 'Another article',
          seendate: '20260417080000',
        },
      ];
      const s = new GdeltSource({ fetcher: makeFetcher(articles) });
      const batches: any[][] = [];
      for await (const b of s.fetch({ filter: { query: 'earthquake' } })) batches.push(b);
      expect(batches).toHaveLength(1);
      const objs = batches[0];
      expect(objs).toHaveLength(2);
      expect(objs[0].kind).toBe('link');
      expect(objs[0].sourceAdapter).toBe('gdelt');
      expect(objs[0].text).toBe('Earthquake hits city X');
      expect(objs[0].occurredAt).toBe('2026-04-17T12:00:00.000Z');
      expect(objs[0].metadata?.url).toBe('https://newsroom.example/article-1');
      expect(objs[0].metadata?.domain).toBe('newsroom.example');
      expect(objs[0].metadata?.country).toBe('US');
      expect(objs[0].metadata?.query).toBe('earthquake');
    });

    it('builds the API URL with query encoded + timespan', async () => {
      const fetcher = makeFetcher([]);
      const s = new GdeltSource({ fetcher });
      const it = s.fetch({ filter: { query: '光伏 加纳', maxrecords: 30 } });
      // Drain the iterator
      // eslint-disable-next-line no-unused-vars
      for await (const _ of it) { /* noop */ }
      const calledUrl: string = (fetcher as any).mock.calls[0][0];
      expect(calledUrl).toContain('https://api.gdeltproject.org/api/v2/doc/doc');
      expect(calledUrl).toContain('format=json');
      expect(calledUrl).toContain('maxrecords=30');
      expect(calledUrl).toMatch(/timespan=\d+d/);
      // Chinese query must be URL-encoded
      expect(decodeURIComponent(calledUrl)).toContain('光伏 加纳');
    });

    it('computes timespan from since when provided', async () => {
      const fetcher = makeFetcher([]);
      const s = new GdeltSource({ fetcher });
      const since = new Date(Date.now() - 3 * 86_400_000).toISOString();
      // eslint-disable-next-line no-unused-vars
      for await (const _ of s.fetch({ since, filter: { query: 'x' } })) { /* noop */ }
      const url: string = (fetcher as any).mock.calls[0][0];
      expect(url).toMatch(/timespan=3d/);
    });

    it('uses defaultTimespanDays when no since given', async () => {
      const fetcher = makeFetcher([]);
      const s = new GdeltSource({ fetcher, defaultTimespanDays: 14 });
      // eslint-disable-next-line no-unused-vars
      for await (const _ of s.fetch({ filter: { query: 'x' } })) { /* noop */ }
      const url: string = (fetcher as any).mock.calls[0][0];
      expect(url).toContain('timespan=14d');
    });

    it('handles articles without optional fields gracefully', async () => {
      const articles: GdeltArticle[] = [{ url: 'https://x.com/1' }];
      const s = new GdeltSource({ fetcher: makeFetcher(articles) });
      const batches: any[][] = [];
      for await (const b of s.fetch({ filter: { query: 'x' } })) batches.push(b);
      const obj = batches[0][0];
      expect(obj.text).toBe('(无标题)');
      expect(obj.occurredAt).toMatch(/^2\d{3}-/);   // falls back to now
      expect(obj.metadata?.domain).toBeUndefined();
    });

    it('produces deterministic id across refetches of the same URL', async () => {
      const url = 'https://newsroom.example/article-1';
      const articles: GdeltArticle[] = [{ url, title: 'T' }];
      const s = new GdeltSource({ fetcher: makeFetcher(articles) });
      const collect = async () => {
        const out: any[] = [];
        for await (const b of s.fetch({ filter: { query: 'x' } })) out.push(...b);
        return out;
      };
      const a = await collect();
      const b = await collect();
      expect(a[0].id).toBe(b[0].id);
    });

    it('propagates fetcher errors', async () => {
      const failing: GdeltFetcher = vi.fn().mockRejectedValue(new Error('GDELT API 503'));
      const s = new GdeltSource({ fetcher: failing });
      const it = s.fetch({ filter: { query: 'x' } });
      // eslint-disable-next-line no-unused-vars
      await expect((async () => { for await (const _ of it) { /* noop */ } })()).rejects.toThrow(/503/);
    });
  });
});
