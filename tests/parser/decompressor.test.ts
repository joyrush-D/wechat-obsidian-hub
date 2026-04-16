import { describe, it, expect } from 'vitest';
import { zlibSync, deflateSync } from 'fflate';
import { decompressContent } from '../../src/parser/decompressor';

describe('decompressContent', () => {
  it('returns null for null input', () => {
    expect(decompressContent(null)).toBeNull();
  });

  it('returns null for empty Uint8Array', () => {
    expect(decompressContent(new Uint8Array(0))).toBeNull();
  });

  it('decompresses valid zlib-compressed data (78 9c header)', () => {
    const text = 'Hello, WeChat!';
    const encoded = new TextEncoder().encode(text);
    const compressed = zlibSync(encoded, { level: 6 }); // produces zlib format (78 9c)
    expect(compressed[0]).toBe(0x78); // verify it's a zlib header
    const result = decompressContent(compressed);
    expect(result).toBe(text);
  });

  it('decompresses raw deflate data (no zlib header)', () => {
    const text = 'Low compression test string';
    const encoded = new TextEncoder().encode(text);
    const compressed = deflateSync(encoded, { level: 1 }); // produces raw deflate
    // Raw deflate path - first byte is not 0x78
    const result = decompressContent(compressed);
    expect(result).toBe(text);
  });

  it('detects zstd magic bytes and returns null when no decompressor available', () => {
    // zstd magic: 28 b5 2f fd
    const fakeZstd = new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0x00, 0x00, 0x00]);
    // Without initZstd() called, zstdDecompressor is null => returns null
    const result = decompressContent(fakeZstd);
    expect(result).toBeNull();
  });

  it('returns null for completely invalid/random data', () => {
    // Data that is not valid compressed in any format
    const garbage = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05]);
    const result = decompressContent(garbage);
    expect(result).toBeNull();
  });

  it('decompresses Chinese text correctly', () => {
    const text = '你好，微信！';
    const encoded = new TextEncoder().encode(text);
    const compressed = zlibSync(encoded, { level: 6 });
    const result = decompressContent(compressed);
    expect(result).toBe(text);
  });
});
