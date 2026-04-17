/**
 * VoiceProcessor — orchestration layer combining WhisperClient + VoiceCache.
 *
 * Callers hand it raw audio bytes; the processor:
 *   1. computes content hash → cache key
 *   2. returns cached transcript if present (including empty-string "known silent")
 *   3. otherwise calls WhisperClient.transcribe, caches the result, returns it
 *
 * Failures from the client propagate as exceptions so the caller can decide
 * whether to mark the message un-transcribed and continue, vs. abort the run.
 */

import type { WhisperClient, TranscribeOptions } from './whisper-client';
import type { VoiceCache } from './voice-cache';

export class VoiceProcessor {
  constructor(
    private client: WhisperClient,
    private cache: VoiceCache,
  ) {}

  /**
   * Transcribe an audio buffer with caching. Returns the transcript,
   * possibly an empty string (for silent audio — still cacheable so we
   * don't re-run whisper on it).
   */
  async transcribe(audio: Uint8Array, opts: TranscribeOptions = {}): Promise<string> {
    const key = this.cache.constructor.name === 'VoiceCache'
      ? (this.cache.constructor as typeof VoiceCache & { hashKey: (a: Uint8Array) => string }).hashKey(audio)
      : hashFallback(audio);

    const cached = this.cache.get(key);
    if (cached !== null) return cached;

    const transcript = await this.client.transcribe(audio, opts);
    this.cache.put(key, transcript);
    return transcript;
  }

  /** Health check — true if the underlying Whisper server is reachable. */
  async isAvailable(): Promise<boolean> {
    return this.client.isAvailable();
  }
}

// Fallback (should never fire in production — kept for type safety)
function hashFallback(audio: Uint8Array): string {
  return require('crypto').createHash('md5').update(audio).digest('hex');
}
