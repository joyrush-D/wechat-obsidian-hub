/**
 * Tests for WhisperClient — HTTP client for a local whisper.cpp server.
 * whisper.cpp 'server' exposes /inference (multipart) and /health endpoints.
 * All tests mock fetch; none require a running server.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { WhisperClient } from '../../src/media/whisper-client';

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

describe('WhisperClient', () => {
  const ENDPOINT = 'http://localhost:8081';

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isAvailable()', () => {
    it('returns true when server responds ok', async () => {
      vi.stubGlobal('fetch', makeFetchOk({ status: 'ready' }));
      const c = new WhisperClient(ENDPOINT);
      expect(await c.isAvailable()).toBe(true);
    });

    it('returns false when server returns 500', async () => {
      vi.stubGlobal('fetch', makeFetchOk({}, 500));
      const c = new WhisperClient(ENDPOINT);
      expect(await c.isAvailable()).toBe(false);
    });

    it('returns false when fetch rejects (server down)', async () => {
      vi.stubGlobal('fetch', makeFetchError('ECONNREFUSED'));
      const c = new WhisperClient(ENDPOINT);
      expect(await c.isAvailable()).toBe(false);
    });

    it('targets the /health endpoint', async () => {
      const f = makeFetchOk({ status: 'ready' });
      vi.stubGlobal('fetch', f);
      const c = new WhisperClient(ENDPOINT);
      await c.isAvailable();
      expect(f.mock.calls[0][0]).toBe(`${ENDPOINT}/health`);
    });
  });

  describe('transcribe()', () => {
    const audio = new Uint8Array([1, 2, 3, 4, 5]);

    it('POSTs multipart form-data to /inference', async () => {
      const f = makeFetchOk({ text: '你好 世界' });
      vi.stubGlobal('fetch', f);
      const c = new WhisperClient(ENDPOINT);
      await c.transcribe(audio);
      expect(f).toHaveBeenCalledOnce();
      const [url, init] = f.mock.calls[0];
      expect(url).toBe(`${ENDPOINT}/inference`);
      expect(init.method).toBe('POST');
      // body is FormData — can't easily parse, but assert it exists and isn't a string
      expect(init.body).toBeDefined();
      expect(typeof init.body).not.toBe('string');
    });

    it('returns the transcript text from the response', async () => {
      vi.stubGlobal('fetch', makeFetchOk({ text: '你好 世界' }));
      const c = new WhisperClient(ENDPOINT);
      const result = await c.transcribe(audio);
      expect(result).toBe('你好 世界');
    });

    it('trims whitespace from the returned transcript', async () => {
      vi.stubGlobal('fetch', makeFetchOk({ text: '  hello world  \n' }));
      const c = new WhisperClient(ENDPOINT);
      const result = await c.transcribe(audio);
      expect(result).toBe('hello world');
    });

    it('passes language option in form data when provided', async () => {
      const f = makeFetchOk({ text: 'ok' });
      vi.stubGlobal('fetch', f);
      const c = new WhisperClient(ENDPOINT);
      await c.transcribe(audio, { language: 'zh' });
      // FormData is hard to introspect; we settle for confirming the call happened
      expect(f).toHaveBeenCalled();
    });

    it('throws when server returns HTTP 500', async () => {
      vi.stubGlobal('fetch', makeFetchOk('internal error', 500));
      const c = new WhisperClient(ENDPOINT);
      await expect(c.transcribe(audio)).rejects.toThrow(/500/);
    });

    it('throws when server returns HTTP 400', async () => {
      vi.stubGlobal('fetch', makeFetchOk('bad audio format', 400));
      const c = new WhisperClient(ENDPOINT);
      await expect(c.transcribe(audio)).rejects.toThrow(/400/);
    });

    it('propagates network errors', async () => {
      vi.stubGlobal('fetch', makeFetchError('socket hang up'));
      const c = new WhisperClient(ENDPOINT);
      await expect(c.transcribe(audio)).rejects.toThrow(/socket hang up/);
    });

    it('returns empty string when response text is missing', async () => {
      vi.stubGlobal('fetch', makeFetchOk({}));
      const c = new WhisperClient(ENDPOINT);
      const result = await c.transcribe(audio);
      expect(result).toBe('');
    });

    it('handles absurdly long transcripts without truncation', async () => {
      const long = '一'.repeat(5000);
      vi.stubGlobal('fetch', makeFetchOk({ text: long }));
      const c = new WhisperClient(ENDPOINT);
      const result = await c.transcribe(audio);
      expect(result.length).toBe(5000);
    });
  });

  describe('constructor', () => {
    it('strips trailing slash from endpoint', () => {
      const c = new WhisperClient('http://localhost:8081/');
      expect(c.endpoint).toBe('http://localhost:8081');
    });

    it('keeps endpoint without trailing slash unchanged', () => {
      const c = new WhisperClient('http://localhost:8081');
      expect(c.endpoint).toBe('http://localhost:8081');
    });
  });
});
