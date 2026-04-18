/**
 * ACH — Analysis of Competing Hypotheses (Heuer 1999, CIA).
 *
 * Core Heuer insight: "Analysts tend to find evidence for their preferred
 * hypothesis. The better method is to generate a full set of hypotheses
 * and evaluate which is LEAST INCONSISTENT with the evidence." — the
 * best hypothesis is the one with the fewest 'I' (inconsistent) marks,
 * not the one with the most 'C' (consistent) marks.
 *
 * Diagnosticity: evidence that distinguishes between hypotheses
 * (some 'C', some 'I') is valuable; evidence that marks the same way
 * for everyone (all 'C' or all 'N') is useless noise.
 *
 * This module provides the data types + deterministic scoring functions.
 * LLM interaction (hypothesis generation, evidence marking) lives in
 * ach-llm.ts (kept separate so these pure functions can be tested
 * exhaustively without mocking).
 */

export type EvidenceMark = 'C' | 'I' | 'N';   // Consistent, Inconsistent, Neutral

/** A candidate explanation for a contested topic. */
export interface Hypothesis {
  id: string;                    // 'h1', 'h2', ...
  statement: string;             // human-readable claim
  /** Is this the analyst's baseline / null hypothesis? */
  isNull?: boolean;
  /** Optional prior probability (if pre-set before evidence evaluation). */
  prior?: number;
}

/** A single piece of evidence to be weighed against hypotheses. */
export interface AchEvidence {
  id: string;                    // 'e1', ... — will match EvidenceStore entity ids
  description: string;           // human-readable
  /** Admiralty code or other grading; optional. */
  grade?: string;
  /** Source entity id for traceback to EvidenceStore. */
  entityId?: string;
  /** Display name of the sender (resolved from wxid via IdentityResolver). */
  senderName?: string;
  /** Display name of the conversation/group. */
  containerName?: string;
}

/** The matrix itself — sparse mapping (hypothesisId, evidenceId) → mark. */
export interface AchMatrix {
  hypotheses: Hypothesis[];
  evidence: AchEvidence[];
  /** Key format: `${hypothesisId}:${evidenceId}`. */
  marks: Record<string, EvidenceMark>;
}

/** Full analysis output: matrix + scores + ranking. */
export interface AchAnalysis {
  topic: string;
  createdAt: string;
  matrix: AchMatrix;
  diagnosticity: Record<string, number>;      // evidenceId → [0..1]
  inconsistencyScore: Record<string, number>;  // hypothesisId → count of 'I' marks
  ranking: Array<{ hypothesisId: string; inconsistencyScore: number; consistentCount: number }>;
}

// ============================================================================
// Pure functions — no I/O, easy to test exhaustively
// ============================================================================

/** Create an empty matrix (all marks Neutral implicitly). */
export function buildEmptyMatrix(hypotheses: Hypothesis[], evidence: AchEvidence[]): AchMatrix {
  return { hypotheses, evidence, marks: {} };
}

/** Mutate a matrix to record a mark. */
export function markEvidence(
  matrix: AchMatrix,
  evidenceId: string,
  hypothesisId: string,
  mark: EvidenceMark,
): AchMatrix {
  return {
    ...matrix,
    marks: { ...matrix.marks, [`${hypothesisId}:${evidenceId}`]: mark },
  };
}

/** Look up a mark, defaulting to 'N' (Neutral) when not explicitly set. */
export function getMark(matrix: AchMatrix, evidenceId: string, hypothesisId: string): EvidenceMark {
  return matrix.marks[`${hypothesisId}:${evidenceId}`] ?? 'N';
}

/**
 * Diagnosticity of a piece of evidence = fraction of hypothesis pairs it
 * discriminates between. Range [0..1].
 *
 * 1.0: distinguishes every hypothesis pair ('C' for some, 'I' for others)
 * 0.0: same mark for all hypotheses — useless
 *
 * Computed as:
 *   distinct marks count — 1
 *   ------------------------
 *   max(hypotheses count — 1, 1)
 *
 * So for 4 hypotheses:
 *   - all 'C' → 0 distinct differences → 0.0 (no value)
 *   - 2 'C' + 2 'I' → 1 difference → 1/3 (some value)
 *   - 'C', 'I', 'N', 'C' → 2 differences → 2/3 (high value)
 */
export function diagnosticity(matrix: AchMatrix, evidenceId: string): number {
  if (matrix.hypotheses.length < 2) return 0;
  const marks = matrix.hypotheses.map(h => getMark(matrix, evidenceId, h.id));
  const uniq = new Set(marks);
  return (uniq.size - 1) / (matrix.hypotheses.length - 1);
}

/** Count of 'I' marks for a hypothesis — the Heuer primary ranking criterion. */
export function inconsistencyScore(matrix: AchMatrix, hypothesisId: string): number {
  let count = 0;
  for (const e of matrix.evidence) {
    if (getMark(matrix, e.id, hypothesisId) === 'I') count++;
  }
  return count;
}

/** Count of 'C' marks — secondary criterion (tie-breaker). */
export function consistentCount(matrix: AchMatrix, hypothesisId: string): number {
  let count = 0;
  for (const e of matrix.evidence) {
    if (getMark(matrix, e.id, hypothesisId) === 'C') count++;
  }
  return count;
}

/**
 * Rank hypotheses from most to least plausible per Heuer:
 *   primary:   fewest 'I' marks wins
 *   tiebreak:  most 'C' marks wins
 */
export function rankHypotheses(matrix: AchMatrix): Array<{
  hypothesisId: string;
  inconsistencyScore: number;
  consistentCount: number;
}> {
  const scored = matrix.hypotheses.map(h => ({
    hypothesisId: h.id,
    inconsistencyScore: inconsistencyScore(matrix, h.id),
    consistentCount: consistentCount(matrix, h.id),
  }));
  scored.sort((a, b) => {
    if (a.inconsistencyScore !== b.inconsistencyScore) return a.inconsistencyScore - b.inconsistencyScore;
    return b.consistentCount - a.consistentCount;
  });
  return scored;
}

/** Compose a full AchAnalysis from a marked matrix. */
export function analyzeMatrix(topic: string, matrix: AchMatrix): AchAnalysis {
  const diag: Record<string, number> = {};
  for (const e of matrix.evidence) diag[e.id] = diagnosticity(matrix, e.id);
  const inc: Record<string, number> = {};
  for (const h of matrix.hypotheses) inc[h.id] = inconsistencyScore(matrix, h.id);
  return {
    topic,
    createdAt: new Date().toISOString(),
    matrix,
    diagnosticity: diag,
    inconsistencyScore: inc,
    ranking: rankHypotheses(matrix),
  };
}

/** Render the analysis as a markdown table (for the briefing / doc output). */
export function renderAchMarkdown(analysis: AchAnalysis): string {
  const { matrix, diagnosticity, ranking } = analysis;

  const lines: string[] = [];
  lines.push(`# ACH 分析: ${analysis.topic}`);
  lines.push('');
  lines.push(`> 生成时间: ${analysis.createdAt}`);
  lines.push(`> ${matrix.hypotheses.length} 个假设 × ${matrix.evidence.length} 条证据`);
  lines.push('');

  // ① 解释这个分析在干嘛 —— 第一次看的人能立刻知道有啥用
  lines.push('## ℹ️ 这个矩阵在干嘛');
  lines.push('');
  lines.push('**ACH (Analysis of Competing Hypotheses)** —— Heuer 在 CIA 1999 提出的核心反偏见方法。');
  lines.push('');
  lines.push('**人脑陷阱**：找到一个说得通的解释就停（confirmation bias）。');
  lines.push('**ACH 的解药**：对同一个争议**强行列 4-6 个对立假设**（包括"什么都没发生"的 null 假设），');
  lines.push('然后**每条证据独立判断**它支持还是反驳每个假设——而不是先选个赢家再找证据。');
  lines.push('');
  lines.push('**怎么读这份报告**：');
  lines.push('1. 看"假设排序"——**不一致分数 (I) 最低**的胜出（不是 C 最多的；Heuer 说证伪强于证实）');
  lines.push('2. 看"证据诊断性"——**诊断性高**的证据值得花力气独立核查（它能区分假设）');
  lines.push('3. 看"矩阵"——一眼看到每条证据对每个假设的立场（✓支持 / ✗反驳 / —无关）');
  lines.push('4. 看"假设明细"——所有假设原文，包括最无聊的 null 假设');
  lines.push('');
  lines.push('**适用场景**：群里在争执某件事真假 / 某人动机 / 某个事件归因 / 项目能否成功——任何**有 ≥2 种合理解读**的话题。');
  lines.push('');

  lines.push('## 🏆 假设排序（Heuer：不一致分数最低者最可信）');
  lines.push('');
  lines.push('| 排名 | 假设 | 不一致分数 (I) | 一致数 (C) | 结论 |');
  lines.push('|------|------|-------------|----------|------|');
  ranking.forEach((r, i) => {
    const h = matrix.hypotheses.find(x => x.id === r.hypothesisId)!;
    const verdict = i === 0 ? '✅ 最可信' : i === ranking.length - 1 ? '❌ 最不可信' : '—';
    lines.push(`| ${i + 1} | ${escapePipe(h.statement)} | ${r.inconsistencyScore} | ${r.consistentCount} | ${verdict} |`);
  });
  lines.push('');

  lines.push('## 🔍 证据诊断性（越高越值得独立核查）');
  lines.push('');
  lines.push('| 证据 | 来源 | 诊断性 |');
  lines.push('|------|------|-------|');
  const sortedEv = [...matrix.evidence].sort((a, b) => diagnosticity[b.id] - diagnosticity[a.id]);
  for (const e of sortedEv) {
    const d = (diagnosticity[e.id] * 100).toFixed(0);
    const sender = e.senderName || '?';
    const container = e.containerName ? ` @ ${escapePipe(e.containerName)}` : '';
    const sourceLabel = `**${escapePipe(sender)}**${container}`;
    lines.push(`| ${escapePipe(e.description)} | ${sourceLabel} | ${d}% |`);
  }
  lines.push('');

  lines.push('## 📋 完整证据 × 假设矩阵');
  lines.push('');
  // Use H1/H2/... as column headers (full hypothesis text in the bottom 详情 block)
  const headerCells = ['证据 \\ 假设', ...matrix.hypotheses.map(h => escapePipe(h.id.toUpperCase()))];
  lines.push(`| ${headerCells.join(' | ')} |`);
  lines.push(`| ${headerCells.map(() => '---').join(' | ')} |`);
  for (const e of matrix.evidence) {
    // Show sender + truncated text in the leftmost cell so the row is identifiable
    const sender = e.senderName ? `**${escapePipe(e.senderName)}**: ` : '';
    const snippet = escapePipe(e.description.slice(0, 50));
    const row = [`${sender}${snippet}`];
    for (const h of matrix.hypotheses) {
      const m = getMark(matrix, e.id, h.id);
      row.push(m === 'C' ? '✓' : m === 'I' ? '✗' : '—');
    }
    lines.push(`| ${row.join(' | ')} |`);
  }
  lines.push('');

  lines.push('## 📖 假设明细');
  lines.push('');
  for (const h of matrix.hypotheses) {
    const nullTag = h.isNull ? ' (null 假设)' : '';
    lines.push(`- **${h.id.toUpperCase()}**${nullTag}: ${h.statement}`);
  }
  return lines.join('\n');
}

function escapePipe(s: string): string {
  return s.replace(/\|/g, '\\|');
}
