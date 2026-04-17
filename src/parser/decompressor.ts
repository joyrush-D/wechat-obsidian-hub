import { unzlibSync, inflateSync } from 'fflate';
import { decompress as fzstdDecompress } from 'fzstd';

/**
 * No-op for backward compat (fzstd is synchronous, no init needed).
 */
export async function initZstd(): Promise<void> {}

/**
 * Decompress content from compress_content / message_content fields.
 * Supports zstd (Mac WeChat 4.x WCDB), zlib, and raw deflate.
 */
export function decompressContent(data: Uint8Array | null): string | null {
  if (!data || data.length === 0) return null;

  // zstd magic: 28 b5 2f fd
  if (data[0] === 0x28 && data[1] === 0xb5 && data[2] === 0x2f && data[3] === 0xfd) {
    try {
      const d = fzstdDecompress(data);
      return new TextDecoder('utf-8', { fatal: false }).decode(d);
    } catch {
      return null;
    }
  }

  // zlib: 78 9c / 78 01 / 78 da
  if (data[0] === 0x78 && (data[1] === 0x9c || data[1] === 0x01 || data[1] === 0xda)) {
    try {
      const d = unzlibSync(data);
      return new TextDecoder('utf-8', { fatal: false }).decode(d);
    } catch { /* fall through */ }
  }

  // raw deflate
  try {
    const d = inflateSync(data);
    return new TextDecoder('utf-8', { fatal: false }).decode(d);
  } catch { /* fall through */ }

  return null;
}
