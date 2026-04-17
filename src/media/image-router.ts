/**
 * ImageRouter — choose the right analysis path for an image.
 *
 * OCR is fast and precise for text extraction; VLM gives rich descriptions
 * but costs ~10× more compute. Route each image to the cheaper tool when
 * we can confidently identify its type.
 *
 * Rules (in order, first match wins):
 *   1. Explicit caller hint                              → that route
 *   2. PDF mime or .pdf filename                         → OCR
 *   3. Filename signals a screenshot (Screen Shot, 截图) → OCR
 *   4. Extreme aspect ratio (>1.8 either way)            → OCR
 *   5. Everything else                                   → VLM
 *
 * Threshold 1.8 captures iPhone (~2.17), Android (~2.22), typical chat
 * screenshots, while staying below 16:9 landscape (~1.78) to let nice
 * wide photos route to VLM.
 */

export type ImageRoute = 'ocr' | 'vlm';

export interface ImageMeta {
  width?: number;
  height?: number;
  mimeType?: string;
  filename?: string;
  hint?: ImageRoute;
}

const ASPECT_EXTREME = 1.8;
const SCREENSHOT_PATTERNS = [
  /screen\s*shot/i,
  /screenshot/i,
  /截图/,
  /屏幕截图/,
];

export function routeImage(meta: ImageMeta): ImageRoute {
  if (meta.hint === 'ocr' || meta.hint === 'vlm') return meta.hint;

  const fname = (meta.filename || '').toLowerCase();
  const mime = (meta.mimeType || '').toLowerCase();

  if (mime === 'application/pdf' || fname.endsWith('.pdf')) return 'ocr';

  if (meta.filename && SCREENSHOT_PATTERNS.some(p => p.test(meta.filename!))) {
    return 'ocr';
  }

  const w = Number(meta.width) || 0;
  const h = Number(meta.height) || 0;
  if (w > 0 && h > 0) {
    const ratio = Math.max(w / h, h / w);
    if (ratio > ASPECT_EXTREME) return 'ocr';
  }

  return 'vlm';
}
