/**
 * Exhaustive tests for ACH pure-function layer.
 * Heuer's scoring rules are mechanical — every branch must be covered.
 */
import { describe, it, expect } from 'vitest';
import {
  buildEmptyMatrix,
  markEvidence,
  getMark,
  diagnosticity,
  inconsistencyScore,
  consistentCount,
  rankHypotheses,
  analyzeMatrix,
  renderAchMarkdown,
  type Hypothesis,
  type AchEvidence,
} from '../../../src/core/sat/ach';

const HYP: Hypothesis[] = [
  { id: 'h1', statement: 'APT28 做的' },
  { id: 'h2', statement: '内鬼干的' },
  { id: 'h3', statement: '伪旗行动' },
  { id: 'h4', statement: '随机错误（null）', isNull: true },
];

const EV: AchEvidence[] = [
  { id: 'e1', description: '攻击溯源到已知 APT28 基础设施' },
  { id: 'e2', description: '使用了内部系统才能用的凭证' },
  { id: 'e3', description: '包含中文字符串' },
];

describe('buildEmptyMatrix', () => {
  it('preserves hypotheses and evidence arrays', () => {
    const m = buildEmptyMatrix(HYP, EV);
    expect(m.hypotheses).toBe(HYP);
    expect(m.evidence).toBe(EV);
    expect(m.marks).toEqual({});
  });
});

describe('markEvidence + getMark', () => {
  it('defaults unset cell to N (neutral)', () => {
    const m = buildEmptyMatrix(HYP, EV);
    expect(getMark(m, 'e1', 'h1')).toBe('N');
  });

  it('roundtrips explicit marks', () => {
    let m = buildEmptyMatrix(HYP, EV);
    m = markEvidence(m, 'e1', 'h1', 'C');
    m = markEvidence(m, 'e2', 'h1', 'I');
    expect(getMark(m, 'e1', 'h1')).toBe('C');
    expect(getMark(m, 'e2', 'h1')).toBe('I');
    expect(getMark(m, 'e3', 'h1')).toBe('N');
  });

  it('is pure (does not mutate input)', () => {
    const m = buildEmptyMatrix(HYP, EV);
    const before = JSON.stringify(m);
    markEvidence(m, 'e1', 'h1', 'C');
    expect(JSON.stringify(m)).toBe(before);
  });
});

describe('diagnosticity', () => {
  it('returns 0 when all hypotheses get the same mark (useless evidence)', () => {
    let m = buildEmptyMatrix(HYP, EV);
    for (const h of HYP) m = markEvidence(m, 'e1', h.id, 'C');
    expect(diagnosticity(m, 'e1')).toBe(0);
  });

  it('returns 0 when no marks are set (all default N)', () => {
    const m = buildEmptyMatrix(HYP, EV);
    expect(diagnosticity(m, 'e1')).toBe(0);
  });

  it('returns 1/3 when 2 distinct marks among 4 hypotheses', () => {
    let m = buildEmptyMatrix(HYP, EV);
    m = markEvidence(m, 'e1', 'h1', 'C');
    m = markEvidence(m, 'e1', 'h2', 'I');
    // h3, h4 default to N — but wait, that makes 3 distinct marks
    // Let's use 2 distinct: two 'C' and two 'I'
    const m2 = markEvidence(
      markEvidence(
        markEvidence(
          markEvidence(buildEmptyMatrix(HYP, EV), 'e1', 'h1', 'C'),
          'e1', 'h2', 'C'),
        'e1', 'h3', 'I'),
      'e1', 'h4', 'I');
    expect(diagnosticity(m2, 'e1')).toBeCloseTo(1 / 3, 5);
  });

  it('returns 2/3 with 3 distinct marks across 4 hypotheses', () => {
    let m = buildEmptyMatrix(HYP, EV);
    m = markEvidence(m, 'e1', 'h1', 'C');
    m = markEvidence(m, 'e1', 'h2', 'I');
    m = markEvidence(m, 'e1', 'h3', 'N');
    m = markEvidence(m, 'e1', 'h4', 'N');
    expect(diagnosticity(m, 'e1')).toBeCloseTo(2 / 3, 5);
  });

  it('returns 0 for single-hypothesis matrix (degenerate)', () => {
    const m = buildEmptyMatrix([{ id: 'only', statement: 'x' }], EV);
    expect(diagnosticity(m, 'e1')).toBe(0);
  });
});

describe('inconsistencyScore', () => {
  it('counts I marks per hypothesis', () => {
    let m = buildEmptyMatrix(HYP, EV);
    m = markEvidence(m, 'e1', 'h1', 'I');
    m = markEvidence(m, 'e2', 'h1', 'I');
    m = markEvidence(m, 'e3', 'h1', 'C');
    expect(inconsistencyScore(m, 'h1')).toBe(2);
  });

  it('ignores C and N marks', () => {
    let m = buildEmptyMatrix(HYP, EV);
    m = markEvidence(m, 'e1', 'h1', 'C');
    m = markEvidence(m, 'e2', 'h1', 'N');
    expect(inconsistencyScore(m, 'h1')).toBe(0);
  });
});

describe('rankHypotheses', () => {
  it('ranks fewest-I wins (Heuer primary criterion)', () => {
    let m = buildEmptyMatrix(HYP, EV);
    // h1: 2 I, 1 C
    m = markEvidence(m, 'e1', 'h1', 'I');
    m = markEvidence(m, 'e2', 'h1', 'I');
    m = markEvidence(m, 'e3', 'h1', 'C');
    // h2: 1 I, 2 C
    m = markEvidence(m, 'e1', 'h2', 'C');
    m = markEvidence(m, 'e2', 'h2', 'I');
    m = markEvidence(m, 'e3', 'h2', 'C');
    // h3: 0 I, 1 C
    m = markEvidence(m, 'e1', 'h3', 'C');
    m = markEvidence(m, 'e2', 'h3', 'N');
    m = markEvidence(m, 'e3', 'h3', 'N');
    // h4: 0 I, 3 C
    m = markEvidence(m, 'e1', 'h4', 'C');
    m = markEvidence(m, 'e2', 'h4', 'C');
    m = markEvidence(m, 'e3', 'h4', 'C');

    const ranked = rankHypotheses(m);
    // h3 and h4 both have 0 I; h4 wins tiebreak on higher C count
    expect(ranked[0].hypothesisId).toBe('h4');
    expect(ranked[1].hypothesisId).toBe('h3');
    expect(ranked[2].hypothesisId).toBe('h2');
    expect(ranked[3].hypothesisId).toBe('h1');
  });

  it('most-C tiebreaker applies when inconsistency is equal', () => {
    let m = buildEmptyMatrix(HYP.slice(0, 2), EV);
    m = markEvidence(m, 'e1', 'h1', 'C');
    m = markEvidence(m, 'e2', 'h1', 'C');
    m = markEvidence(m, 'e1', 'h2', 'C');
    m = markEvidence(m, 'e2', 'h2', 'N');
    const ranked = rankHypotheses(m);
    expect(ranked[0].hypothesisId).toBe('h1');
    expect(ranked[0].consistentCount).toBe(2);
    expect(ranked[1].hypothesisId).toBe('h2');
  });
});

describe('analyzeMatrix', () => {
  it('produces a complete analysis record', () => {
    let m = buildEmptyMatrix(HYP.slice(0, 2), EV.slice(0, 2));
    m = markEvidence(m, 'e1', 'h1', 'C');
    m = markEvidence(m, 'e1', 'h2', 'I');
    m = markEvidence(m, 'e2', 'h1', 'I');
    m = markEvidence(m, 'e2', 'h2', 'C');

    const a = analyzeMatrix('test topic', m);
    expect(a.topic).toBe('test topic');
    expect(a.diagnosticity.e1).toBe(1);   // full diagnosticity (C vs I)
    expect(a.diagnosticity.e2).toBe(1);
    expect(a.inconsistencyScore.h1).toBe(1);
    expect(a.inconsistencyScore.h2).toBe(1);
    expect(a.ranking).toHaveLength(2);
    expect(a.createdAt).toMatch(/^2\d{3}-/);   // ISO year
  });
});

describe('renderAchMarkdown', () => {
  it('produces a full markdown report with all sections', () => {
    let m = buildEmptyMatrix(HYP.slice(0, 2), EV.slice(0, 2));
    m = markEvidence(m, 'e1', 'h1', 'C');
    m = markEvidence(m, 'e1', 'h2', 'I');
    const a = analyzeMatrix('某争议话题', m);
    const md = renderAchMarkdown(a);

    expect(md).toContain('ACH 分析: 某争议话题');
    expect(md).toContain('假设排序');
    expect(md).toContain('证据诊断性');
    expect(md).toContain('完整证据 × 假设矩阵');
    expect(md).toContain('假设明细');
    expect(md).toContain('✓');
    expect(md).toContain('✗');
  });

  it('marks null hypothesis explicitly', () => {
    const m = buildEmptyMatrix(HYP, EV);   // h4 is null
    const a = analyzeMatrix('x', m);
    const md = renderAchMarkdown(a);
    expect(md).toContain('(null 假设)');
  });

  it('escapes pipe characters in descriptions to avoid breaking tables', () => {
    const evilHyp = [{ id: 'h1', statement: 'uses | pipes | badly' }];
    const ev = [{ id: 'e1', description: 'and | here | too' }];
    const m = buildEmptyMatrix(evilHyp, ev);
    const md = renderAchMarkdown(analyzeMatrix('x', m));
    expect(md).toContain('uses \\| pipes');
    expect(md).toContain('and \\| here');
  });
});
