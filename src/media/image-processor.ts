/**
 * ImageProcessor — cache-aware image analysis orchestrator.
 *
 * Flow:
 *   1. routeImage(meta) decides 'ocr' or 'vlm'
 *   2. Cache lookup by (route, content-hash)
 *   3. On miss, dispatch to the appropriate client
 *   4. Cache result (even empty string = "known blank / silent")
 *   5. Return { route, text }
 *
 * Errors from clients propagate — caller decides whether to mark the image
 * as un-analyzed and continue. Never cache an error.
 */

import { routeImage, type ImageMeta, type ImageRoute } from './image-router';
import type { OcrClient } from './ocr-client';
import type { VlmClient } from './vlm-client';
import { VoiceCache } from './voice-cache';   // reused as a generic KV cache

export interface ImageAnalysisOptions extends ImageMeta {
  /** Language hint for OCR (server-specific, e.g. 'ch', 'en'). */
  language?: string;
  /** Custom VLM prompt; overrides default analyst-oriented prompt. */
  prompt?: string;
  /** HTTP Content-Type for the image part (e.g. 'image/png'). Defaults from mimeType. */
  contentType?: string;
}

export interface ImageAnalysis {
  route: ImageRoute;
  text: string;
}

export class ImageProcessor {
  constructor(
    private ocr: OcrClient,
    private vlm: VlmClient,
    private cache: VoiceCache,
  ) {}

  async analyze(image: Uint8Array, opts: ImageAnalysisOptions = {}): Promise<ImageAnalysis> {
    const route = routeImage(opts);
    const hash = VoiceCache.hashKey(image);
    const key = `${route}:${hash}`;

    const cached = this.cache.get(key);
    if (cached !== null) return { route, text: cached };

    const text = route === 'ocr'
      ? await this.ocr.extractText(image, {
          contentType: opts.contentType,
          filename: opts.filename,
          language: opts.language,
        })
      : await this.vlm.describe(image, {
          contentType: opts.contentType,
          prompt: opts.prompt,
        });

    this.cache.put(key, text);
    return { route, text };
  }

  async isAvailable(): Promise<{ ocr: boolean; vlm: boolean }> {
    const [ocr, vlm] = await Promise.all([
      this.ocr.isAvailable(),
      this.vlm.isAvailable(),
    ]);
    return { ocr, vlm };
  }
}
