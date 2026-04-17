/**
 * SilkDecoder — wraps a silk_v3_decoder CLI to convert WeChat .silk audio
 * into .wav that whisper.cpp can transcribe.
 *
 * Recommended backend: https://github.com/kn007/silk-v3-decoder
 *   brew tap kn007/silk-v3-decoder
 *   brew install silk-v3-decoder
 *   # produces /opt/homebrew/bin/silk_v3_decoder
 *
 * Design:
 *   - Accept a SilkRunner (child_process spawner) via DI → testable without binary
 *   - Write silk bytes to a temp file, call the binary, read wav output
 *   - Clean up temp files in finally block (no leaks on error)
 *   - Fail soft: caller decides whether to skip the voice or abort the run
 */

import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawn } from 'child_process';

export type SilkRunner = (
  binary: string,
  args: string[],
) => Promise<{ stdout: string; stderr: string }>;

/** Default runner spawns an actual child process. */
const defaultRunner: SilkRunner = (binary, args) => new Promise((resolve, reject) => {
  const proc = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  proc.stdout.on('data', d => { stdout += d.toString(); });
  proc.stderr.on('data', d => { stderr += d.toString(); });
  proc.on('error', reject);
  proc.on('close', code => {
    if (code === 0) resolve({ stdout, stderr });
    else reject(new Error(`silk decoder exited ${code}: ${stderr.slice(0, 200) || stdout.slice(0, 200)}`));
  });
});

export interface SilkDecoderOptions {
  /** Absolute path or PATH-resolvable name of the silk_v3_decoder binary. */
  binary?: string;
  /** Override for testing — defaults to spawning a real child process. */
  runner?: SilkRunner;
}

export class SilkDecoder {
  private binary: string;
  private runner: SilkRunner;

  constructor(opts: SilkDecoderOptions = {}) {
    this.binary = opts.binary || 'silk_v3_decoder';
    this.runner = opts.runner || defaultRunner;
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.runner(this.binary, ['--version']);
      return true;
    } catch {
      return false;
    }
  }

  async decode(silk: Uint8Array): Promise<Uint8Array> {
    const workDir = mkdtempSync(join(tmpdir(), 'owh-silk-'));
    const inPath = join(workDir, 'in.silk');
    const outPath = join(workDir, 'out.wav');

    try {
      writeFileSync(inPath, silk);
      await this.runner(this.binary, [inPath, outPath]);
      if (!existsSync(outPath)) {
        throw new Error('silk decoder did not produce output .wav file');
      }
      return new Uint8Array(readFileSync(outPath));
    } finally {
      try { if (existsSync(inPath)) unlinkSync(inPath); } catch { /* swallow */ }
      try { if (existsSync(outPath)) unlinkSync(outPath); } catch { /* swallow */ }
      try { rmSync(workDir, { recursive: true, force: true }); } catch { /* swallow */ }
    }
  }
}
