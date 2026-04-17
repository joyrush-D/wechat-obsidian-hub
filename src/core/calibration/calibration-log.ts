/**
 * CalibrationLog — track per-Finding prediction outcomes and compute
 * Brier scores so the Agent can calibrate its concentration-of-belief
 * over time (VISION.md §Cap 3).
 *
 * Theoretical basis: Philip Tetlock's Superforecasting — good predictions
 * are CALIBRATED (when you say 70%, events happen 70% of the time).
 * Brier score = mean((prob - outcome)^2) where outcome ∈ {0, 0.5, 1}.
 * Lower = better. 0 is perfect; 0.25 is "random coin" baseline.
 *
 * Storage: one JSON file at <dir>/outcomes.json mapping findingId → outcome.
 * Findings themselves stay in the EvidenceStore (immutable); outcomes are
 * a separate layer so we never mutate the evidence record.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { Finding, KentPhrase } from '../types/finding';

export type FindingOutcome = 'confirmed' | 'refuted' | 'partial';

export interface OutcomeRecord {
  findingId: string;
  outcome: FindingOutcome;
  /** Optional free-form note explaining what was observed. */
  notes?: string;
  /** ISO timestamp when the outcome was recorded. */
  resolvedAt: string;
  /** Optional reference to an EvidenceStore entity id that triggered resolution. */
  triggerEntityId?: string;
}

export interface BrierStats {
  /** Number of findings resolved in this slice. */
  resolvedCount: number;
  /** Mean Brier score. */
  brier: number;
  /** Hit rate (confirmed fraction) — sanity check on Brier. */
  hitRate: number;
}

export interface CalibrationSummary {
  overall: BrierStats;
  byKentPhrase: Record<KentPhrase, BrierStats>;
  outstanding: number;            // findings with no outcome yet
}

/** Map outcomes to numeric score for Brier math. */
export function outcomeToScore(outcome: FindingOutcome): number {
  switch (outcome) {
    case 'confirmed': return 1;
    case 'refuted': return 0;
    case 'partial': return 0.5;
  }
}

/** Midpoint of a prob range, clamped to [0, 100] then scaled to [0, 1]. */
export function probMidpoint(range: [number, number]): number {
  const [lo, hi] = range;
  return Math.min(Math.max((lo + hi) / 2, 0), 100) / 100;
}

/** Brier score for a single (prediction, outcome) pair. */
export function brierScore(probMid: number, outcome: FindingOutcome): number {
  const score = outcomeToScore(outcome);
  const diff = probMid - score;
  return diff * diff;
}

export class CalibrationLog {
  private path: string;
  private outcomes: Record<string, OutcomeRecord>;

  constructor(dir: string) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.path = join(dir, 'outcomes.json');
    this.outcomes = this.load();
  }

  private load(): Record<string, OutcomeRecord> {
    if (!existsSync(this.path)) return {};
    try {
      const raw = readFileSync(this.path, 'utf-8');
      const parsed = JSON.parse(raw);
      return (typeof parsed === 'object' && parsed !== null) ? parsed : {};
    } catch {
      return {};
    }
  }

  private persist(): void {
    writeFileSync(this.path, JSON.stringify(this.outcomes, null, 2), 'utf-8');
  }

  /** Record an outcome for a finding. Overwrites any prior record. */
  resolve(
    findingId: string,
    outcome: FindingOutcome,
    opts: { notes?: string; triggerEntityId?: string; resolvedAt?: string } = {},
  ): OutcomeRecord {
    const record: OutcomeRecord = {
      findingId,
      outcome,
      notes: opts.notes,
      triggerEntityId: opts.triggerEntityId,
      resolvedAt: opts.resolvedAt ?? new Date().toISOString(),
    };
    this.outcomes[findingId] = record;
    this.persist();
    return record;
  }

  getOutcome(findingId: string): OutcomeRecord | null {
    return this.outcomes[findingId] ?? null;
  }

  /** All resolved findingIds. */
  resolvedIds(): string[] {
    return Object.keys(this.outcomes);
  }

  /** Compute overall and per-KentPhrase Brier statistics over a set of findings. */
  summarize(findings: Finding[]): CalibrationSummary {
    const byKent = new Map<KentPhrase, { diffs: number[]; hits: number }>();
    const overallDiffs: number[] = [];
    let overallHits = 0;
    let outstanding = 0;

    for (const f of findings) {
      const rec = this.outcomes[f.id];
      if (!rec) {
        outstanding++;
        continue;
      }
      const p = probMidpoint(f.probRange);
      const b = brierScore(p, rec.outcome);
      overallDiffs.push(b);
      if (rec.outcome === 'confirmed') overallHits++;

      let bucket = byKent.get(f.kentPhrase);
      if (!bucket) {
        bucket = { diffs: [], hits: 0 };
        byKent.set(f.kentPhrase, bucket);
      }
      bucket.diffs.push(b);
      if (rec.outcome === 'confirmed') bucket.hits++;
    }

    const overall: BrierStats = {
      resolvedCount: overallDiffs.length,
      brier: mean(overallDiffs),
      hitRate: overallDiffs.length === 0 ? 0 : overallHits / overallDiffs.length,
    };

    const byKentPhrase = {} as Record<KentPhrase, BrierStats>;
    for (const [phrase, bucket] of byKent) {
      byKentPhrase[phrase] = {
        resolvedCount: bucket.diffs.length,
        brier: mean(bucket.diffs),
        hitRate: bucket.diffs.length === 0 ? 0 : bucket.hits / bucket.diffs.length,
      };
    }

    return { overall, byKentPhrase, outstanding };
  }

  /**
   * Render a human-readable calibration report for the briefing appendix.
   */
  renderMarkdown(findings: Finding[]): string {
    const s = this.summarize(findings);
    const lines: string[] = [];
    lines.push('# 📏 校准报告 (Calibration Report)');
    lines.push('');
    lines.push(`> 已解决判断: **${s.overall.resolvedCount}** · 未解决: **${s.outstanding}**`);
    lines.push(`> Brier score (总): **${s.overall.brier.toFixed(3)}** (0 最好, 0.25 随机基线)`);
    lines.push(`> 命中率 (confirmed 占已解决): **${(s.overall.hitRate * 100).toFixed(1)}%**`);
    lines.push('');

    const kentKeys = Object.keys(s.byKentPhrase) as KentPhrase[];
    if (kentKeys.length > 0) {
      lines.push('## 按 Kent 语词分类的校准');
      lines.push('');
      lines.push('| Kent 语词 | 已解决 | Brier | 命中率 |');
      lines.push('|------|------|------|------|');
      for (const k of kentKeys) {
        const b = s.byKentPhrase[k];
        lines.push(`| ${k} | ${b.resolvedCount} | ${b.brier.toFixed(3)} | ${(b.hitRate * 100).toFixed(1)}% |`);
      }
      lines.push('');
    }

    if (s.overall.resolvedCount === 0) {
      lines.push('> ⚠️ 尚无已解决的判断。运行 Resolve Finding 命令记录事后结果，校准数据会逐步积累。');
    }

    return lines.join('\n');
  }
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let sum = 0;
  for (const x of xs) sum += x;
  return sum / xs.length;
}
