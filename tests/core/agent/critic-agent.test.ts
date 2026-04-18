import { describe, it, expect, vi } from 'vitest';
import {
  CriticAgent,
  buildCritiquePrompt,
  parseCritiqueOutput,
  renderCritiqueMarkdown,
  type CritiqueRequest,
  type CritiqueLlm,
  type CritiqueIssue,
} from '../../../src/core/agent/critic-agent';
import type { Finding } from '../../../src/core/types/finding';

const F1: Finding = {
  id: 'finding:abc',
  createdAt: '2026-04-18T10:00:00Z',
  judgment: '领导的子女被加州伯克利大学录取',
  kentPhrase: 'almost certain',
  probRange: [87, 99],
  sourceGrade: 'B2',
  evidenceRefs: [
    { entityId: 'msg:wechat:g1@chatroom:42', stance: 'supports', grade: 'B2', quote: 'Wuli @👾 录取加州伯克利' },
  ],
  assumptions: [],
};

const F2: Finding = {
  id: 'finding:xyz',
  createdAt: '2026-04-18T10:00:00Z',
  judgment: '行程已变更为宁波',
  kentPhrase: 'highly likely',
  probRange: [80, 92],
  sourceGrade: 'A1',
  evidenceRefs: [
    { entityId: 'msg:wechat:fengqi:84', stance: 'supports', grade: 'A1', quote: '改宁波了' },
  ],
  assumptions: [],
};

const REQUEST: CritiqueRequest = {
  briefingMarkdown: '## 30秒速读\n1. 子女录取伯克利',
  findings: [F1, F2],
  userWxids: ['wxid_dexter_real', 'Dexter', 'joyrush', '罗俊'],
  messageContexts: {
    'msg:wechat:g1@chatroom:42': {
      messageId: 'msg:wechat:g1@chatroom:42',
      senderWxid: 'wxid_tina_tsou',
      senderName: 'Tina Tsou',
      containerName: 'Style Now用户群',
      text: 'Wuli 忙内 @👾 录取加州伯克利大学',
    },
    'msg:wechat:fengqi:84': {
      messageId: 'msg:wechat:fengqi:84',
      senderWxid: 'wxid_dexter_real',
      senderName: 'Dexter',
      containerName: '内部调休',
      text: '改宁波了',
    },
  },
};

describe('buildCritiquePrompt', () => {
  it('includes the user identity list', () => {
    const p = buildCritiquePrompt(REQUEST);
    expect(p).toContain('Dexter');
    expect(p).toContain('joyrush');
  });

  it('marks user-authored messages with 🟢 in context', () => {
    const p = buildCritiquePrompt(REQUEST);
    expect(p).toContain('🟢领导本人');
    // The non-user message should NOT have this marker
    const tinaLine = p.split('\n').find(l => l.includes('Tina Tsou'));
    expect(tinaLine).not.toContain('🟢');
  });

  it('lists every finding with its evidence refs', () => {
    const p = buildCritiquePrompt(REQUEST);
    expect(p).toContain('finding:abc');
    expect(p).toContain('finding:xyz');
    expect(p).toContain('子女被加州伯克利');
    expect(p).toContain('行程已变更为宁波');
  });

  it('demands JSON-only output', () => {
    const p = buildCritiquePrompt(REQUEST);
    expect(p).toContain('严格 JSON');
  });

  it('handles empty user identity list with a fallback warning', () => {
    const p = buildCritiquePrompt({ ...REQUEST, userWxids: [] });
    expect(p).toContain('未提供');
  });
});

describe('parseCritiqueOutput', () => {
  it('parses well-formed JSON array', () => {
    const out = JSON.stringify([{
      findingId: 'finding:abc',
      type: 'misattribution',
      severity: 'high',
      explanation: '消息发送人是 Tina Tsou 不是领导',
      suggestion: '改写为"Tina Tsou 的孩子录取"',
    }]);
    const { issues, errors } = parseCritiqueOutput(out, [F1, F2]);
    expect(errors).toEqual([]);
    expect(issues).toHaveLength(1);
    expect(issues[0].findingId).toBe('finding:abc');
    expect(issues[0].type).toBe('misattribution');
    expect(issues[0].severity).toBe('high');
  });

  it('strips markdown code fences', () => {
    const fenced = '```json\n[]\n```';
    const { issues, errors } = parseCritiqueOutput(fenced, []);
    expect(issues).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('tolerates preamble text', () => {
    const txt = '好的，结果如下：\n[]';
    const { issues } = parseCritiqueOutput(txt, []);
    expect(issues).toEqual([]);
  });

  it('drops issues with unknown findingId', () => {
    const out = JSON.stringify([{
      findingId: 'finding:does-not-exist',
      type: 'misattribution', severity: 'high',
      explanation: 'x', suggestion: 'y',
    }]);
    const { issues, errors } = parseCritiqueOutput(out, [F1]);
    expect(issues).toEqual([]);
    expect(errors[0]).toContain('不在 finding 列表');
  });

  it('drops rows missing required fields', () => {
    const out = JSON.stringify([{ findingId: 'finding:abc' }]);
    const { issues, errors } = parseCritiqueOutput(out, [F1]);
    expect(issues).toEqual([]);
    expect(errors[0]).toContain('缺必需字段');
  });

  it('defaults invalid type to "other"', () => {
    const out = JSON.stringify([{
      findingId: 'finding:abc', type: 'mystery_type', severity: 'high',
      explanation: 'x', suggestion: 'y',
    }]);
    const { issues } = parseCritiqueOutput(out, [F1]);
    expect(issues[0].type).toBe('other');
  });

  it('defaults invalid severity to "medium"', () => {
    const out = JSON.stringify([{
      findingId: 'finding:abc', type: 'misattribution', severity: 'hot',
      explanation: 'x', suggestion: 'y',
    }]);
    const { issues } = parseCritiqueOutput(out, [F1]);
    expect(issues[0].severity).toBe('medium');
  });

  it('returns error for unparseable input', () => {
    // Unclosed bracket — extractor returns null because it can't find ']'
    // → "未包含 JSON 数组" error path; either error type is fine here.
    const { issues, errors } = parseCritiqueOutput('[{"bad": ', []);
    expect(issues).toEqual([]);
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('CriticAgent.critique', () => {
  function makeLlm(response: string): CritiqueLlm {
    return { complete: vi.fn().mockResolvedValue(response) };
  }

  it('runs end-to-end and returns parsed issues', async () => {
    const canned = JSON.stringify([{
      findingId: 'finding:abc',
      type: 'misattribution',
      severity: 'high',
      explanation: 'Tina Tsou 不是领导',
      suggestion: '改写归属',
    }]);
    const agent = new CriticAgent(makeLlm(canned));
    const result = await agent.critique(REQUEST);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].type).toBe('misattribution');
    expect(result.errors).toEqual([]);
  });

  it('returns empty issues + error when LLM throws', async () => {
    const llm: CritiqueLlm = { complete: vi.fn().mockRejectedValue(new Error('500')) };
    const agent = new CriticAgent(llm);
    const result = await agent.critique(REQUEST);
    expect(result.issues).toEqual([]);
    expect(result.errors[0]).toContain('500');
  });

  it('uses low temperature for deterministic critique', async () => {
    const llm = { complete: vi.fn().mockResolvedValue('[]') };
    const agent = new CriticAgent(llm);
    await agent.critique(REQUEST);
    expect(llm.complete).toHaveBeenCalledWith(expect.any(String), { temperature: 0.1 });
  });
});

describe('renderCritiqueMarkdown', () => {
  it('shows clean check-mark when no issues', () => {
    expect(renderCritiqueMarkdown([])).toContain('未发现归属');
  });

  it('groups issues by severity with icons', () => {
    const issues: CritiqueIssue[] = [
      { findingId: 'f1', type: 'misattribution', severity: 'high', explanation: 'a', suggestion: 'b' },
      { findingId: 'f2', type: 'overconfident', severity: 'medium', explanation: 'c', suggestion: 'd' },
      { findingId: 'f3', type: 'other', severity: 'low', explanation: 'e', suggestion: 'f' },
    ];
    const md = renderCritiqueMarkdown(issues);
    expect(md).toContain('🔴 高');
    expect(md).toContain('🟡 中');
    expect(md).toContain('🟢 低');
    expect(md).toContain('归属错误');
    expect(md).toContain('过度自信');
    expect(md).toContain('共 3 条问题：1 高 / 1 中 / 1 低');
  });

  it('omits empty severity groups', () => {
    const issues: CritiqueIssue[] = [
      { findingId: 'f1', type: 'misattribution', severity: 'high', explanation: 'a', suggestion: 'b' },
    ];
    const md = renderCritiqueMarkdown(issues);
    expect(md).toContain('🔴 高');
    expect(md).not.toContain('🟡 中');
    expect(md).not.toContain('🟢 低');
  });
});
