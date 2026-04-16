import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LlmClient } from '../../src/ai/llm-client';

function makeFetchOk(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

function makeFetchError(message = 'Network error') {
  return vi.fn().mockRejectedValue(new Error(message));
}

describe('LlmClient', () => {
  const ENDPOINT = 'http://localhost:1234/v1';
  const MODEL = 'lmstudio-model';

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('complete()', () => {
    it('sends POST to /chat/completions with correct body', async () => {
      const mockFetch = makeFetchOk({ choices: [{ message: { content: 'Hello back' } }] });
      vi.stubGlobal('fetch', mockFetch);

      const client = new LlmClient(ENDPOINT, MODEL);
      const result = await client.complete('Say hello');

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe(`${ENDPOINT}/chat/completions`);
      expect(init.method).toBe('POST');
      expect(init.headers['Content-Type']).toBe('application/json');

      const body = JSON.parse(init.body);
      expect(body.model).toBe(MODEL);
      expect(body.messages).toHaveLength(1);
      expect(body.messages[0].role).toBe('user');
      expect(body.messages[0].content).toBe('Say hello');
      expect(body.temperature).toBe(0.3);
      expect(body.max_tokens).toBe(4096);
    });

    it('returns the assistant reply text', async () => {
      vi.stubGlobal('fetch', makeFetchOk({ choices: [{ message: { content: 'The briefing is ready.' } }] }));
      const client = new LlmClient(ENDPOINT, MODEL);
      const result = await client.complete('Summarize');
      expect(result).toBe('The briefing is ready.');
    });

    it('omits model field when model is empty string', async () => {
      const mockFetch = makeFetchOk({ choices: [{ message: { content: 'ok' } }] });
      vi.stubGlobal('fetch', mockFetch);

      const client = new LlmClient(ENDPOINT, '');
      await client.complete('test');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      // model should be undefined (omitted from JSON)
      expect(body.model).toBeUndefined();
    });

    it('throws on HTTP 500 error', async () => {
      vi.stubGlobal('fetch', makeFetchOk({}, 500));
      const client = new LlmClient(ENDPOINT, MODEL);
      await expect(client.complete('test')).rejects.toThrow('LLM API error: 500');
    });

    it('throws on HTTP 401 error', async () => {
      vi.stubGlobal('fetch', makeFetchOk({}, 401));
      const client = new LlmClient(ENDPOINT, MODEL);
      await expect(client.complete('test')).rejects.toThrow('LLM API error: 401');
    });

    it('propagates network errors', async () => {
      vi.stubGlobal('fetch', makeFetchError('Connection refused'));
      const client = new LlmClient(ENDPOINT, MODEL);
      await expect(client.complete('test')).rejects.toThrow('Connection refused');
    });
  });

  describe('isAvailable()', () => {
    it('returns true when models endpoint returns non-empty data array', async () => {
      vi.stubGlobal('fetch', makeFetchOk({ data: [{ id: 'model-1' }] }));
      const client = new LlmClient(ENDPOINT, MODEL);
      expect(await client.isAvailable()).toBe(true);
    });

    it('returns false when data array is empty', async () => {
      vi.stubGlobal('fetch', makeFetchOk({ data: [] }));
      const client = new LlmClient(ENDPOINT, MODEL);
      expect(await client.isAvailable()).toBe(false);
    });

    it('returns false when data is not an array', async () => {
      vi.stubGlobal('fetch', makeFetchOk({ data: null }));
      const client = new LlmClient(ENDPOINT, MODEL);
      expect(await client.isAvailable()).toBe(false);
    });

    it('returns false on HTTP error', async () => {
      vi.stubGlobal('fetch', makeFetchOk({}, 503));
      const client = new LlmClient(ENDPOINT, MODEL);
      expect(await client.isAvailable()).toBe(false);
    });

    it('returns false on network error', async () => {
      vi.stubGlobal('fetch', makeFetchError('ECONNREFUSED'));
      const client = new LlmClient(ENDPOINT, MODEL);
      expect(await client.isAvailable()).toBe(false);
    });

    it('queries the correct models endpoint', async () => {
      const mockFetch = makeFetchOk({ data: [{ id: 'x' }] });
      vi.stubGlobal('fetch', mockFetch);
      const client = new LlmClient(ENDPOINT, MODEL);
      await client.isAvailable();
      expect(mockFetch.mock.calls[0][0]).toBe(`${ENDPOINT}/models`);
    });
  });

  describe('getLoadedModel()', () => {
    it('returns the first model id', async () => {
      vi.stubGlobal('fetch', makeFetchOk({ data: [{ id: 'llama3-8b' }, { id: 'other' }] }));
      const client = new LlmClient(ENDPOINT, MODEL);
      expect(await client.getLoadedModel()).toBe('llama3-8b');
    });

    it('returns null when data is empty', async () => {
      vi.stubGlobal('fetch', makeFetchOk({ data: [] }));
      const client = new LlmClient(ENDPOINT, MODEL);
      expect(await client.getLoadedModel()).toBeNull();
    });

    it('returns null on HTTP error', async () => {
      vi.stubGlobal('fetch', makeFetchOk({}, 500));
      const client = new LlmClient(ENDPOINT, MODEL);
      expect(await client.getLoadedModel()).toBeNull();
    });

    it('returns null on network error', async () => {
      vi.stubGlobal('fetch', makeFetchError('timeout'));
      const client = new LlmClient(ENDPOINT, MODEL);
      expect(await client.getLoadedModel()).toBeNull();
    });
  });
});
