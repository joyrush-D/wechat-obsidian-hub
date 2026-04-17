/**
 * VoiceCache — content-addressed persistent cache for voice transcripts.
 *
 * Keyed by MD5 hash of the audio bytes (via hashKey()). The same audio never
 * gets re-transcribed, even across plugin restarts.
 *
 * Layout on disk:
 *   <cacheDir>/index.json     { [key]: transcript, ... }
 *
 * We keep everything in one JSON file because:
 *   - entries are tiny (hash key + short text)
 *   - a single file is atomic to replace and easy to back up
 *   - expected scale is 50-500 voice messages/day, order of MBs/year
 *
 * If the cache file ever grows past ~50MB we'll split into shards.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';

export class VoiceCache {
  private dir: string;
  private indexPath: string;
  private store: Record<string, string>;

  constructor(dir: string) {
    this.dir = dir;
    this.indexPath = join(dir, 'index.json');
    this.store = this.load();
  }

  private load(): Record<string, string> {
    if (!existsSync(this.dir)) {
      mkdirSync(this.dir, { recursive: true });
    }
    if (!existsSync(this.indexPath)) return {};
    try {
      const raw = readFileSync(this.indexPath, 'utf-8');
      const parsed = JSON.parse(raw);
      return typeof parsed === 'object' && parsed !== null ? parsed : {};
    } catch {
      return {};
    }
  }

  private persist(): void {
    writeFileSync(this.indexPath, JSON.stringify(this.store), 'utf-8');
  }

  /** Compute a content hash for cache keying. */
  static hashKey(audio: Uint8Array): string {
    return createHash('md5').update(audio).digest('hex');
  }

  /** Get a cached transcript, or null if not cached. Empty-string is valid. */
  get(key: string): string | null {
    return Object.prototype.hasOwnProperty.call(this.store, key) ? this.store[key] : null;
  }

  put(key: string, transcript: string): void {
    this.store[key] = transcript;
    this.persist();
  }

  size(): number {
    return Object.keys(this.store).length;
  }

  clear(): void {
    this.store = {};
    this.persist();
  }
}
