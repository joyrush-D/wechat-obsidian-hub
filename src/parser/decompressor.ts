import { unzlibSync, inflateSync } from 'fflate';

let zstdDecompressor: ((data: Uint8Array) => Uint8Array) | null = null;

export async function initZstd(): Promise<void> {
  try {
    const ZstdCodec = await import('zstd-codec');
    await new Promise<void>((resolve) => {
      ZstdCodec.ZstdCodec.run((zstd: any) => {
        const simple = new zstd.Simple();
        zstdDecompressor = (data: Uint8Array) => simple.decompress(data);
        resolve();
      });
    });
  } catch {
    console.log('OWH: zstd-codec not available');
  }
}

export function decompressContent(data: Uint8Array | null): string | null {
  if (!data || data.length === 0) return null;

  // zstd magic: 28 b5 2f fd
  if (data[0] === 0x28 && data[1] === 0xb5 && data[2] === 0x2f && data[3] === 0xfd) {
    if (zstdDecompressor) {
      try {
        const d = zstdDecompressor(data);
        return new TextDecoder('utf-8', { fatal: false }).decode(d);
      } catch { /* fall through */ }
    }
    return null;
  }

  // zlib: 78 9c or 78 01
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
