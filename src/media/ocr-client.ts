/**
 * OcrClient — HTTP client for a local OCR server.
 *
 * Recommended backend: RapidOCR-json (https://github.com/hiroi-sora/RapidOCR-json)
 * or any server exposing `POST /ocr` with multipart 'file' field returning
 * `{ text?: string, paragraphs?: string[] }`.
 *
 * Why HTTP and not in-process ONNX:
 *   - onnxruntime-node adds 50+ MB platform binaries to the plugin bundle
 *   - Running OCR in the Obsidian renderer process can stutter the UI
 *   - Separate server lets users pick their own accuracy/speed trade-off
 *   - Keeps the plugin bundle pure JS (ships fast, no native compile)
 *
 * The client is format-agnostic: png / jpg / webp / bmp / pdf are all valid
 * image/pdf parts. The server (not us) handles decoding.
 */

export interface OcrOptions {
  filename?: string;
  contentType?: string;
  /** Language hint, e.g. 'ch' for Chinese, 'en' for English. Server-specific. */
  language?: string;
}

interface OcrResponse {
  text?: string;
  paragraphs?: string[];
}

export class OcrClient {
  readonly endpoint: string;

  constructor(endpoint: string) {
    this.endpoint = endpoint.replace(/\/+$/, '');
  }

  async isAvailable(): Promise<boolean> {
    try {
      const resp = await fetch(`${this.endpoint}/health`);
      return resp.ok;
    } catch {
      return false;
    }
  }

  async extractText(image: Uint8Array, opts: OcrOptions = {}): Promise<string> {
    const form = new FormData();
    const blob = new Blob([image as unknown as Uint8Array<ArrayBuffer>], {
      type: opts.contentType || 'image/png',
    });
    form.append('file', blob, opts.filename || 'image.png');
    if (opts.language) form.append('language', opts.language);

    const resp = await fetch(`${this.endpoint}/ocr`, {
      method: 'POST',
      body: form,
    });

    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      throw new Error(`OCR API error: ${resp.status} ${detail.slice(0, 200)}`);
    }

    const body: OcrResponse = await resp.json();
    // Prefer 'paragraphs' when provided (structured output preserves line breaks);
    // fall back to the flat 'text' field for simpler servers.
    if (Array.isArray(body.paragraphs) && body.paragraphs.length > 0) {
      return body.paragraphs.join('\n').trim();
    }
    return (body.text ?? '').trim();
  }
}
