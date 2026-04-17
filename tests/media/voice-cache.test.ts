/**
 * Tests for VoiceCache — content-hashed persistent cache for voice transcripts.
 * Prevents re-transcribing the same audio on every briefing generation.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { VoiceCache } from '../../src/media/voice-cache';

describe('VoiceCache', () => {
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), 'owh-voice-cache-'));
  });

  afterEach(() => {
    if (existsSync(cacheDir)) rmSync(cacheDir, { recursive: true, force: true });
  });

  describe('put / get', () => {
    it('returns null for a key that was never stored', () => {
      const c = new VoiceCache(cacheDir);
      expect(c.get('nonexistent')).toBeNull();
    });

    it('round-trips a transcript by key', () => {
      const c = new VoiceCache(cacheDir);
      c.put('key1', 'hello world');
      expect(c.get('key1')).toBe('hello world');
    });

    it('supports Chinese and mixed text', () => {
      const c = new VoiceCache(cacheDir);
      c.put('zh', '你好 Claude，今天下午 3 点开会');
      expect(c.get('zh')).toBe('你好 Claude，今天下午 3 点开会');
    });

    it('overwrites previous value for same key', () => {
      const c = new VoiceCache(cacheDir);
      c.put('k', 'first');
      c.put('k', 'second');
      expect(c.get('k')).toBe('second');
    });

    it('treats empty string as a valid cached value (distinct from null)', () => {
      const c = new VoiceCache(cacheDir);
      c.put('silent_audio', '');
      expect(c.get('silent_audio')).toBe('');
      expect(c.get('silent_audio')).not.toBeNull();
    });
  });

  describe('persistence across instances', () => {
    it('second instance reads values written by the first', () => {
      const a = new VoiceCache(cacheDir);
      a.put('persisted', 'stored text');

      const b = new VoiceCache(cacheDir);
      expect(b.get('persisted')).toBe('stored text');
    });

    it('creates cache directory if it does not exist', () => {
      const nested = join(cacheDir, 'deep', 'nested');
      const c = new VoiceCache(nested);
      c.put('k', 'v');
      expect(existsSync(nested)).toBe(true);
      expect(c.get('k')).toBe('v');
    });
  });

  describe('hashKey helper', () => {
    it('produces the same key for identical buffers', () => {
      const buf = new Uint8Array([1, 2, 3, 4, 5]);
      expect(VoiceCache.hashKey(buf)).toBe(VoiceCache.hashKey(buf));
    });

    it('produces different keys for different buffers', () => {
      const a = new Uint8Array([1, 2, 3]);
      const b = new Uint8Array([1, 2, 4]);
      expect(VoiceCache.hashKey(a)).not.toBe(VoiceCache.hashKey(b));
    });

    it('returns a hex string (no weird chars)', () => {
      const key = VoiceCache.hashKey(new Uint8Array([1, 2, 3]));
      expect(key).toMatch(/^[a-f0-9]+$/);
      expect(key.length).toBeGreaterThanOrEqual(16);
    });
  });

  describe('size / clear', () => {
    it('reports size 0 on a new instance', () => {
      const c = new VoiceCache(cacheDir);
      expect(c.size()).toBe(0);
    });

    it('reports correct size after puts', () => {
      const c = new VoiceCache(cacheDir);
      c.put('a', 'x');
      c.put('b', 'y');
      c.put('c', 'z');
      expect(c.size()).toBe(3);
    });

    it('clear empties the cache', () => {
      const c = new VoiceCache(cacheDir);
      c.put('a', 'x');
      c.put('b', 'y');
      c.clear();
      expect(c.size()).toBe(0);
      expect(c.get('a')).toBeNull();
    });
  });
});
