/**
 * Finding — the atomic unit of analyst output.
 *
 * Per VISION.md §3.4 ICD 203-compliant schema. Every judgment an Agent
 * produces carries:
 *   - the claim itself
 *   - standardized probability language (Kent)
 *   - a numeric probability range for disambiguation
 *   - NATO Admiralty grade describing source quality
 *   - evidence references (point back to raw data)
 *   - explicit assumptions (surfaceable for KAC)
 *   - optional dissenting view (Devil's Advocate output)
 *
 * Findings are first-class persisted objects, not just markdown strings.
 * This lets downstream modules (calibration tracker, evidence chain
 * validator, export-to-STIX) work with them programmatically.
 */

/**
 * Sherman Kent's Words of Estimative Probability (1964) —
 * standardized phrases with canonical probability ranges.
 * See Kent's original paper and ODNI Analytic Standards (ICD 203).
 */
export type KentPhrase =
  | 'almost certain'       // 93 ± 6
  | 'highly likely'        // 85 ± 10   (中文: 高度可能)
  | 'likely'               // 70 ± 15   (中文: 可能)
  | 'roughly even chance'  // 50 ± 10   (中文: 可能与不可能)
  | 'unlikely'             // 25 ± 15   (中文: 不太可能)
  | 'highly unlikely'      // 10 ± 10   (中文: 高度不可能)
  | 'almost no chance';    // 3 ± 3

/**
 * NATO Admiralty Code (STANAG 2511) — source reliability × info credibility.
 * Source: A (completely reliable) ... F (reliability cannot be judged)
 * Info:   1 (confirmed by other sources) ... 6 (cannot be judged)
 */
export type SourceReliability = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
export type InfoCredibility = '1' | '2' | '3' | '4' | '5' | '6';
export type AdmiraltyCode = `${SourceReliability}${InfoCredibility}`;

/** A reference to raw evidence that supports (or contradicts) a Finding. */
export interface EvidenceRef {
  /** Point to a WxObject or Event by its domain id. */
  entityId: string;
  /** How does this evidence relate to the judgment? */
  stance: 'supports' | 'contradicts' | 'neutral';
  /** Optional quoted snippet from the entity for quick review. */
  quote?: string;
  /** Admiralty grade at time of citation. */
  grade: AdmiraltyCode;
}

/** A surfaced assumption the Finding depends on (for KAC / audits). */
export interface Assumption {
  statement: string;
  /** How solid is this assumption? */
  confidence: 'solid' | 'caveat' | 'unsupported';
  /** Optional note on what would falsify it. */
  falsifiable?: string;
}

/** Result of Devil's Advocate / Red Team analysis. */
export interface DissentingView {
  statement: string;
  kentPhrase: KentPhrase;
  probRange: [number, number];
  keyEvidenceRefs: EvidenceRef[];
}

/** The Finding itself. */
export interface Finding {
  id: string;
  reportId?: string;                 // parent report, if any
  createdAt: string;                 // ISO timestamp

  /** Natural-language claim ("该用户可能计划周五离开上海"). */
  judgment: string;

  /** Standardized probability language. */
  kentPhrase: KentPhrase;
  /** Numeric probability range [low, high] as percentages. */
  probRange: [number, number];

  /** Source grade synthesized across all evidence. */
  sourceGrade: AdmiraltyCode;

  /** Raw evidence this Finding rests on. Never empty. */
  evidenceRefs: EvidenceRef[];

  /** Assumptions the Finding depends on. Empty array is valid but suspicious. */
  assumptions: Assumption[];

  /** Optional alternative interpretation (Devil's Advocate). */
  dissentingView?: DissentingView;

  /** Was this Finding calibrated against historical Brier scores? */
  calibrated?: boolean;

  /** Free-form tags for filtering / search. */
  labels?: string[];
}

/** Standard Kent phrase → canonical probability range, per Sherman Kent (1964). */
export const KENT_PROBABILITY_RANGES: Record<KentPhrase, [number, number]> = {
  'almost certain':       [87, 99],
  'highly likely':        [75, 95],
  'likely':               [55, 85],
  'roughly even chance':  [40, 60],
  'unlikely':             [15, 45],
  'highly unlikely':      [0, 20],
  'almost no chance':     [0, 6],
};

/** Chinese display for Kent phrases (used in briefing output). */
export const KENT_ZH_LABEL: Record<KentPhrase, string> = {
  'almost certain':       '几乎肯定',
  'highly likely':        '高度可能',
  'likely':               '可能',
  'roughly even chance':  '可能与不可能相当',
  'unlikely':             '不太可能',
  'highly unlikely':      '高度不可能',
  'almost no chance':     '几乎不可能',
};

/**
 * Parse an Admiralty code string to its component grades.
 * Returns null if the code is malformed.
 */
export function parseAdmiraltyCode(code: string): { source: SourceReliability; info: InfoCredibility } | null {
  if (!/^[A-F][1-6]$/.test(code)) return null;
  return {
    source: code[0] as SourceReliability,
    info: code[1] as InfoCredibility,
  };
}

/**
 * Validation helper — Finding must have at least one evidence ref, and
 * its probRange must be consistent with its KentPhrase's canonical range.
 * Returns array of error strings (empty = valid).
 */
export function validateFinding(f: Finding): string[] {
  const errors: string[] = [];
  if (!f.evidenceRefs || f.evidenceRefs.length === 0) {
    errors.push('Finding must have at least one evidence reference');
  }
  if (!parseAdmiraltyCode(f.sourceGrade)) {
    errors.push(`Invalid Admiralty code: ${f.sourceGrade}`);
  }
  const [lo, hi] = f.probRange;
  if (lo < 0 || hi > 100 || lo > hi) {
    errors.push(`Invalid probability range: [${lo}, ${hi}]`);
  }
  const canonical = KENT_PROBABILITY_RANGES[f.kentPhrase];
  if (canonical) {
    // Allow some slop but the center of the range should be inside the canonical band
    const center = (lo + hi) / 2;
    const [clo, chi] = canonical;
    if (center < clo - 5 || center > chi + 5) {
      errors.push(
        `KentPhrase "${f.kentPhrase}" center ${center}% is outside its canonical range [${clo}, ${chi}]`,
      );
    }
  }
  return errors;
}
