/**
 * Finding extractor — turn a generated briefing (markdown) into structured
 * Finding[] that can be persisted, cited, and calibrated over time.
 *
 * Why a post-pass and not an integrated prompt:
 *   - Keeps the primary briefing prompt focused on producing readable output
 *   - Structured JSON extraction benefits from a dedicated low-temperature call
 *   - Parser can be fixed / re-run on cached briefings without full re-synthesis
 *
 * Flow:
 *   1. buildFindingsExtractionPrompt(brief) → prompt for the LLM
 *   2. LLM returns JSON array of Finding-shaped objects
 *   3. parseFindings(llmOutput) → Finding[] with stable ids, validated
 */

import type { Finding, KentPhrase, AdmiraltyCode, EvidenceRef, Assumption } from '../types/finding';
import { validateFinding, KENT_PROBABILITY_RANGES, parseAdmiraltyCode, normalizeProbRange } from '../types/finding';
import { createHash } from 'crypto';

/** Build the extraction prompt. Designed for LM Studio / OpenAI-compatible. */
export function buildFindingsExtractionPrompt(briefingMarkdown: string): string {
  const kentList = Object.entries(KENT_PROBABILITY_RANGES)
    .map(([k, [lo, hi]]) => `  - "${k}" (${lo}%–${hi}%)`)
    .join('\n');

  return `你是情报分析员。读下面这份简报，把里面**显式或隐式的判断**抽取成 JSON 数组。

# 输出要求

**严格输出 JSON 数组，不要有任何解释、前言、后言。** 每个元素代表一个判断 (Finding)，字段如下：

\`\`\`json
{
  "judgment": "一句话中文描述这个判断",
  "kentPhrase": "almost certain | highly likely | likely | roughly even chance | unlikely | highly unlikely | almost no chance",
  "probRange": [percentage_low, percentage_high],
  "sourceGrade": "X#",  // X ∈ A-F (来源可靠度), # ∈ 1-6 (内容可信度)，例如 "B2"
  "evidenceRefs": [
    { "entityId": "msg:wechat:<conversationId>:<localId>", "stance": "supports" | "contradicts" | "neutral", "grade": "B2", "quote": "可选的原文片段" }
  ],
  "assumptions": [
    { "statement": "这个判断依赖的假设", "confidence": "solid" | "caveat" | "unsupported" }
  ],
  "dissentingView": null  // 若无反方观点则填 null；若有则给出 { statement, kentPhrase, probRange, keyEvidenceRefs: [] }
}
\`\`\`

# 规则

- **只抽取简报里真实出现的判断**，不要编造。不确定的场合直接不抽。
- **Kent 概率语词必须与数字区间一致**：
${kentList}
- **每个 Finding 至少要有 1 条 evidenceRef**。**优先使用简报引用里出现的真实消息 ID**（格式 \`msg:wechat:<convoId>:<localId>\`，通常在引用末尾的方括号里）—— 这是精准证据回溯的前提。**仅当简报完全没有可追溯 ID 时**，才用 \`msg:wechat:unknown\` 作为降级占位。
- **Admiralty code 必须形如 A1-F6**。如果简报没说明来源，用 \`C3\` 作为中位默认。
- **assumptions 可以是空数组**，但每条假设必须有 confidence 字段。
- 如果简报根本没有可判断的内容，返回空数组 \`[]\`。

# 简报正文

${briefingMarkdown}

# 输出

仅 JSON 数组：`;
}

/**
 * Parse LLM output into validated Finding[].
 * Strips any leading/trailing fluff (markdown fences, explanations).
 * Returns { findings, errors } — errors is non-empty when any row failed
 * validation but partial successes are still returned.
 */
export function parseFindings(
  llmOutput: string,
  opts: { reportId?: string; createdAt?: string } = {},
): { findings: Finding[]; errors: string[] } {
  const errors: string[] = [];
  const cleaned = extractJsonArray(llmOutput);
  if (!cleaned) {
    return { findings: [], errors: ['LLM output did not contain a parseable JSON array'] };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(cleaned);
  } catch (e) {
    errors.push(`JSON parse failed: ${(e as Error).message}`);
    return { findings: [], errors };
  }

  if (!Array.isArray(raw)) {
    errors.push('Parsed JSON was not an array');
    return { findings: [], errors };
  }

  const findings: Finding[] = [];
  const now = opts.createdAt ?? new Date().toISOString();

  for (let i = 0; i < raw.length; i++) {
    const row = raw[i];
    if (!row || typeof row !== 'object') {
      errors.push(`Row ${i}: not an object`);
      continue;
    }

    const candidate = buildCandidate(row as Record<string, unknown>, now, opts.reportId);
    if (!candidate) {
      errors.push(`Row ${i}: required fields missing`);
      continue;
    }

    const validationErrors = validateFinding(candidate);
    if (validationErrors.length > 0) {
      errors.push(`Row ${i}: ${validationErrors.join('; ')}`);
      continue;
    }
    findings.push(candidate);
  }

  return { findings, errors };
}

// ============================================================================
// Internals
// ============================================================================

/** Strip markdown fences / explanations, extract first [...] JSON array. */
function extractJsonArray(text: string): string | null {
  if (!text) return null;
  // Common case: LLM wraps in ```json ... ```
  const fenceMatch = text.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
  if (fenceMatch) return fenceMatch[1];

  // Find first [ and last ] (defensive)
  const first = text.indexOf('[');
  const last = text.lastIndexOf(']');
  if (first === -1 || last === -1 || last < first) return null;
  return text.slice(first, last + 1);
}

function buildCandidate(
  row: Record<string, unknown>,
  createdAt: string,
  reportId?: string,
): Finding | null {
  const judgment = typeof row.judgment === 'string' ? row.judgment : null;
  const kentPhrase = row.kentPhrase as KentPhrase | undefined;
  const probRange = row.probRange as [number, number] | undefined;
  const sourceGrade = row.sourceGrade as AdmiraltyCode | undefined;

  if (!judgment || !kentPhrase || !probRange || !sourceGrade) return null;
  if (!Array.isArray(probRange) || probRange.length !== 2) return null;
  if (!parseAdmiraltyCode(sourceGrade)) return null;
  if (!(kentPhrase in KENT_PROBABILITY_RANGES)) return null;

  // Auto-scale 0-1 fractions to 0-100 percentages (common LLM mistake)
  const normalizedRange = normalizeProbRange(probRange as [number, number]);

  const evidenceRefs = normalizeEvidenceRefs(row.evidenceRefs);
  if (evidenceRefs.length === 0) return null;

  const assumptions = normalizeAssumptions(row.assumptions);
  const dissentingView = row.dissentingView && typeof row.dissentingView === 'object'
    ? row.dissentingView as Finding['dissentingView']
    : undefined;

  return {
    id: 'finding:' + createHash('sha1').update(judgment + '|' + createdAt).digest('hex').slice(0, 16),
    reportId,
    createdAt,
    judgment,
    kentPhrase,
    probRange: normalizedRange,
    sourceGrade,
    evidenceRefs,
    assumptions,
    dissentingView,
  };
}

function normalizeEvidenceRefs(raw: unknown): EvidenceRef[] {
  if (!Array.isArray(raw)) return [];
  const out: EvidenceRef[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const rec = r as Record<string, unknown>;
    const entityId = typeof rec.entityId === 'string' ? rec.entityId : null;
    const stanceRaw = rec.stance;
    const stance = (stanceRaw === 'supports' || stanceRaw === 'contradicts' || stanceRaw === 'neutral') ? stanceRaw : 'neutral';
    const grade = typeof rec.grade === 'string' && parseAdmiraltyCode(rec.grade) ? rec.grade as AdmiraltyCode : 'C3';
    const quote = typeof rec.quote === 'string' ? rec.quote : undefined;
    if (!entityId) continue;
    out.push({ entityId, stance, grade, quote });
  }
  return out;
}

function normalizeAssumptions(raw: unknown): Assumption[] {
  if (!Array.isArray(raw)) return [];
  const out: Assumption[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const rec = r as Record<string, unknown>;
    const statement = typeof rec.statement === 'string' ? rec.statement : null;
    if (!statement) continue;
    const confRaw = rec.confidence;
    const confidence = (confRaw === 'solid' || confRaw === 'caveat' || confRaw === 'unsupported') ? confRaw : 'caveat';
    const falsifiable = typeof rec.falsifiable === 'string' ? rec.falsifiable : undefined;
    out.push({ statement, confidence, falsifiable });
  }
  return out;
}
