/**
 * WhisperClient — HTTP client for a local whisper.cpp 'server' process.
 *
 * whisper.cpp's server binary exposes:
 *   POST /inference   (multipart form with 'file' field) → { text: '...' }
 *   GET  /health      → 200 when ready
 *
 * Start server on Mac:
 *   whisper-cli-server -m ggml-large-v3-turbo-q5_0.bin -l zh --port 8081 --host 127.0.0.1
 *
 * See scripts/start-whisper-server.sh for the exact command.
 *
 * Design notes:
 *   - This client is LLM-independent and cacheable. Callers are expected to
 *     check the VoiceCache first and only invoke transcribe() on a miss.
 *   - Audio buffer must be in a format whisper.cpp (ffmpeg-backed) can decode:
 *     wav, mp3, flac, m4a. WeChat's native .silk/.amr needs conversion first
 *     (not handled here — see VoiceProcessor in a future phase).
 */

export interface TranscribeOptions {
  /** Language hint (ISO 639-1). 'zh' strongly recommended for Chinese audio. */
  language?: string;
  /** File name hint for the multipart form (affects whisper.cpp format detection). */
  filename?: string;
  /** MIME type for the file part. */
  contentType?: string;
}

export class WhisperClient {
  readonly endpoint: string;

  constructor(endpoint: string) {
    this.endpoint = endpoint.replace(/\/+$/, '');
  }

  /** Quick health probe — does NOT load a model, just checks the server is up. */
  async isAvailable(): Promise<boolean> {
    try {
      const resp = await fetch(`${this.endpoint}/health`);
      return resp.ok;
    } catch {
      return false;
    }
  }

  /**
   * Transcribe an audio buffer. Returns the transcript (trimmed) or '' if
   * the server responds but doesn't produce text (e.g., silent clip).
   * Throws on HTTP errors or network failures so callers can decide whether
   * to retry or mark the message as un-transcribed.
   */
  async transcribe(audio: Uint8Array, opts: TranscribeOptions = {}): Promise<string> {
    const form = new FormData();
    // Cast through ArrayBufferLike — Blob accepts BlobPart which includes
    // ArrayBuffer views, but TS's Uint8Array<ArrayBufferLike> union (which
    // includes SharedArrayBuffer) confuses the typechecker. The cast is safe
    // because our callers always pass non-shared buffers.
    const blob = new Blob([audio as unknown as Uint8Array<ArrayBuffer>], {
      type: opts.contentType || 'audio/wav',
    });
    form.append('file', blob, opts.filename || 'voice.wav');
    if (opts.language) {
      form.append('language', opts.language);
      // whisper.cpp server also accepts temperature, response_format, etc.
      // Defaults are fine for our use case; temperature=0 gets deterministic output.
      form.append('temperature', '0');
    }
    form.append('response_format', 'json');

    const resp = await fetch(`${this.endpoint}/inference`, {
      method: 'POST',
      body: form,
    });

    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      throw new Error(`Whisper API error: ${resp.status} ${detail.slice(0, 200)}`);
    }

    const body: { text?: string } = await resp.json();
    return (body.text ?? '').trim();
  }
}
