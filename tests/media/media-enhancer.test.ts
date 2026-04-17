/**
 * Tests for MediaEnhancer — the top-level orchestrator that turns placeholder
 * voice/image messages into text the analyst pipeline can use.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { MediaEnhancer } from '../../src/media/media-enhancer';
import type { VoiceProcessor } from '../../src/media/voice-processor';
import type { ImageProcessor } from '../../src/media/image-processor';
import type { WeChatFileLocator } from '../../src/media/wechat-file-locator';
import type { SilkDecoder } from '../../src/media/silk-decoder';
import type { ParsedMessage } from '../../src/types';

function makeMsg(overrides: Partial<ParsedMessage>): ParsedMessage {
  return {
    localId: 1,
    time: new Date('2024-01-15T09:30:00'),
    conversationId: 'g@chatroom',
    conversationName: 'Group',
    sender: 'Alice',
    senderWxid: 'wxid_a',
    text: '[voice]',
    type: 'voice',
    extra: {},
    ...overrides,
  };
}

function makeVoiceProcessor(transcript = '测试转写'): VoiceProcessor {
  return {
    transcribe: vi.fn().mockResolvedValue(transcript),
    isAvailable: vi.fn().mockResolvedValue(true),
  } as unknown as VoiceProcessor;
}

function makeImageProcessor(result = { route: 'ocr' as const, text: '截图文字' }): ImageProcessor {
  return {
    analyze: vi.fn().mockResolvedValue(result),
    isAvailable: vi.fn().mockResolvedValue({ ocr: true, vlm: true }),
  } as unknown as ImageProcessor;
}

describe('MediaEnhancer', () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'owh-enh-'));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  function writeFake(path: string, bytes: number[] = [1, 2, 3]): string {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, new Uint8Array(bytes));
    return path;
  }

  function makeLocator(voiceMap: Record<number, string | null>, imageMap: Record<number, string | null>): WeChatFileLocator {
    return {
      findVoice: ({ localId }: { localId?: number }) => voiceMap[localId ?? 0] ?? null,
      findImage: ({ localId }: { localId?: number }) => imageMap[localId ?? 0] ?? null,
    } as unknown as WeChatFileLocator;
  }

  describe('voice transcription', () => {
    it('transcribes voice messages when all deps present', async () => {
      const voicePath = writeFake(join(workDir, 'msg_1.wav'));
      const msg = makeMsg({ localId: 1, type: 'voice', text: '[voice]' });
      const enhancer = new MediaEnhancer({
        voiceProcessor: makeVoiceProcessor('你好 周五下午三点开会'),
        locator: makeLocator({ 1: voicePath }, {}),
      });

      const stats = await enhancer.enhance([msg]);
      expect(stats.voiceAttempted).toBe(1);
      expect(stats.voiceSucceeded).toBe(1);
      expect(msg.text).toBe('[语音] 你好 周五下午三点开会');
      expect(msg.extra.transcript).toBe('你好 周五下午三点开会');
    });

    it('preserves placeholder when voice file not found on disk', async () => {
      const msg = makeMsg({ localId: 42, type: 'voice', text: '[voice]' });
      const processor = makeVoiceProcessor();
      const enhancer = new MediaEnhancer({
        voiceProcessor: processor,
        locator: makeLocator({}, {}),
      });

      await enhancer.enhance([msg]);
      expect(msg.text).toBe('[voice]');
      expect(processor.transcribe).not.toHaveBeenCalled();
    });

    it('preserves placeholder when whisper throws', async () => {
      const voicePath = writeFake(join(workDir, 'msg_1.wav'));
      const msg = makeMsg({ localId: 1, type: 'voice', text: '[voice]' });
      const enhancer = new MediaEnhancer({
        voiceProcessor: { transcribe: vi.fn().mockRejectedValue(new Error('whisper down')) } as any,
        locator: makeLocator({ 1: voicePath }, {}),
      });

      const stats = await enhancer.enhance([msg]);
      expect(stats.voiceAttempted).toBe(1);
      expect(stats.voiceSucceeded).toBe(0);
      expect(stats.errors).toHaveLength(1);
      expect(stats.errors[0]).toContain('whisper down');
      expect(msg.text).toBe('[voice]');   // preserved
    });

    it('decodes .silk through SilkDecoder before transcribing', async () => {
      const silkPath = writeFake(join(workDir, 'msg_1.silk'), [2, 0x23, 0x21, 0x53, 0x49, 0x4C, 0x4B]);
      const msg = makeMsg({ localId: 1, type: 'voice' });
      const processor = makeVoiceProcessor('解码后转写');
      const silkDecoder = {
        decode: vi.fn().mockResolvedValue(new Uint8Array([0x52, 0x49, 0x46, 0x46])),   // fake WAV bytes
      } as unknown as SilkDecoder;

      const enhancer = new MediaEnhancer({
        voiceProcessor: processor,
        locator: makeLocator({ 1: silkPath }, {}),
        silkDecoder,
      });

      await enhancer.enhance([msg]);
      expect(silkDecoder.decode).toHaveBeenCalledOnce();
      expect(processor.transcribe).toHaveBeenCalledOnce();
      expect(msg.text).toBe('[语音] 解码后转写');
    });

    it('skips .silk when no silkDecoder provided (opt-out via missing dep)', async () => {
      const silkPath = writeFake(join(workDir, 'msg_1.silk'));
      const msg = makeMsg({ localId: 1, type: 'voice' });
      const processor = makeVoiceProcessor();

      const enhancer = new MediaEnhancer({
        voiceProcessor: processor,
        locator: makeLocator({ 1: silkPath }, {}),
        // silkDecoder intentionally omitted
      });

      await enhancer.enhance([msg]);
      expect(processor.transcribe).not.toHaveBeenCalled();
      expect(msg.text).toBe('[voice]');
    });

    it('skips voice processing entirely when voiceProcessor not configured', async () => {
      const msg = makeMsg({ type: 'voice' });
      const enhancer = new MediaEnhancer({
        locator: makeLocator({ 1: '/fake/path' }, {}),
      });
      const stats = await enhancer.enhance([msg]);
      expect(stats.voiceAttempted).toBe(0);
      expect(msg.text).toBe('[voice]');
    });
  });

  describe('image analysis', () => {
    it('OCR result populates text with [图片文字] prefix', async () => {
      const imgPath = writeFake(join(workDir, 'abc.png'));
      const msg = makeMsg({ localId: 2, type: 'image', text: '[image]' });
      const enhancer = new MediaEnhancer({
        imageProcessor: makeImageProcessor({ route: 'ocr', text: '合同金额 10 万元' }),
        locator: makeLocator({}, { 2: imgPath }),
      });

      await enhancer.enhance([msg]);
      expect(msg.text).toBe('[图片文字] 合同金额 10 万元');
      expect(msg.extra.image_route).toBe('ocr');
    });

    it('VLM result populates text with [图片] prefix', async () => {
      const imgPath = writeFake(join(workDir, 'photo.jpg'));
      const msg = makeMsg({ localId: 3, type: 'image', text: '[image]' });
      const enhancer = new MediaEnhancer({
        imageProcessor: makeImageProcessor({ route: 'vlm', text: '一张海边夕阳照' }),
        locator: makeLocator({}, { 3: imgPath }),
      });

      await enhancer.enhance([msg]);
      expect(msg.text).toBe('[图片] 一张海边夕阳照');
      expect(msg.extra.image_route).toBe('vlm');
    });

    it('preserves placeholder when image file not found', async () => {
      const msg = makeMsg({ localId: 3, type: 'image', text: '[image]' });
      const enhancer = new MediaEnhancer({
        imageProcessor: makeImageProcessor(),
        locator: makeLocator({}, {}),
      });
      await enhancer.enhance([msg]);
      expect(msg.text).toBe('[image]');
    });

    it('empty OCR result shows "无可识别内容"', async () => {
      const imgPath = writeFake(join(workDir, 'blank.png'));
      const msg = makeMsg({ localId: 4, type: 'image', text: '[image]' });
      const enhancer = new MediaEnhancer({
        imageProcessor: makeImageProcessor({ route: 'ocr', text: '' }),
        locator: makeLocator({}, { 4: imgPath }),
      });
      await enhancer.enhance([msg]);
      expect(msg.text).toBe('[图片文字] 无可识别内容');
    });
  });

  describe('concurrency and stats', () => {
    it('processes multiple messages and reports accurate stats', async () => {
      const v1 = writeFake(join(workDir, 'v1.wav'));
      const v2 = writeFake(join(workDir, 'v2.wav'));
      const i1 = writeFake(join(workDir, 'i1.png'));

      const msgs = [
        makeMsg({ localId: 1, type: 'voice' }),
        makeMsg({ localId: 2, type: 'voice' }),
        makeMsg({ localId: 3, type: 'image' }),
        makeMsg({ localId: 4, type: 'text', text: 'ignore me' }),
      ];

      const enhancer = new MediaEnhancer({
        voiceProcessor: makeVoiceProcessor('OK'),
        imageProcessor: makeImageProcessor(),
        locator: makeLocator({ 1: v1, 2: v2 }, { 3: i1 }),
        concurrency: 2,
      });

      const stats = await enhancer.enhance(msgs);
      expect(stats.voiceAttempted).toBe(2);
      expect(stats.voiceSucceeded).toBe(2);
      expect(stats.imageAttempted).toBe(1);
      expect(stats.imageSucceeded).toBe(1);
      expect(msgs[0].text).toMatch(/^\[语音\]/);
      expect(msgs[3].text).toBe('ignore me');   // text unchanged
    });

    it('onProgress is called for each processed message', async () => {
      const v1 = writeFake(join(workDir, 'v1.wav'));
      const v2 = writeFake(join(workDir, 'v2.wav'));
      const msgs = [
        makeMsg({ localId: 1, type: 'voice' }),
        makeMsg({ localId: 2, type: 'voice' }),
      ];
      const progress: Array<{ done: number; total: number; kind: string }> = [];
      const enhancer = new MediaEnhancer({
        voiceProcessor: makeVoiceProcessor('x'),
        locator: makeLocator({ 1: v1, 2: v2 }, {}),
        onProgress: (done, total, kind) => progress.push({ done, total, kind }),
      });

      await enhancer.enhance(msgs);
      expect(progress.length).toBe(2);
    });
  });
});
