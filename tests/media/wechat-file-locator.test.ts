/**
 * Tests for WeChatFileLocator — finds voice/image files on disk from message metadata.
 * Uses a sandboxed temp directory as the fake "WeChat media root" so tests are deterministic.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { WeChatFileLocator } from '../../src/media/wechat-file-locator';

describe('WeChatFileLocator', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'owh-wx-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function touch(...segments: string[]): string {
    const full = join(root, ...segments);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, 'FAKE_BYTES');
    return full;
  }

  describe('findVoice', () => {
    it('returns null when media root is empty string (plugin disabled)', () => {
      const loc = new WeChatFileLocator('');
      expect(loc.findVoice({ localId: 42 })).toBeNull();
    });

    it('returns null when nothing matches', () => {
      const loc = new WeChatFileLocator(root);
      expect(loc.findVoice({ localId: 999 })).toBeNull();
    });

    it('finds .silk file by localId substring', () => {
      const expected = touch('msg_attach/voice/msg_42.silk');
      const loc = new WeChatFileLocator(root);
      expect(loc.findVoice({ localId: 42 })).toBe(expected);
    });

    it('prefers .wav over .silk when both present (pre-decoded cache)', () => {
      touch('msg_attach/voice/msg_42.silk');
      const wav = touch('msg_attach/voice/msg_42.wav');
      const loc = new WeChatFileLocator(root);
      expect(loc.findVoice({ localId: 42 })).toBe(wav);
    });

    it('also accepts .amr (older WeChat variants)', () => {
      const expected = touch('msg_attach/voice/msg_77.amr');
      const loc = new WeChatFileLocator(root);
      expect(loc.findVoice({ localId: 77 })).toBe(expected);
    });

    it('falls back to md5 hint when localId does not match a file', () => {
      const expected = touch('media/audio/voice_abc123def.silk');
      const loc = new WeChatFileLocator(root);
      expect(loc.findVoice({ localId: 1, md5: 'abc123def' })).toBe(expected);
    });

    it('scans multiple candidate directories', () => {
      const expected = touch('Voice/2025/01/msg_55.silk');
      const loc = new WeChatFileLocator(root);
      expect(loc.findVoice({ localId: 55 })).toBe(expected);
    });
  });

  describe('findImage', () => {
    it('returns null when root empty', () => {
      expect(new WeChatFileLocator('').findImage({ md5: 'abc' })).toBeNull();
    });

    it('finds image by md5 filename', () => {
      const expected = touch('msg_attach/image/abc123.jpg');
      const loc = new WeChatFileLocator(root);
      expect(loc.findImage({ md5: 'abc123' })).toBe(expected);
    });

    it('prefers original quality over thumbnail', () => {
      touch('msg_attach/image/abc.th.jpg');            // thumbnail
      const orig = touch('msg_attach/image/abc.jpg');  // original
      const loc = new WeChatFileLocator(root);
      expect(loc.findImage({ md5: 'abc' })).toBe(orig);
    });

    it('returns null when only thumbnail is present (not worth OCR)', () => {
      touch('msg_attach/image/abc.th.jpg');
      const loc = new WeChatFileLocator(root);
      expect(loc.findImage({ md5: 'abc' })).toBeNull();
    });

    it('handles png/jpeg/webp extensions', () => {
      const png = touch('Image/abc1.png');
      const loc = new WeChatFileLocator(root);
      expect(loc.findImage({ md5: 'abc1' })).toBe(png);
    });

    it('falls back to localId hint', () => {
      const expected = touch('Image/2025/msg_100.png');
      const loc = new WeChatFileLocator(root);
      expect(loc.findImage({ localId: 100 })).toBe(expected);
    });
  });

  describe('safety', () => {
    it('does not crash on missing media root directory', () => {
      const loc = new WeChatFileLocator(join(root, 'does', 'not', 'exist'));
      expect(() => loc.findVoice({ localId: 1 })).not.toThrow();
      expect(loc.findVoice({ localId: 1 })).toBeNull();
    });

    it('ignores matches in non-media directories (e.g. decrypted DB files)', () => {
      touch('db_storage/message/message_0.db');
      touch('logs/msg_42.log');
      const loc = new WeChatFileLocator(root);
      expect(loc.findVoice({ localId: 42 })).toBeNull();
    });
  });
});
