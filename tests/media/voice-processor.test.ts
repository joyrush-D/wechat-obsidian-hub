/**
 * Integration-style tests for VoiceProcessor — the cache-aware orchestrator.
 * Uses the real VoiceCache (temp dir) + a mocked WhisperClient to prove the
 * cache short-circuits the network call on second invocation.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { VoiceCache } from '../../src/media/voice-cache';
import { VoiceProcessor } from '../../src/media/voice-processor';
import type { WhisperClient } from '../../src/media/whisper-client';

function makeMockClient(transcribeImpl?: (audio: Uint8Array) => Promise<string>): WhisperClient {
  return {
    endpoint: 'http://localhost:8081',
    isAvailable: vi.fn().mockResolvedValue(true),
    transcribe: vi.fn(transcribeImpl ?? (async () => '模拟转写结果')),
  } as unknown as WhisperClient;
}

describe('VoiceProcessor', () => {
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), 'owh-vp-'));
  });

  afterEach(() => {
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it('calls whisper on first transcribe, hits cache on second', async () => {
    const audio = new Uint8Array([10, 20, 30, 40, 50]);
    const client = makeMockClient();
    const cache = new VoiceCache(cacheDir);
    const proc = new VoiceProcessor(client, cache);

    const first = await proc.transcribe(audio);
    const second = await proc.transcribe(audio);

    expect(first).toBe('模拟转写结果');
    expect(second).toBe('模拟转写结果');
    expect(client.transcribe).toHaveBeenCalledTimes(1);   // cache shielded second call
  });

  it('different audio contents produce independent cache entries', async () => {
    const a = new Uint8Array([1, 1, 1]);
    const b = new Uint8Array([2, 2, 2]);
    let callCount = 0;
    const client = makeMockClient(async (audio) => {
      callCount++;
      return `result-${audio[0]}`;
    });
    const proc = new VoiceProcessor(client, new VoiceCache(cacheDir));

    expect(await proc.transcribe(a)).toBe('result-1');
    expect(await proc.transcribe(b)).toBe('result-2');
    expect(await proc.transcribe(a)).toBe('result-1');   // cached
    expect(await proc.transcribe(b)).toBe('result-2');   // cached
    expect(callCount).toBe(2);   // only 2 real transcribe calls
  });

  it('empty transcript is cached (prevents re-running on known-silent audio)', async () => {
    const audio = new Uint8Array([0, 0, 0]);
    const client = makeMockClient(async () => '');
    const proc = new VoiceProcessor(client, new VoiceCache(cacheDir));

    expect(await proc.transcribe(audio)).toBe('');
    expect(await proc.transcribe(audio)).toBe('');
    expect(client.transcribe).toHaveBeenCalledTimes(1);
  });

  it('propagates whisper errors (caller decides retry/skip)', async () => {
    const audio = new Uint8Array([9, 9, 9]);
    const client = makeMockClient(async () => { throw new Error('Whisper 500'); });
    const proc = new VoiceProcessor(client, new VoiceCache(cacheDir));

    await expect(proc.transcribe(audio)).rejects.toThrow('Whisper 500');

    // Error path must NOT cache — next attempt should retry
    const client2 = makeMockClient(async () => 'recovered');
    const proc2 = new VoiceProcessor(client2, new VoiceCache(cacheDir));
    expect(await proc2.transcribe(audio)).toBe('recovered');
  });

  it('cache persists across processor instances', async () => {
    const audio = new Uint8Array([7, 7, 7]);
    const client1 = makeMockClient(async () => 'first-instance');
    const proc1 = new VoiceProcessor(client1, new VoiceCache(cacheDir));
    await proc1.transcribe(audio);

    // New processor reading same cache dir
    const client2 = makeMockClient(async () => 'should-not-be-called');
    const proc2 = new VoiceProcessor(client2, new VoiceCache(cacheDir));
    const result = await proc2.transcribe(audio);

    expect(result).toBe('first-instance');
    expect(client2.transcribe).not.toHaveBeenCalled();
  });

  it('isAvailable delegates to underlying client', async () => {
    const client = makeMockClient();
    const proc = new VoiceProcessor(client, new VoiceCache(cacheDir));
    expect(await proc.isAvailable()).toBe(true);
    expect(client.isAvailable).toHaveBeenCalled();
  });
});
