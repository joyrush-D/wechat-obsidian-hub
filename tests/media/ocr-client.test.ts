/**
 * Tests for OcrClient — HTTP client for a local OCR server.
 * Default target is RapidOCR-json or equivalent (POST /ocr with multipart image → {text}).
 * Mocks fetch; no real OCR server required.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { OcrClient } from '../../src/media/ocr-client';

function makeFetchOk(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function makeFetchError(message = 'Network error') {
  return vi.fn().mockRejectedValue(new Error(message));
}

describe('OcrClient', () => {
  const ENDPOINT = 'http://localhost:8090';

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isAvailable()', () => {
    it('returns true on 200', async () => {
      vi.stubGlobal('fetch', makeFetchOk({ status: 'ok' }));
      const c = new OcrClient(ENDPOINT);
      expect(await c.isAvailable()).toBe(true);
    });

    it('returns false on HTTP error', async () => {
      vi.stubGlobal('fetch', makeFetchOk({}, 503));
      const c = new OcrClient(ENDPOINT);
      expect(await c.isAvailable()).toBe(false);
    });

    it('returns false on network error', async () => {
      vi.stubGlobal('fetch', makeFetchError('ECONNREFUSED'));
      const c = new OcrClient(ENDPOINT);
      expect(await c.isAvailable()).toBe(false);
    });
  });

  describe('extractText()', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]);

    it('POSTs multipart to /ocr', async () => {
      const f = makeFetchOk({ text: '你好' });
      vi.stubGlobal('fetch', f);
      const c = new OcrClient(ENDPOINT);
      await c.extractText(png);
      expect(f).toHaveBeenCalledOnce();
      const [url, init] = f.mock.calls[0];
      expect(url).toBe(`${ENDPOINT}/ocr`);
      expect(init.method).toBe('POST');
      expect(init.body).toBeDefined();
    });

    it('returns extracted text', async () => {
      vi.stubGlobal('fetch', makeFetchOk({ text: '合同编号 HK-2025-0117' }));
      const c = new OcrClient(ENDPOINT);
      expect(await c.extractText(png)).toBe('合同编号 HK-2025-0117');
    });

    it('trims trailing whitespace', async () => {
      vi.stubGlobal('fetch', makeFetchOk({ text: '文字\n\n\n' }));
      const c = new OcrClient(ENDPOINT);
      expect(await c.extractText(png)).toBe('文字');
    });

    it('returns empty string when server returns no text field', async () => {
      vi.stubGlobal('fetch', makeFetchOk({}));
      const c = new OcrClient(ENDPOINT);
      expect(await c.extractText(png)).toBe('');
    });

    it('returns empty string when server returns empty text (blank image)', async () => {
      vi.stubGlobal('fetch', makeFetchOk({ text: '' }));
      const c = new OcrClient(ENDPOINT);
      expect(await c.extractText(png)).toBe('');
    });

    it('throws on HTTP 500', async () => {
      vi.stubGlobal('fetch', makeFetchOk('internal error', 500));
      const c = new OcrClient(ENDPOINT);
      await expect(c.extractText(png)).rejects.toThrow(/500/);
    });

    it('throws on HTTP 413 (image too large)', async () => {
      vi.stubGlobal('fetch', makeFetchOk('payload too large', 413));
      const c = new OcrClient(ENDPOINT);
      await expect(c.extractText(png)).rejects.toThrow(/413/);
    });

    it('propagates network errors', async () => {
      vi.stubGlobal('fetch', makeFetchError('ETIMEDOUT'));
      const c = new OcrClient(ENDPOINT);
      await expect(c.extractText(png)).rejects.toThrow(/ETIMEDOUT/);
    });

    it('joins paragraphs array when server returns structured response', async () => {
      // Some OCR servers return structured output: { paragraphs: [...], ... }
      // Client should gracefully fall back on the top-level "text" field when
      // paragraphs absent, but also stitch paragraphs when present.
      vi.stubGlobal('fetch', makeFetchOk({
        paragraphs: ['第一段内容', '第二段内容'],
      }));
      const c = new OcrClient(ENDPOINT);
      const result = await c.extractText(png);
      expect(result).toContain('第一段内容');
      expect(result).toContain('第二段内容');
    });
  });

  describe('constructor', () => {
    it('strips trailing slash', () => {
      const c = new OcrClient('http://localhost:8090/');
      expect(c.endpoint).toBe('http://localhost:8090');
    });
  });
});
