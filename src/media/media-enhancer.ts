/**
 * MediaEnhancer — applies voice transcription + image analysis to parsed messages.
 *
 * Per VISION.md §3.2 unified text pipeline:
 *   Audio → whisper transcript → msg.text
 *   Image → OCR or VLM text → msg.text
 *
 * On any failure (file not found, decoder error, API error) the original
 * placeholder text is preserved. The enhancer never throws — it's best-effort.
 *
 * Deps are ALL optional — if a given component is null, that modality is skipped
 * (e.g. user disabled voice transcription, or silk decoder not installed).
 */

import type { ParsedMessage } from '../types';
import type { VoiceProcessor } from './voice-processor';
import type { ImageProcessor } from './image-processor';
import type { WeChatFileLocator } from './wechat-file-locator';
import type { SilkDecoder } from './silk-decoder';
import { readFileSync } from 'fs';

export interface MediaEnhancerOptions {
  voiceProcessor?: VoiceProcessor | null;
  imageProcessor?: ImageProcessor | null;
  locator?: WeChatFileLocator | null;
  silkDecoder?: SilkDecoder | null;
  /** Language hint for whisper (e.g. 'zh'). */
  voiceLanguage?: string;
  /** Language hint for OCR (e.g. 'ch'). */
  ocrLanguage?: string;
  /** Progress callback — called once per message processed. */
  onProgress?: (done: number, total: number, kind: 'voice' | 'image') => void;
  /** Max concurrent media analyses. Keep low — VLM model-swap serializes anyway. */
  concurrency?: number;
}

export interface EnhancementStats {
  voiceAttempted: number;
  voiceSucceeded: number;
  imageAttempted: number;
  imageSucceeded: number;
  errors: string[];
}

export class MediaEnhancer {
  constructor(private opts: MediaEnhancerOptions = {}) {}

  /** Enhance in-place, return stats. Mutates messages array. */
  async enhance(messages: ParsedMessage[]): Promise<EnhancementStats> {
    const stats: EnhancementStats = {
      voiceAttempted: 0,
      voiceSucceeded: 0,
      imageAttempted: 0,
      imageSucceeded: 0,
      errors: [],
    };

    const voiceTargets = messages.filter(m => m.type === 'voice');
    const imageTargets = messages.filter(m => m.type === 'image');

    if (this.opts.voiceProcessor && this.opts.locator) {
      await this.processInBatches(voiceTargets, async (msg) => {
        stats.voiceAttempted++;
        try {
          const transcript = await this.transcribeVoice(msg);
          if (transcript) {
            msg.text = `[语音] ${transcript}`;
            msg.extra = { ...msg.extra, transcript };
            stats.voiceSucceeded++;
          }
        } catch (e) {
          stats.errors.push(`voice ${msg.localId}: ${(e as Error).message.slice(0, 120)}`);
        } finally {
          this.opts.onProgress?.(stats.voiceAttempted + stats.imageAttempted, voiceTargets.length + imageTargets.length, 'voice');
        }
      });
    }

    if (this.opts.imageProcessor && this.opts.locator) {
      await this.processInBatches(imageTargets, async (msg) => {
        stats.imageAttempted++;
        try {
          const result = await this.analyzeImage(msg);
          if (result) {
            const tag = result.route === 'ocr' ? '[图片文字]' : '[图片]';
            msg.text = result.text ? `${tag} ${result.text}` : `${tag} 无可识别内容`;
            msg.extra = { ...msg.extra, image_analysis: result.text, image_route: result.route };
            stats.imageSucceeded++;
          }
        } catch (e) {
          stats.errors.push(`image ${msg.localId}: ${(e as Error).message.slice(0, 120)}`);
        } finally {
          this.opts.onProgress?.(stats.voiceAttempted + stats.imageAttempted, voiceTargets.length + imageTargets.length, 'image');
        }
      });
    }

    return stats;
  }

  private async transcribeVoice(msg: ParsedMessage): Promise<string | null> {
    const locator = this.opts.locator!;
    const processor = this.opts.voiceProcessor!;
    const path = locator.findVoice({
      localId: msg.localId,
      md5: msg.extra.md5,
    });
    if (!path) return null;

    let audio: Uint8Array = new Uint8Array(readFileSync(path));
    // If file is .silk, decode to .wav first
    if (path.toLowerCase().endsWith('.silk') || path.toLowerCase().endsWith('.amr')) {
      if (!this.opts.silkDecoder) return null;   // no decoder → skip
      audio = await this.opts.silkDecoder.decode(audio);
    }

    return await processor.transcribe(audio, { language: this.opts.voiceLanguage });
  }

  private async analyzeImage(msg: ParsedMessage): Promise<{ route: 'ocr' | 'vlm'; text: string } | null> {
    const locator = this.opts.locator!;
    const processor = this.opts.imageProcessor!;
    const path = locator.findImage({
      localId: msg.localId,
      md5: msg.extra.md5,
    });
    if (!path) return null;

    const image = new Uint8Array(readFileSync(path));
    const lower = path.toLowerCase();
    const ext = lower.substring(lower.lastIndexOf('.'));
    const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' :
                 ext === '.png' ? 'image/png' :
                 ext === '.webp' ? 'image/webp' :
                 ext === '.gif' ? 'image/gif' : 'image/png';

    const result = await processor.analyze(image, {
      filename: path.split('/').pop(),
      mimeType: mime,
      contentType: mime,
      language: this.opts.ocrLanguage,
    });
    return result;
  }

  private async processInBatches<T>(
    items: T[],
    fn: (item: T) => Promise<void>,
  ): Promise<void> {
    const concurrency = Math.max(1, this.opts.concurrency ?? 4);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (cursor < items.length) {
        const idx = cursor++;
        await fn(items[idx]);
      }
    });
    await Promise.all(workers);
  }
}
