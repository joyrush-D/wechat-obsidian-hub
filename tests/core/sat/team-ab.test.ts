import { describe, it, expect, vi } from 'vitest';
import {
  buildTeamAPrompt,
  buildTeamBPrompt,
  buildJudgePrompt,
  parseTeamFinding,
  parseJudgeOutput,
  runTeamAb,
  renderTeamAbMarkdown,
  type TeamFinding,
  type TeamAbLlm,
} from '../../../src/core/sat/team-ab';

const VALID_TEAM_A = JSON.stringify({
  judgment: '该项目按时交付的可能性较高',
  kentPhrase: 'highly likely',
  probRange: [80, 92],
  sourceGrade: 'B2',
  evidenceRefs: [{ entityId: 'msg:wechat:g:1', stance: 'supports', grade: 'B2', quote: '原型已通过' }],
  reasoning: '基于现有里程碑与团队进度，无明显阻塞。',
});

const VALID_TEAM_B = JSON.stringify({
  judgment: '该项目可能因隐性依赖延期',
  kentPhrase: 'roughly even chance',
  probRange: [40, 60],
  sourceGrade: 'C3',
  evidenceRefs: [{ entityId: 'msg:wechat:g:2', stance: 'contradicts', grade: 'C3', quote: '上游接口尚未对齐' }],
  reasoning: '上游团队的接口验收尚未确认，是被忽略的关键依赖。',
});

const VALID_JUDGE = JSON.stringify({
  agreements: ['项目主体进度尚可'],
  disagreements: ['对上游接口风险的评估'],
  judgeNote: '分歧来自双方对"未确认接口"是否构成阻塞的不同权重，属于合理分歧。',
});

describe('Team A / Team B prompts', () => {
  it('Team A prompt embeds topic + evidence and demands JSON', () => {
    const p = buildTeamAPrompt('M9 售价', '消息块...');
    expect(p).toContain('M9 售价');
    expect(p).toContain('消息块...');
    expect(p).toContain('Team A');
    // New format: explicit "严格 JSON" rule + "禁止前言后语" + JSON schema
    expect(p).toMatch(/严格 JSON|JSON 对象/);
    expect(p).toContain('禁止前言后语');
  });

  it('Team B prompt instructs contrarian discipline + does NOT mention Team A', () => {
    const p = buildTeamBPrompt('M9 售价', '消息块');
    expect(p).toContain('Team B');
    expect(p).not.toContain('Team A');   // independence preserved
    expect(p).toMatch(/怀疑表面解读/);
    expect(p).toMatch(/追问被忽略/);
    expect(p).toMatch(/相反的因果方向/);
  });

  it('Judge prompt embeds both team outputs', () => {
    const a: TeamFinding = JSON.parse(VALID_TEAM_A);
    a.team = 'A';
    const b: TeamFinding = JSON.parse(VALID_TEAM_B);
    b.team = 'B';
    const p = buildJudgePrompt('topic', a, b);
    expect(p).toContain('Team A');
    expect(p).toContain('Team B');
    expect(p).toContain('该项目按时交付');
    expect(p).toContain('该项目可能因隐性依赖');
    expect(p).toContain('不是评谁对');
  });
});

describe('parseTeamFinding', () => {
  it('parses well-formed Team A output', () => {
    const f = parseTeamFinding('A', VALID_TEAM_A);
    expect(f).not.toBeNull();
    expect(f!.team).toBe('A');
    expect(f!.judgment).toContain('按时交付');
    expect(f!.kentPhrase).toBe('highly likely');
  });

  it('parses well-formed Team B output', () => {
    const f = parseTeamFinding('B', VALID_TEAM_B);
    expect(f).not.toBeNull();
    expect(f!.team).toBe('B');
    expect(f!.evidenceRefs[0].stance).toBe('contradicts');
  });

  it('strips fences and tolerates preamble', () => {
    expect(parseTeamFinding('A', '```json\n' + VALID_TEAM_A + '\n```')).not.toBeNull();
    expect(parseTeamFinding('A', '好的，结果：\n' + VALID_TEAM_A + '\n')).not.toBeNull();
  });

  it('returns null on missing required fields', () => {
    expect(parseTeamFinding('A', '{}')).toBeNull();
    expect(parseTeamFinding('A', '{"judgment":"x"}')).toBeNull();
  });

  it('returns null on invalid Kent phrase', () => {
    const bad = JSON.stringify({ ...JSON.parse(VALID_TEAM_A), kentPhrase: 'maybe' });
    expect(parseTeamFinding('A', bad)).toBeNull();
  });

  it('returns null on invalid Admiralty code', () => {
    const bad = JSON.stringify({ ...JSON.parse(VALID_TEAM_A), sourceGrade: 'Z9' });
    expect(parseTeamFinding('A', bad)).toBeNull();
  });

  it('returns null when evidenceRefs missing or empty', () => {
    const bad = JSON.stringify({ ...JSON.parse(VALID_TEAM_A), evidenceRefs: [] });
    expect(parseTeamFinding('A', bad)).toBeNull();
  });
});

describe('parseJudgeOutput', () => {
  it('parses well-formed judge output', () => {
    const j = parseJudgeOutput(VALID_JUDGE);
    expect(j.agreements).toHaveLength(1);
    expect(j.disagreements).toHaveLength(1);
    expect(j.judgeNote).toContain('合理分歧');
  });

  it('returns empty defaults on bad input', () => {
    expect(parseJudgeOutput('').agreements).toEqual([]);
    expect(parseJudgeOutput('not json').judgeNote).toBe('');
    expect(parseJudgeOutput('[1,2,3]').agreements).toEqual([]);
  });

  it('filters non-string array entries', () => {
    const mixed = JSON.stringify({
      agreements: ['valid', 42, null, 'also valid'],
      disagreements: [],
      judgeNote: 'x',
    });
    expect(parseJudgeOutput(mixed).agreements).toEqual(['valid', 'also valid']);
  });
});

describe('runTeamAb', () => {
  function makeLlm(responses: string[]): TeamAbLlm {
    let i = 0;
    return {
      complete: vi.fn(async () => {
        if (i >= responses.length) throw new Error('LLM called more than expected');
        return responses[i++];
      }),
    };
  }

  it('runs full A → B → judge pipeline', async () => {
    const llm = makeLlm([VALID_TEAM_A, VALID_TEAM_B, VALID_JUDGE]);
    const r = await runTeamAb('topic', 'evidence text', llm);
    expect(r.teamA).not.toBeNull();
    expect(r.teamB).not.toBeNull();
    expect(r.agreements).toEqual(['项目主体进度尚可']);
    expect(r.disagreements).toEqual(['对上游接口风险的评估']);
    expect(llm.complete).toHaveBeenCalledTimes(3);
  });

  it('retries failed team once, skips judge if still invalid', async () => {
    // First two calls: A invalid, B valid (parallel)
    // Third call: A retry, also invalid → judge skipped
    const llm = makeLlm(['INVALID', VALID_TEAM_B, 'STILL INVALID']);
    const r = await runTeamAb('topic', 'ev', llm);
    expect(r.teamA).toBeNull();
    expect(r.teamB).not.toBeNull();
    expect(r.agreements).toEqual([]);
    // 2 parallel + 1 retry for failed team A = 3 calls. Judge skipped.
    expect(llm.complete).toHaveBeenCalledTimes(3);
  });

  it('retry succeeds: judge runs after recovered team output', async () => {
    // A invalid first, B valid first (parallel) → A retry succeeds → judge runs
    const llm = makeLlm(['INVALID', VALID_TEAM_B, VALID_TEAM_A, VALID_JUDGE]);
    const r = await runTeamAb('topic', 'ev', llm);
    expect(r.teamA).not.toBeNull();
    expect(r.teamB).not.toBeNull();
    expect(r.agreements).toHaveLength(1);
    expect(llm.complete).toHaveBeenCalledTimes(4);
  });

  it('returns valid report shape even when both teams fail (incl. retries)', async () => {
    const llm = makeLlm(['INVALID', 'ALSO INVALID', 'STILL BAD', 'NOPE']);
    const r = await runTeamAb('topic', 'ev', llm);
    expect(r.teamA).toBeNull();
    expect(r.teamB).toBeNull();
    expect(r.topic).toBe('topic');
    expect(r.createdAt).toMatch(/^2\d{3}-/);
  });
});

describe('renderTeamAbMarkdown', () => {
  it('renders all sections when both teams + judge succeed', async () => {
    const llm: TeamAbLlm = {
      complete: vi.fn()
        .mockResolvedValueOnce(VALID_TEAM_A)
        .mockResolvedValueOnce(VALID_TEAM_B)
        .mockResolvedValueOnce(VALID_JUDGE),
    };
    const r = await runTeamAb('M9 售价', 'evidence', llm);
    const md = renderTeamAbMarkdown(r);

    expect(md).toContain('Team A / Team B 分析: M9 售价');
    expect(md).toContain('🅰️ Team A');
    expect(md).toContain('🅱️ Team B');
    expect(md).toContain('⚖️ 裁判员');
    expect(md).toContain('真同意');
    expect(md).toContain('真冲突');
  });

  it('marks teams as "无效输出" when parsing failed', () => {
    const r = {
      topic: 'x', teamA: null, teamB: null,
      agreements: [], disagreements: [], judgeNote: '',
      createdAt: new Date().toISOString(),
    };
    const md = renderTeamAbMarkdown(r);
    expect(md).toContain('Team A — *无效输出*');
    expect(md).toContain('Team B — *无效输出*');
  });
});
