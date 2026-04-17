import { describe, it, expect, vi } from 'vitest';
import {
  buildDevilsAdvocatePrompt,
  parseDissentingView,
  generateDissentingView,
  type DevilsAdvocateLlm,
} from '../../../src/core/sat/devils-advocate';
import type { Finding } from '../../../src/core/types/finding';

const FINDING: Finding = {
  id: 'f1',
  createdAt: '2026-04-18T10:00:00Z',
  judgment: '罗俊高度可能本周出差深圳',
  kentPhrase: 'highly likely',
  probRange: [80, 92],
  sourceGrade: 'B2',
  evidenceRefs: [
    { entityId: 'msg:wechat:g:42', stance: 'supports', grade: 'B2', quote: '订好机票了' },
    { entityId: 'msg:wechat:g:43', stance: 'supports', grade: 'B2', quote: '周三早 8 点航班' },
  ],
  assumptions: [
    { statement: '行程未被取消', confidence: 'solid' },
  ],
};

describe('buildDevilsAdvocatePrompt', () => {
  it('includes the finding judgment and all evidence quotes', () => {
    const p = buildDevilsAdvocatePrompt(FINDING);
    expect(p).toContain('罗俊高度可能本周出差深圳');
    expect(p).toContain('订好机票了');
    expect(p).toContain('周三早 8 点航班');
  });

  it('includes the original Kent phrase and prob range for context', () => {
    const p = buildDevilsAdvocatePrompt(FINDING);
    expect(p).toContain('highly likely (80%–92%)');
  });

  it('demands JSON-only output and non-empty dissent', () => {
    const p = buildDevilsAdvocatePrompt(FINDING);
    expect(p).toContain('严格输出 JSON');
    expect(p).toContain('禁止空洞反驳');
    expect(p).toContain('禁止说"原判断基本对"或"没什么反驳"');
  });

  it('warns against hallucinating evidence ids', () => {
    const p = buildDevilsAdvocatePrompt(FINDING);
    expect(p).toContain('不要伪造新 id');
  });

  it('handles findings with no assumptions', () => {
    const f: Finding = { ...FINDING, assumptions: [] };
    const p = buildDevilsAdvocatePrompt(f);
    expect(p).toContain('未列出假设');
  });
});

describe('parseDissentingView', () => {
  const allowedIds = FINDING.evidenceRefs.map(r => r.entityId);

  const VALID = JSON.stringify({
    statement: '航班订记录可能只是占位，实际出行概率较低',
    kentPhrase: 'roughly even chance',
    probRange: [40, 60],
    keyEvidenceRefs: [
      { entityId: 'msg:wechat:g:42', stance: 'contradicts', grade: 'C3', quote: '订好机票了（未必出行）' },
    ],
  });

  it('parses well-formed JSON', () => {
    const dv = parseDissentingView(VALID, allowedIds);
    expect(dv).not.toBeNull();
    expect(dv!.statement).toContain('订记录');
    expect(dv!.kentPhrase).toBe('roughly even chance');
    expect(dv!.probRange).toEqual([40, 60]);
    expect(dv!.keyEvidenceRefs).toHaveLength(1);
  });

  it('strips markdown fences', () => {
    const fenced = '```json\n' + VALID + '\n```';
    expect(parseDissentingView(fenced, allowedIds)).not.toBeNull();
  });

  it('tolerates preamble + JSON + trailing notes', () => {
    const withText = '好的，反方视角如下：\n' + VALID + '\n（end of output）';
    expect(parseDissentingView(withText, allowedIds)).not.toBeNull();
  });

  it('returns null for empty / non-JSON input', () => {
    expect(parseDissentingView('', allowedIds)).toBeNull();
    expect(parseDissentingView('just text', allowedIds)).toBeNull();
  });

  it('returns null for JSON array (wrong shape)', () => {
    expect(parseDissentingView('[{"statement":"x"}]', allowedIds)).toBeNull();
  });

  it('returns null when required fields missing', () => {
    expect(parseDissentingView('{"statement":"only"}', allowedIds)).toBeNull();
  });

  it('returns null when Kent phrase invalid', () => {
    const bad = JSON.stringify({ ...JSON.parse(VALID), kentPhrase: 'maybe' });
    expect(parseDissentingView(bad, allowedIds)).toBeNull();
  });

  it('returns null when probRange malformed', () => {
    const bad = JSON.stringify({ ...JSON.parse(VALID), probRange: 'wrong' });
    expect(parseDissentingView(bad, allowedIds)).toBeNull();
  });

  it('drops evidenceRefs with unknown entity ids (anti-hallucination)', () => {
    const mixed = JSON.stringify({
      statement: 's',
      kentPhrase: 'likely',
      probRange: [60, 80],
      keyEvidenceRefs: [
        { entityId: 'msg:wechat:fake:999', stance: 'contradicts', grade: 'C3' },   // not in allowed
        { entityId: 'msg:wechat:g:42', stance: 'contradicts', grade: 'C3' },         // allowed
      ],
    });
    const dv = parseDissentingView(mixed, allowedIds);
    expect(dv?.keyEvidenceRefs).toHaveLength(1);
    expect(dv?.keyEvidenceRefs[0].entityId).toBe('msg:wechat:g:42');
  });

  it('returns null when ALL evidence refs are hallucinated', () => {
    const allBad = JSON.stringify({
      statement: 's',
      kentPhrase: 'likely',
      probRange: [60, 80],
      keyEvidenceRefs: [{ entityId: 'fake', stance: 'contradicts', grade: 'C3' }],
    });
    expect(parseDissentingView(allBad, allowedIds)).toBeNull();
  });

  it('defaults invalid stance to contradicts (the DA default)', () => {
    const odd = JSON.stringify({
      statement: 's',
      kentPhrase: 'likely',
      probRange: [60, 80],
      keyEvidenceRefs: [{ entityId: 'msg:wechat:g:42', stance: 'wibble', grade: 'B2' }],
    });
    expect(parseDissentingView(odd, allowedIds)?.keyEvidenceRefs[0].stance).toBe('contradicts');
  });

  it('defaults invalid admiralty code to C3', () => {
    const odd = JSON.stringify({
      statement: 's',
      kentPhrase: 'likely',
      probRange: [60, 80],
      keyEvidenceRefs: [{ entityId: 'msg:wechat:g:42', stance: 'supports', grade: 'ZZ' }],
    });
    expect(parseDissentingView(odd, allowedIds)?.keyEvidenceRefs[0].grade).toBe('C3');
  });
});

describe('generateDissentingView', () => {
  function makeLlm(response: string): DevilsAdvocateLlm {
    return { complete: vi.fn().mockResolvedValue(response) };
  }

  it('produces a valid DissentingView from a canned LLM response', async () => {
    const canned = JSON.stringify({
      statement: '反方解读',
      kentPhrase: 'likely',
      probRange: [55, 75],
      keyEvidenceRefs: [{ entityId: 'msg:wechat:g:42', stance: 'contradicts', grade: 'C3' }],
    });
    const dv = await generateDissentingView(FINDING, makeLlm(canned));
    expect(dv).not.toBeNull();
    expect(dv!.statement).toBe('反方解读');
  });

  it('returns null when LLM throws', async () => {
    const llm: DevilsAdvocateLlm = { complete: vi.fn().mockRejectedValue(new Error('timeout')) };
    const dv = await generateDissentingView(FINDING, llm);
    expect(dv).toBeNull();
  });

  it('returns null when LLM returns unparseable output', async () => {
    const dv = await generateDissentingView(FINDING, makeLlm('just text no json'));
    expect(dv).toBeNull();
  });

  it('filters hallucinated evidence ids based on the original Finding', async () => {
    const canned = JSON.stringify({
      statement: '反方',
      kentPhrase: 'likely',
      probRange: [55, 75],
      keyEvidenceRefs: [
        { entityId: 'msg:wechat:fake:999', stance: 'contradicts', grade: 'B2' },
        { entityId: 'msg:wechat:g:43', stance: 'contradicts', grade: 'B2' },
      ],
    });
    const dv = await generateDissentingView(FINDING, makeLlm(canned));
    expect(dv?.keyEvidenceRefs).toHaveLength(1);
    expect(dv?.keyEvidenceRefs[0].entityId).toBe('msg:wechat:g:43');
  });
});
