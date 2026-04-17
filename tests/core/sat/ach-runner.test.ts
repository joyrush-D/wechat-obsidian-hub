/**
 * Integration tests for the ACH runner — uses real EvidenceStore
 * (temp dir) + mocked LLM to verify the full pipeline wires correctly.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { EvidenceStore } from '../../../src/core/storage/evidence-store';
import type { WxObject } from '../../../src/core/types/domain';
import { collectEvidence, runAch, type AchLlm } from '../../../src/core/sat/ach-runner';

const NOW = '2026-04-18T10:00:00Z';

function makeObject(id: string, text: string, kind: WxObject['kind'] = 'message'): WxObject {
  return {
    id, type: 'object', createdAt: NOW, sourceAdapter: 'wechat',
    kind, text, occurredAt: NOW,
  };
}

describe('collectEvidence', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'owh-ach-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('returns objects matching keyword, filtered by length', () => {
    const store = new EvidenceStore(dir);
    store.put(makeObject('msg:wechat:g:1', '芯片供应链将受影响'));
    store.put(makeObject('msg:wechat:g:2', '昨天天气不错'));
    store.put(makeObject('msg:wechat:g:3', '国产芯片产能快速爬升'));
    store.put(makeObject('msg:wechat:g:4', '芯片'));   // too short

    const found = collectEvidence(store, '芯片');
    const descs = found.map(e => e.description);
    expect(descs).toContain('芯片供应链将受影响');
    expect(descs).toContain('国产芯片产能快速爬升');
    expect(descs).not.toContain('昨天天气不错');
    expect(descs).not.toContain('芯片');
  });

  it('case-insensitive match', () => {
    const store = new EvidenceStore(dir);
    store.put(makeObject('o1', 'DeepSeek V4 发布国产适配版本'));
    const found = collectEvidence(store, 'deepseek');
    expect(found).toHaveLength(1);
  });

  it('skips voice and image objects (their text is placeholder)', () => {
    const store = new EvidenceStore(dir);
    store.put(makeObject('o1', '[voice]', 'voice'));
    store.put(makeObject('o2', '[image]', 'image'));
    store.put(makeObject('o3', 'this is real text content'));
    const found = collectEvidence(store, 'content');
    expect(found).toHaveLength(1);
    expect(found[0].description).toBe('this is real text content');
  });

  it('caps to maxEvidence', () => {
    const store = new EvidenceStore(dir);
    for (let i = 0; i < 30; i++) {
      store.put(makeObject(`m${i}`, `芯片相关消息 ${i}`));
    }
    const found = collectEvidence(store, '芯片', { maxEvidence: 10 });
    expect(found).toHaveLength(10);
  });

  it('returns entityId pointing to original WxObject', () => {
    const store = new EvidenceStore(dir);
    store.put(makeObject('msg:wechat:g@chatroom:42', '这是一条测试消息内容'));
    const found = collectEvidence(store, '测试');
    expect(found[0].entityId).toBe('msg:wechat:g@chatroom:42');
  });
});

describe('runAch', () => {
  function makeLlm(responses: string[]): AchLlm {
    let i = 0;
    return {
      complete: vi.fn(async () => {
        if (i >= responses.length) throw new Error('LLM called more than expected');
        return responses[i++];
      }),
    };
  }

  const CANNED_HYPOTHESES = JSON.stringify([
    { id: 'h1', statement: 'APT28 操作', isNull: false },
    { id: 'h2', statement: '内鬼所为', isNull: false },
    { id: 'h3', statement: '随机事件 (null)', isNull: true },
  ]);

  const CANNED_MARKINGS = JSON.stringify({
    'h1:e1': 'C', 'h1:e2': 'I',
    'h2:e1': 'I', 'h2:e2': 'C',
    'h3:e1': 'N', 'h3:e2': 'N',
  });

  it('runs end-to-end pipeline with 2 evidence and 3 hypotheses', async () => {
    const llm = makeLlm([CANNED_HYPOTHESES, CANNED_MARKINGS]);
    const evidence = [
      { id: 'e1', description: '溯源指向 APT28', entityId: 'msg:wechat:x:1' },
      { id: 'e2', description: '使用内部凭证', entityId: 'msg:wechat:x:2' },
    ];
    const result = await runAch('安全事件归因', evidence, llm);

    expect(result.analysis.topic).toBe('安全事件归因');
    expect(result.analysis.matrix.hypotheses).toHaveLength(3);
    expect(result.analysis.matrix.evidence).toHaveLength(2);
    expect(result.analysis.ranking).toHaveLength(3);
    expect(result.markdown).toContain('ACH 分析: 安全事件归因');
    expect(llm.complete).toHaveBeenCalledTimes(2);
  });

  it('throws if no evidence provided', async () => {
    const llm = makeLlm([]);
    await expect(runAch('x', [], llm)).rejects.toThrow(/at least one/);
  });

  it('throws if LLM returns <2 hypotheses', async () => {
    const llm = makeLlm(['[{"id":"h1","statement":"only one"}]', '{}']);
    await expect(runAch('x', [{ id: 'e1', description: 'ev' }], llm))
      .rejects.toThrow(/≥2 hypotheses/);
  });

  it('includes raw LLM outputs for debugging', async () => {
    const llm = makeLlm([CANNED_HYPOTHESES, CANNED_MARKINGS]);
    const r = await runAch('x', [
      { id: 'e1', description: 'a' },
      { id: 'e2', description: 'b' },
    ], llm);
    expect(r.raw.hypothesisLlm).toBe(CANNED_HYPOTHESES);
    expect(r.raw.markingLlm).toBe(CANNED_MARKINGS);
  });

  it('handles markings with unknown cells gracefully', async () => {
    const markings = JSON.stringify({
      'h1:e1': 'C', 'h1:e2': 'I',
      'h99:e1': 'C',   // unknown hypothesis — should be dropped
      'h2:e1': 'I',
    });
    const llm = makeLlm([CANNED_HYPOTHESES, markings]);
    const result = await runAch('x', [
      { id: 'e1', description: 'a' },
      { id: 'e2', description: 'b' },
    ], llm);
    // Unknown cells don't break rendering
    expect(result.markdown).toBeTruthy();
    expect(Object.keys(result.analysis.matrix.marks)).toContain('h1:e1');
    expect(Object.keys(result.analysis.matrix.marks)).not.toContain('h99:e1');
  });
});
