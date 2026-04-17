/**
 * Tests for VlmClient — multimodal LLM client via OpenAI-compatible API.
 * Target backend: LM Studio with Qwen2.5-VL-7B loaded.
 * All tests mock fetch.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { VlmClient } from '../../src/media/vlm-client';

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

describe('VlmClient', () => {
  const ENDPOINT = 'http://localhost:1234/v1';
  const MODEL = 'qwen2.5-vl-7b';
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('describe()', () => {
    it('POSTs to /chat/completions', async () => {
      const f = makeFetchOk({ choices: [{ message: { content: '一张风景照，湖面倒映着山峰。' } }] });
      vi.stubGlobal('fetch', f);
      const c = new VlmClient(ENDPOINT, MODEL);
      await c.describe(PNG);
      const [url, init] = f.mock.calls[0];
      expect(url).toBe(`${ENDPOINT}/chat/completions`);
      expect(init.method).toBe('POST');
      expect(init.headers['Content-Type']).toBe('application/json');
    });

    it('sends multimodal content (text part + image_url part)', async () => {
      const f = makeFetchOk({ choices: [{ message: { content: 'x' } }] });
      vi.stubGlobal('fetch', f);
      const c = new VlmClient(ENDPOINT, MODEL);
      await c.describe(PNG);
      const body = JSON.parse(f.mock.calls[0][1].body);
      expect(Array.isArray(body.messages)).toBe(true);
      expect(body.messages[0].role).toBe('user');
      const content = body.messages[0].content;
      expect(Array.isArray(content)).toBe(true);
      const textPart = content.find((p: any) => p.type === 'text');
      const imagePart = content.find((p: any) => p.type === 'image_url');
      expect(textPart).toBeDefined();
      expect(imagePart).toBeDefined();
      expect(imagePart.image_url.url).toMatch(/^data:image\/png;base64,/);
    });

    it('encodes the image as base64 in the data URL', async () => {
      const f = makeFetchOk({ choices: [{ message: { content: 'ok' } }] });
      vi.stubGlobal('fetch', f);
      const c = new VlmClient(ENDPOINT, MODEL);
      await c.describe(PNG);
      const body = JSON.parse(f.mock.calls[0][1].body);
      const dataUrl = body.messages[0].content.find((p: any) => p.type === 'image_url').image_url.url;
      const base64 = dataUrl.split(',')[1];
      const decoded = Buffer.from(base64, 'base64');
      expect(decoded.length).toBe(PNG.length);
      expect(decoded[0]).toBe(PNG[0]);
    });

    it('allows custom prompt text', async () => {
      const f = makeFetchOk({ choices: [{ message: { content: 'ok' } }] });
      vi.stubGlobal('fetch', f);
      const c = new VlmClient(ENDPOINT, MODEL);
      await c.describe(PNG, { prompt: '这是什么?' });
      const body = JSON.parse(f.mock.calls[0][1].body);
      const textPart = body.messages[0].content.find((p: any) => p.type === 'text');
      expect(textPart.text).toBe('这是什么?');
    });

    it('uses the configured model in the request', async () => {
      const f = makeFetchOk({ choices: [{ message: { content: 'ok' } }] });
      vi.stubGlobal('fetch', f);
      const c = new VlmClient(ENDPOINT, MODEL);
      await c.describe(PNG);
      expect(JSON.parse(f.mock.calls[0][1].body).model).toBe(MODEL);
    });

    it('omits model when constructed with empty string (LM Studio auto-selects)', async () => {
      const f = makeFetchOk({ choices: [{ message: { content: 'ok' } }] });
      vi.stubGlobal('fetch', f);
      const c = new VlmClient(ENDPOINT, '');
      await c.describe(PNG);
      expect(JSON.parse(f.mock.calls[0][1].body).model).toBeUndefined();
    });

    it('returns the trimmed description text', async () => {
      vi.stubGlobal('fetch', makeFetchOk({ choices: [{ message: { content: '  描述  \n' } }] }));
      const c = new VlmClient(ENDPOINT, MODEL);
      expect(await c.describe(PNG)).toBe('描述');
    });

    it('throws on HTTP 500', async () => {
      vi.stubGlobal('fetch', makeFetchOk({}, 500));
      const c = new VlmClient(ENDPOINT, MODEL);
      await expect(c.describe(PNG)).rejects.toThrow(/500/);
    });

    it('propagates network errors', async () => {
      vi.stubGlobal('fetch', makeFetchError('ECONNREFUSED'));
      const c = new VlmClient(ENDPOINT, MODEL);
      await expect(c.describe(PNG)).rejects.toThrow(/ECONNREFUSED/);
    });

    it('passes through custom mime type for non-PNG images', async () => {
      const f = makeFetchOk({ choices: [{ message: { content: 'ok' } }] });
      vi.stubGlobal('fetch', f);
      const c = new VlmClient(ENDPOINT, MODEL);
      await c.describe(PNG, { contentType: 'image/jpeg' });
      const body = JSON.parse(f.mock.calls[0][1].body);
      const dataUrl = body.messages[0].content.find((p: any) => p.type === 'image_url').image_url.url;
      expect(dataUrl).toMatch(/^data:image\/jpeg;base64,/);
    });
  });

  describe('isAvailable()', () => {
    it('probes /models to check readiness', async () => {
      const f = makeFetchOk({ data: [{ id: 'qwen2.5-vl' }] });
      vi.stubGlobal('fetch', f);
      const c = new VlmClient(ENDPOINT, MODEL);
      expect(await c.isAvailable()).toBe(true);
      expect(f.mock.calls[0][0]).toBe(`${ENDPOINT}/models`);
    });

    it('returns false when /models returns empty', async () => {
      vi.stubGlobal('fetch', makeFetchOk({ data: [] }));
      const c = new VlmClient(ENDPOINT, MODEL);
      expect(await c.isAvailable()).toBe(false);
    });

    it('returns false on network error', async () => {
      vi.stubGlobal('fetch', makeFetchError('no network'));
      const c = new VlmClient(ENDPOINT, MODEL);
      expect(await c.isAvailable()).toBe(false);
    });
  });

  describe('constructor', () => {
    it('strips trailing slash from endpoint', () => {
      const c = new VlmClient('http://localhost:1234/v1/', MODEL);
      expect(c.endpoint).toBe('http://localhost:1234/v1');
    });
  });
});
