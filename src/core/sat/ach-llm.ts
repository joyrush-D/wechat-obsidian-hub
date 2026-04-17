/**
 * ACH — LLM interaction layer.
 *
 * Pure math (ranking, diagnosticity) lives in ach.ts. This module owns the
 * prompts and parsers that talk to the LLM for:
 *   (a) hypothesis generation — given a topic + evidence, generate 4-6
 *       candidate explanations including a null hypothesis
 *   (b) evidence marking — given hypotheses + evidence, classify each
 *       (hypothesis × evidence) cell as Consistent / Inconsistent / Neutral
 *
 * Both calls ask for structured JSON; the parsers fall back gracefully
 * when the LLM wraps with fences or preambles (same robustness as
 * finding-extractor).
 */

import type { Hypothesis, AchEvidence, EvidenceMark, AchMatrix } from './ach';
import { buildEmptyMatrix, markEvidence } from './ach';

// ============================================================================
// Hypothesis generation
// ============================================================================

export function buildHypothesisGenerationPrompt(
  topic: string,
  evidence: AchEvidence[],
): string {
  const evText = evidence
    .map((e, i) => `${i + 1}. [${e.id}] ${e.description}${e.grade ? ' [' + e.grade + ']' : ''}`)
    .join('\n');
  return `你是情报分析员。针对以下争议话题和可用证据，生成 4-6 个相互**竞争的假设**（hypotheses）。

# 规则
- 必须**相互独立、相互排斥**（不能说一个假设是另一个的子集）
- **必须包含一个 null 假设**（最无聊的解释，如"随机事件/数据噪音/无关巧合"）
- 假设要具体（可证伪），避免"可能是某种情况"这种空洞陈述
- 不要只顺着证据方向生成假设 —— 考虑完全不同的解释路径

# 输出格式
严格输出 JSON 数组，不要有任何前言后语：

\`\`\`json
[
  {"id": "h1", "statement": "具体假设陈述，一句话", "isNull": false},
  {"id": "h2", "statement": "另一个相互排斥的假设", "isNull": false},
  ...
  {"id": "hN", "statement": "null 假设（最无聊的解释）", "isNull": true}
]
\`\`\`

# 话题
${topic}

# 可用证据
${evText}

# 输出（仅 JSON 数组）：`;
}

export function parseHypotheses(llmOutput: string): Hypothesis[] {
  const arr = extractJsonArray(llmOutput);
  if (!arr) return [];
  let raw: unknown;
  try { raw = JSON.parse(arr); } catch { return []; }
  if (!Array.isArray(raw)) return [];
  const out: Hypothesis[] = [];
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    if (!r || typeof r !== 'object') continue;
    const rec = r as Record<string, unknown>;
    const statement = typeof rec.statement === 'string' ? rec.statement : null;
    if (!statement) continue;
    const id = typeof rec.id === 'string' && rec.id ? rec.id : `h${i + 1}`;
    const isNull = rec.isNull === true;
    out.push({ id, statement, isNull });
  }
  return out;
}

// ============================================================================
// Evidence marking
// ============================================================================

export function buildEvidenceMarkingPrompt(
  topic: string,
  hypotheses: Hypothesis[],
  evidence: AchEvidence[],
): string {
  const hypText = hypotheses
    .map(h => `- **${h.id}**: ${h.statement}${h.isNull ? ' (null)' : ''}`)
    .join('\n');
  const evText = evidence
    .map(e => `- **${e.id}**: ${e.description}${e.grade ? ' [' + e.grade + ']' : ''}`)
    .join('\n');
  return `你是情报分析员。为以下每一对 (假设 × 证据) 打标签：

# 标签定义（Heuer ACH）
- **C** (Consistent)：证据**支持**这个假设（如果假设为真，很可能观察到这条证据）
- **I** (Inconsistent)：证据**反驳**这个假设（如果假设为真，不应该出现这条证据）
- **N** (Neutral)：证据**与这个假设无关**，既不支持也不反驳

# 关键规则
- **独立评估每一对**：判断"如果 H 为真，E 是否可能发生？"——不要先定哪个假设对再打
- **宁可 N 不要 C**：只在证据真正**强相关**时才打 C；轻度相关打 N
- **I 是最有价值的**：找到能**证伪**某个假设的证据比堆砌支持证据更有情报价值

# 输出格式
严格输出 JSON 对象，不要有任何前言后语。key 形如 "hypothesisId:evidenceId"，value 为 "C"/"I"/"N"：

\`\`\`json
{
  "h1:e1": "C",
  "h1:e2": "I",
  "h2:e1": "N",
  ...
}
\`\`\`

**必须为每一对都给出标签**（${hypotheses.length} 假设 × ${evidence.length} 证据 = ${hypotheses.length * evidence.length} 条标签）。

# 话题
${topic}

# 假设
${hypText}

# 证据
${evText}

# 输出（仅 JSON 对象）：`;
}

export function parseMarkings(llmOutput: string): Record<string, EvidenceMark> {
  const obj = extractJsonObject(llmOutput);
  if (!obj) return {};
  let raw: unknown;
  try { raw = JSON.parse(obj); } catch { return {}; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};

  const out: Record<string, EvidenceMark> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k !== 'string' || !k.includes(':')) continue;
    if (v === 'C' || v === 'I' || v === 'N') {
      out[k] = v;
    }
  }
  return out;
}

// ============================================================================
// Composition — apply parsed markings to a matrix
// ============================================================================

/** Build a marked matrix from pre-parsed hypotheses + evidence + markings. */
export function composeMatrix(
  hypotheses: Hypothesis[],
  evidence: AchEvidence[],
  markings: Record<string, EvidenceMark>,
): AchMatrix {
  let m = buildEmptyMatrix(hypotheses, evidence);
  for (const [key, mark] of Object.entries(markings)) {
    const [hId, eId] = key.split(':');
    if (!hId || !eId) continue;
    // Only set if both referenced entities exist (drop stale keys gracefully)
    if (!hypotheses.find(h => h.id === hId)) continue;
    if (!evidence.find(e => e.id === eId)) continue;
    m = markEvidence(m, eId, hId, mark);
  }
  return m;
}

// ============================================================================
// Internals
// ============================================================================

function extractJsonArray(text: string): string | null {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
  if (fenced) return fenced[1];
  const first = text.indexOf('[');
  const last = text.lastIndexOf(']');
  if (first === -1 || last === -1 || last < first) return null;
  return text.slice(first, last + 1);
}

function extractJsonObject(text: string): string | null {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (fenced) return fenced[1];
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first === -1 || last === -1 || last < first) return null;
  return text.slice(first, last + 1);
}
