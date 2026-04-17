/**
 * Tests for SilkDecoder — wraps a silk_v3_decoder CLI call to convert
 * WeChat .silk audio into .wav (whisper-compatible) bytes.
 *
 * Uses dependency injection: real implementations spawn a child process,
 * tests inject a fake runner so no binary install is needed.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SilkDecoder, type SilkRunner } from '../../src/media/silk-decoder';

function fakeRunnerWritesWav(wavBytes: Uint8Array): SilkRunner {
  return async (_binary, args) => {
    // Convention: args = [<input>, <output>]
    const outputPath = args[args.length - 1];
    writeFileSync(outputPath, wavBytes);
    return { stdout: '', stderr: '' };
  };
}

describe('SilkDecoder', () => {
  it('writes silk input to temp file and reads wav output', async () => {
    const silk = new Uint8Array([0x02, 0x23, 0x21, 0x53, 0x49, 0x4C, 0x4B]);   // "#!SILK"-ish header
    const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00]);  // "RIFF"-ish

    const decoder = new SilkDecoder({
      binary: 'silk_v3_decoder',
      runner: fakeRunnerWritesWav(wav),
    });

    const result = await decoder.decode(silk);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(Array.from(result.slice(0, 4))).toEqual([0x52, 0x49, 0x46, 0x46]);
  });

  it('passes the input path as first arg and output as last', async () => {
    const silk = new Uint8Array([1, 2, 3]);
    const capturedArgs: string[] = [];
    const decoder = new SilkDecoder({
      binary: 'silk_decoder',
      runner: async (_binary, args) => {
        capturedArgs.push(...args);
        writeFileSync(args[args.length - 1], new Uint8Array([0, 0, 0, 0]));
        return { stdout: '', stderr: '' };
      },
    });

    await decoder.decode(silk);
    expect(capturedArgs.length).toBeGreaterThanOrEqual(2);
    // First arg is the temp input file path (contains .silk)
    expect(capturedArgs[0]).toMatch(/\.silk$/);
    // Last arg is the temp output file path (contains .wav)
    expect(capturedArgs[capturedArgs.length - 1]).toMatch(/\.wav$/);
  });

  it('cleans up temp files after success', async () => {
    const silk = new Uint8Array([1, 2, 3]);
    const capturedPaths: string[] = [];
    const decoder = new SilkDecoder({
      binary: 'x',
      runner: async (_binary, args) => {
        capturedPaths.push(...args);
        writeFileSync(args[args.length - 1], new Uint8Array([0, 0, 0, 0]));
        return { stdout: '', stderr: '' };
      },
    });

    await decoder.decode(silk);
    // After decode, neither the input nor output temp file should remain
    for (const p of capturedPaths) {
      expect(() => readFileSync(p)).toThrow();
    }
  });

  it('throws a descriptive error when runner exits non-zero', async () => {
    const silk = new Uint8Array([1, 2, 3]);
    const decoder = new SilkDecoder({
      binary: 'x',
      runner: async () => {
        throw new Error('exit code 1: bad silk header');
      },
    });
    await expect(decoder.decode(silk)).rejects.toThrow(/bad silk header/);
  });

  it('throws when runner succeeds but produces no output file', async () => {
    const silk = new Uint8Array([1, 2, 3]);
    const decoder = new SilkDecoder({
      binary: 'x',
      runner: async () => ({ stdout: 'ok', stderr: '' }),   // pretends success, doesn't write file
    });
    await expect(decoder.decode(silk)).rejects.toThrow(/output/i);
  });

  it('cleans up temp files even when decoder fails (no leaks)', async () => {
    const silk = new Uint8Array([1, 2, 3]);
    const captured: string[] = [];
    const decoder = new SilkDecoder({
      binary: 'x',
      runner: async (_binary, args) => {
        captured.push(...args);
        throw new Error('simulated failure');
      },
    });

    await expect(decoder.decode(silk)).rejects.toThrow();
    for (const p of captured) {
      expect(() => readFileSync(p)).toThrow();   // all cleaned up
    }
  });

  describe('isAvailable()', () => {
    it('returns true when the binary runs (even with non-zero exit)', async () => {
      const decoder = new SilkDecoder({
        binary: 'x',
        runner: async () => ({ stdout: 'v3.0', stderr: '' }),
      });
      expect(await decoder.isAvailable()).toBe(true);
    });

    it('returns false when binary is not found (ENOENT)', async () => {
      const decoder = new SilkDecoder({
        binary: 'x',
        runner: async () => { throw new Error('ENOENT'); },
      });
      expect(await decoder.isAvailable()).toBe(false);
    });
  });
});
