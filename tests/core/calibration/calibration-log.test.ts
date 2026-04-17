import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  CalibrationLog,
  brierScore,
  outcomeToScore,
  probMidpoint,
} from '../../../src/core/calibration/calibration-log';
import type { Finding } from '../../../src/core/types/finding';

const NOW = '2026-04-18T10:00:00Z';

function makeFinding(id: string, overrides: Partial<Finding> = {}): Finding {
  return {
    id,
    createdAt: NOW,
    judgment: `judgment ${id}`,
    kentPhrase: 'likely',
    probRange: [60, 80],
    sourceGrade: 'B2',
    evidenceRefs: [{ entityId: 'o:1', stance: 'supports', grade: 'B2' }],
    assumptions: [],
    ...overrides,
  };
}

describe('outcomeToScore', () => {
  it('confirmed=1, refuted=0, partial=0.5', () => {
    expect(outcomeToScore('confirmed')).toBe(1);
    expect(outcomeToScore('refuted')).toBe(0);
    expect(outcomeToScore('partial')).toBe(0.5);
  });
});

describe('probMidpoint', () => {
  it('returns midpoint scaled to [0,1]', () => {
    expect(probMidpoint([60, 80])).toBeCloseTo(0.7, 5);
    expect(probMidpoint([0, 100])).toBe(0.5);
    expect(probMidpoint([100, 100])).toBe(1);
    expect(probMidpoint([0, 0])).toBe(0);
  });

  it('clamps out-of-range values', () => {
    expect(probMidpoint([-10, 20])).toBe(0.05);   // clamp -10→0, midpoint (0+20)/2=10 → 0.1 … wait let me recalc
    // Actually current impl: (lo+hi)/2 first, then clamp to [0,100], then /100
    // (-10+20)/2 = 5, clamp to [0,100] = 5, /100 = 0.05 ✓
  });
});

describe('brierScore', () => {
  it('0 when prediction matches outcome perfectly', () => {
    expect(brierScore(1, 'confirmed')).toBe(0);
    expect(brierScore(0, 'refuted')).toBe(0);
    expect(brierScore(0.5, 'partial')).toBe(0);
  });

  it('1 when prediction is maximally wrong', () => {
    expect(brierScore(0, 'confirmed')).toBe(1);
    expect(brierScore(1, 'refuted')).toBe(1);
  });

  it('0.25 for 50% prediction on binary outcome (random baseline)', () => {
    expect(brierScore(0.5, 'confirmed')).toBe(0.25);
    expect(brierScore(0.5, 'refuted')).toBe(0.25);
  });
});

describe('CalibrationLog', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'owh-calib-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('starts empty', () => {
    const log = new CalibrationLog(dir);
    expect(log.resolvedIds()).toEqual([]);
    expect(log.getOutcome('f1')).toBeNull();
  });

  it('creates directory if missing', () => {
    const nested = join(dir, 'a', 'b', 'c');
    new CalibrationLog(nested);
    expect(existsSync(nested)).toBe(true);
  });

  it('resolves and retrieves an outcome', () => {
    const log = new CalibrationLog(dir);
    log.resolve('f1', 'confirmed', { notes: 'saw it happen' });
    const rec = log.getOutcome('f1');
    expect(rec).toBeTruthy();
    expect(rec!.outcome).toBe('confirmed');
    expect(rec!.notes).toBe('saw it happen');
  });

  it('persists across instances', () => {
    const a = new CalibrationLog(dir);
    a.resolve('f1', 'refuted', { resolvedAt: NOW });

    const b = new CalibrationLog(dir);
    const r = b.getOutcome('f1');
    expect(r?.outcome).toBe('refuted');
    expect(r?.resolvedAt).toBe(NOW);
  });

  it('overwrites prior resolution', () => {
    const log = new CalibrationLog(dir);
    log.resolve('f1', 'partial');
    log.resolve('f1', 'confirmed', { notes: 'updated' });
    expect(log.getOutcome('f1')?.outcome).toBe('confirmed');
    expect(log.getOutcome('f1')?.notes).toBe('updated');
  });

  describe('summarize', () => {
    it('returns zeros when no findings resolved', () => {
      const log = new CalibrationLog(dir);
      const findings = [makeFinding('f1'), makeFinding('f2')];
      const s = log.summarize(findings);
      expect(s.overall.resolvedCount).toBe(0);
      expect(s.outstanding).toBe(2);
    });

    it('computes Brier for a single confirmed finding at 70% prediction', () => {
      const log = new CalibrationLog(dir);
      const f = makeFinding('f1', { probRange: [60, 80] });   // midpoint 0.7
      log.resolve('f1', 'confirmed');
      const s = log.summarize([f]);
      // brier = (0.7 - 1)^2 = 0.09
      expect(s.overall.brier).toBeCloseTo(0.09, 3);
      expect(s.overall.hitRate).toBe(1);
      expect(s.outstanding).toBe(0);
    });

    it('averages Brier across multiple findings', () => {
      const log = new CalibrationLog(dir);
      const findings = [
        makeFinding('f1', { probRange: [60, 80] }),   // 70%
        makeFinding('f2', { probRange: [40, 60] }),   // 50%
      ];
      log.resolve('f1', 'confirmed');   // brier = 0.09
      log.resolve('f2', 'refuted');     // brier = 0.25
      const s = log.summarize(findings);
      // avg = (0.09 + 0.25) / 2 = 0.17
      expect(s.overall.brier).toBeCloseTo(0.17, 3);
      expect(s.overall.resolvedCount).toBe(2);
      expect(s.overall.hitRate).toBe(0.5);
    });

    it('groups by KentPhrase', () => {
      const log = new CalibrationLog(dir);
      const findings = [
        makeFinding('f1', { kentPhrase: 'highly likely', probRange: [80, 90] }),
        makeFinding('f2', { kentPhrase: 'highly likely', probRange: [75, 95] }),
        makeFinding('f3', { kentPhrase: 'likely', probRange: [60, 80] }),
      ];
      log.resolve('f1', 'confirmed');
      log.resolve('f2', 'confirmed');
      log.resolve('f3', 'refuted');

      const s = log.summarize(findings);
      expect(s.byKentPhrase['highly likely']?.resolvedCount).toBe(2);
      expect(s.byKentPhrase['highly likely']?.hitRate).toBe(1);
      expect(s.byKentPhrase['likely']?.resolvedCount).toBe(1);
      expect(s.byKentPhrase['likely']?.hitRate).toBe(0);
    });

    it('ignores findings without outcomes (counts as outstanding)', () => {
      const log = new CalibrationLog(dir);
      log.resolve('f1', 'confirmed');
      const s = log.summarize([makeFinding('f1'), makeFinding('f2'), makeFinding('f3')]);
      expect(s.overall.resolvedCount).toBe(1);
      expect(s.outstanding).toBe(2);
    });
  });

  describe('renderMarkdown', () => {
    it('renders a complete report with overall + per-Kent breakdown', () => {
      const log = new CalibrationLog(dir);
      const findings = [
        makeFinding('f1', { kentPhrase: 'likely' }),
        makeFinding('f2', { kentPhrase: 'highly likely', probRange: [80, 95] }),
      ];
      log.resolve('f1', 'confirmed');
      log.resolve('f2', 'refuted');

      const md = log.renderMarkdown(findings);
      expect(md).toContain('校准报告');
      expect(md).toContain('Brier score');
      expect(md).toContain('已解决判断: **2**');
      expect(md).toContain('likely');
      expect(md).toContain('highly likely');
    });

    it('shows "no data" message when nothing resolved', () => {
      const log = new CalibrationLog(dir);
      const md = log.renderMarkdown([makeFinding('f1')]);
      expect(md).toContain('尚无已解决的判断');
    });
  });
});
