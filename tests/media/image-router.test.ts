/**
 * Tests for ImageRouter — decides OCR vs VLM route for a given image.
 * Pure heuristic function, no I/O, no LLM calls. Easy to test exhaustively.
 *
 * Decision rules (see image-router.ts for the authoritative spec):
 *   1. Explicit caller hint wins.
 *   2. mimeType of 'application/pdf' or name ending in .pdf → OCR
 *   3. Very tall aspect ratio (h/w > 1.8) or very wide (w/h > 1.8) → likely
 *      a chat screenshot / document page → OCR
 *   4. Square-ish photos (0.5 < w/h < 2) → likely a life photo → VLM
 *   5. Filename containing "screenshot" / "截图" / "Screen Shot" → OCR
 *   6. Default (unknown dimensions) → VLM (safer: describes anything)
 */
import { describe, it, expect } from 'vitest';
import { routeImage, type ImageMeta } from '../../src/media/image-router';

describe('routeImage', () => {
  describe('explicit hints', () => {
    it('respects hint=ocr even for photo-like dimensions', () => {
      const meta: ImageMeta = { width: 1000, height: 1000, hint: 'ocr' };
      expect(routeImage(meta)).toBe('ocr');
    });

    it('respects hint=vlm even for document-like dimensions', () => {
      const meta: ImageMeta = { width: 600, height: 2400, hint: 'vlm' };
      expect(routeImage(meta)).toBe('vlm');
    });
  });

  describe('PDF / document heuristics', () => {
    it('routes PDFs to OCR', () => {
      expect(routeImage({ mimeType: 'application/pdf' })).toBe('ocr');
    });

    it('routes .pdf filenames to OCR regardless of mime', () => {
      expect(routeImage({ filename: 'report_q3.pdf' })).toBe('ocr');
    });
  });

  describe('screenshot filename heuristics', () => {
    it('routes macOS Screenshot-style filenames to OCR', () => {
      expect(routeImage({ filename: 'Screen Shot 2025-01-15 at 10.23.45.png' })).toBe('ocr');
    });

    it('routes iOS "Screenshot" prefix to OCR', () => {
      expect(routeImage({ filename: 'Screenshot_20250115_102345.png' })).toBe('ocr');
    });

    it('routes Chinese 截图 filename to OCR', () => {
      expect(routeImage({ filename: '截图_2025-01-15.jpg' })).toBe('ocr');
    });
  });

  describe('aspect-ratio heuristics', () => {
    it('routes very tall images (chat screenshots) to OCR', () => {
      // iPhone screenshot is typically 1179x2556, ratio ~2.17
      expect(routeImage({ width: 1179, height: 2556 })).toBe('ocr');
    });

    it('routes very wide images (document panoramas) to OCR', () => {
      expect(routeImage({ width: 3200, height: 800 })).toBe('ocr');
    });

    it('routes square-ish images to VLM', () => {
      expect(routeImage({ width: 1200, height: 1200 })).toBe('vlm');
      expect(routeImage({ width: 1200, height: 1500 })).toBe('vlm');
    });

    it('routes landscape photos to VLM', () => {
      expect(routeImage({ width: 4000, height: 3000 })).toBe('vlm');  // 4:3
      expect(routeImage({ width: 1920, height: 1080 })).toBe('vlm');  // 16:9 (1.78, just under threshold)
    });

    it('routes portrait photos (under 1.8 ratio) to VLM', () => {
      expect(routeImage({ width: 1500, height: 2000 })).toBe('vlm');  // 1.33
    });
  });

  describe('fallback when no info', () => {
    it('routes unknown images to VLM by default (VLM handles anything)', () => {
      expect(routeImage({})).toBe('vlm');
    });

    it('routes images with only mime type and no dims to VLM', () => {
      expect(routeImage({ mimeType: 'image/jpeg' })).toBe('vlm');
    });
  });

  describe('edge cases', () => {
    it('handles zero dimensions without crashing', () => {
      expect(() => routeImage({ width: 0, height: 0 })).not.toThrow();
      expect(routeImage({ width: 0, height: 0 })).toBe('vlm');
    });

    it('handles negative dimensions gracefully', () => {
      expect(() => routeImage({ width: -1, height: 100 })).not.toThrow();
    });

    it('case-insensitive for filename keywords', () => {
      expect(routeImage({ filename: 'SCREENSHOT.png' })).toBe('ocr');
      expect(routeImage({ filename: 'Screenshot.png' })).toBe('ocr');
    });
  });
});
