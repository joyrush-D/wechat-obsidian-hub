/**
 * Integration-style tests for ImageProcessor — the cache-aware image
 * analysis orchestrator. Uses real VoiceCache (as generic MediaCache) +
 * mocked OcrClient and VlmClient.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { VoiceCache } from '../../src/media/voice-cache';
import { ImageProcessor } from '../../src/media/image-processor';
import type { OcrClient } from '../../src/media/ocr-client';
import type { VlmClient } from '../../src/media/vlm-client';

function makeOcrClient(impl?: (image: Uint8Array) => Promise<string>): OcrClient {
  return {
    endpoint: 'http://ocr',
    isAvailable: vi.fn().mockResolvedValue(true),
    extractText: vi.fn(impl ?? (async () => 'OCR 抽出的文字')),
  } as unknown as OcrClient;
}

function makeVlmClient(impl?: (image: Uint8Array) => Promise<string>): VlmClient {
  return {
    endpoint: 'http://vlm',
    isAvailable: vi.fn().mockResolvedValue(true),
    describe: vi.fn(impl ?? (async () => 'VLM 生成的描述')),
  } as unknown as VlmClient;
}

describe('ImageProcessor', () => {
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), 'owh-image-'));
  });

  afterEach(() => {
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it('screenshots route to OCR, photos route to VLM', async () => {
    const ocr = makeOcrClient();
    const vlm = makeVlmClient();
    const proc = new ImageProcessor(ocr, vlm, new VoiceCache(cacheDir));

    const screenshot = new Uint8Array([1, 1, 1]);
    const photo = new Uint8Array([2, 2, 2]);

    const rss = await proc.analyze(screenshot, { filename: 'Screenshot_001.png' });
    const rsp = await proc.analyze(photo, { width: 4000, height: 3000 });

    expect(rss.route).toBe('ocr');
    expect(rss.text).toBe('OCR 抽出的文字');
    expect(ocr.extractText).toHaveBeenCalledTimes(1);

    expect(rsp.route).toBe('vlm');
    expect(rsp.text).toBe('VLM 生成的描述');
    expect(vlm.describe).toHaveBeenCalledTimes(1);
  });

  it('caches by (route, content-hash) so second call short-circuits', async () => {
    const img = new Uint8Array([3, 3, 3]);
    const ocr = makeOcrClient();
    const vlm = makeVlmClient();
    const proc = new ImageProcessor(ocr, vlm, new VoiceCache(cacheDir));

    await proc.analyze(img, { hint: 'ocr' });
    await proc.analyze(img, { hint: 'ocr' });

    expect(ocr.extractText).toHaveBeenCalledTimes(1);   // second was cache hit
  });

  it('same image cached separately for OCR vs VLM (different routes = different cache)', async () => {
    const img = new Uint8Array([4, 4, 4]);
    const ocr = makeOcrClient();
    const vlm = makeVlmClient();
    const proc = new ImageProcessor(ocr, vlm, new VoiceCache(cacheDir));

    await proc.analyze(img, { hint: 'ocr' });
    await proc.analyze(img, { hint: 'vlm' });

    // Both clients called — cache is per-route
    expect(ocr.extractText).toHaveBeenCalledTimes(1);
    expect(vlm.describe).toHaveBeenCalledTimes(1);
  });

  it('errors do not get cached (next attempt re-runs)', async () => {
    const img = new Uint8Array([5, 5, 5]);
    let attempt = 0;
    const ocr = makeOcrClient(async () => {
      attempt++;
      if (attempt === 1) throw new Error('transient ocr crash');
      return 'recovered text';
    });
    const vlm = makeVlmClient();
    const proc = new ImageProcessor(ocr, vlm, new VoiceCache(cacheDir));

    await expect(proc.analyze(img, { hint: 'ocr' })).rejects.toThrow('transient ocr crash');
    const second = await proc.analyze(img, { hint: 'ocr' });
    expect(second.text).toBe('recovered text');
    expect(attempt).toBe(2);
  });

  it('empty OCR result still cached (prevents re-running on blank images)', async () => {
    const blank = new Uint8Array([0, 0, 0]);
    const ocr = makeOcrClient(async () => '');
    const vlm = makeVlmClient();
    const proc = new ImageProcessor(ocr, vlm, new VoiceCache(cacheDir));

    const r1 = await proc.analyze(blank, { hint: 'ocr' });
    const r2 = await proc.analyze(blank, { hint: 'ocr' });

    expect(r1.text).toBe('');
    expect(r2.text).toBe('');
    expect(ocr.extractText).toHaveBeenCalledTimes(1);
  });

  it('cache persists across processor instances', async () => {
    const img = new Uint8Array([7, 7, 7]);

    const ocr1 = makeOcrClient(async () => 'first-run');
    const proc1 = new ImageProcessor(ocr1, makeVlmClient(), new VoiceCache(cacheDir));
    await proc1.analyze(img, { hint: 'ocr' });

    const ocr2 = makeOcrClient(async () => 'should-not-be-called');
    const proc2 = new ImageProcessor(ocr2, makeVlmClient(), new VoiceCache(cacheDir));
    const result = await proc2.analyze(img, { hint: 'ocr' });

    expect(result.text).toBe('first-run');
    expect(ocr2.extractText).not.toHaveBeenCalled();
  });

  it('passes language option through to OCR client', async () => {
    const ocr = makeOcrClient();
    const proc = new ImageProcessor(ocr, makeVlmClient(), new VoiceCache(cacheDir));
    await proc.analyze(new Uint8Array([1]), { hint: 'ocr', language: 'ch' });
    const opts = (ocr.extractText as any).mock.calls[0][1];
    expect(opts.language).toBe('ch');
  });

  it('includes meta when calling VLM so it can pick a prompt variant', async () => {
    const vlm = makeVlmClient();
    const proc = new ImageProcessor(makeOcrClient(), vlm, new VoiceCache(cacheDir));
    await proc.analyze(new Uint8Array([2]), { hint: 'vlm', contentType: 'image/jpeg' });
    const opts = (vlm.describe as any).mock.calls[0][1];
    expect(opts.contentType).toBe('image/jpeg');
  });
});
