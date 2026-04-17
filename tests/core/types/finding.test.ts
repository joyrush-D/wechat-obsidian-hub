/**
 * Tests for Finding schema, KentPhrase ranges, Admiralty code parsing,
 * and validateFinding().
 */
import { describe, it, expect } from 'vitest';
import {
  KENT_PROBABILITY_RANGES,
  KENT_ZH_LABEL,
  parseAdmiraltyCode,
  validateFinding,
  type Finding,
} from '../../../src/core/types/finding';

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'f-1',
    createdAt: new Date('2026-04-18T10:00:00Z').toISOString(),
    judgment: '罗俊高度可能本周内出差去深圳',
    kentPhrase: 'highly likely',
    probRange: [75, 95],
    sourceGrade: 'B2',
    evidenceRefs: [
      { entityId: 'msg-1', stance: 'supports', grade: 'B2' },
    ],
    assumptions: [],
    ...overrides,
  };
}

describe('KENT_PROBABILITY_RANGES', () => {
  it('covers every KentPhrase', () => {
    const expectedKeys = [
      'almost certain', 'highly likely', 'likely', 'roughly even chance',
      'unlikely', 'highly unlikely', 'almost no chance',
    ];
    for (const k of expectedKeys) {
      expect(KENT_PROBABILITY_RANGES).toHaveProperty(k);
    }
  });

  it('ranges are monotonically decreasing in midpoint', () => {
    const order: Array<keyof typeof KENT_PROBABILITY_RANGES> = [
      'almost certain', 'highly likely', 'likely', 'roughly even chance',
      'unlikely', 'highly unlikely', 'almost no chance',
    ];
    const midpoints = order.map(k => {
      const [lo, hi] = KENT_PROBABILITY_RANGES[k];
      return (lo + hi) / 2;
    });
    for (let i = 1; i < midpoints.length; i++) {
      expect(midpoints[i]).toBeLessThan(midpoints[i - 1]);
    }
  });

  it('never goes outside [0, 100]', () => {
    for (const [lo, hi] of Object.values(KENT_PROBABILITY_RANGES)) {
      expect(lo).toBeGreaterThanOrEqual(0);
      expect(hi).toBeLessThanOrEqual(100);
      expect(lo).toBeLessThanOrEqual(hi);
    }
  });
});

describe('KENT_ZH_LABEL', () => {
  it('has Chinese label for every phrase', () => {
    for (const k of Object.keys(KENT_PROBABILITY_RANGES)) {
      expect(KENT_ZH_LABEL[k as keyof typeof KENT_ZH_LABEL]).toBeTruthy();
      expect(/[\u4e00-\u9fff]/.test(KENT_ZH_LABEL[k as keyof typeof KENT_ZH_LABEL])).toBe(true);
    }
  });
});

describe('parseAdmiraltyCode', () => {
  it('parses valid codes', () => {
    expect(parseAdmiraltyCode('A1')).toEqual({ source: 'A', info: '1' });
    expect(parseAdmiraltyCode('F6')).toEqual({ source: 'F', info: '6' });
    expect(parseAdmiraltyCode('B2')).toEqual({ source: 'B', info: '2' });
  });

  it('rejects malformed codes', () => {
    expect(parseAdmiraltyCode('')).toBeNull();
    expect(parseAdmiraltyCode('X1')).toBeNull();   // X not in [A-F]
    expect(parseAdmiraltyCode('A0')).toBeNull();   // 0 not in [1-6]
    expect(parseAdmiraltyCode('A7')).toBeNull();
    expect(parseAdmiraltyCode('AB')).toBeNull();
    expect(parseAdmiraltyCode('A1B')).toBeNull();
    expect(parseAdmiraltyCode('a1')).toBeNull();   // case sensitive
  });
});

describe('validateFinding', () => {
  it('accepts a well-formed finding', () => {
    expect(validateFinding(makeFinding())).toEqual([]);
  });

  it('rejects finding with no evidence refs', () => {
    const errors = validateFinding(makeFinding({ evidenceRefs: [] }));
    expect(errors).toContain('Finding must have at least one evidence reference');
  });

  it('rejects finding with malformed Admiralty code', () => {
    const errors = validateFinding(makeFinding({ sourceGrade: 'Z9' as any }));
    expect(errors.some(e => e.includes('Admiralty'))).toBe(true);
  });

  it('rejects finding with out-of-bounds probability range', () => {
    expect(validateFinding(makeFinding({ probRange: [-10, 50] })).length).toBeGreaterThan(0);
    expect(validateFinding(makeFinding({ probRange: [50, 110] })).length).toBeGreaterThan(0);
    expect(validateFinding(makeFinding({ probRange: [80, 20] })).length).toBeGreaterThan(0);
  });

  it('rejects finding where probability center is far outside Kent canonical range', () => {
    // "highly likely" canonical = [75, 95], so center around 10-20% is WAY off
    const errors = validateFinding(makeFinding({
      kentPhrase: 'highly likely',
      probRange: [5, 15],
    }));
    expect(errors.some(e => e.includes('canonical range'))).toBe(true);
  });

  it('tolerates small slop between Kent canonical and finding range', () => {
    // canonical "likely" = [55, 85], center 70. Finding at [50, 80] (center 65) should pass
    expect(validateFinding(makeFinding({
      kentPhrase: 'likely',
      probRange: [50, 80],
    }))).toEqual([]);
  });

  it('collects multiple errors at once', () => {
    const errors = validateFinding(makeFinding({
      evidenceRefs: [],
      sourceGrade: 'Z9' as any,
      probRange: [-1, 200],
    }));
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });
});
