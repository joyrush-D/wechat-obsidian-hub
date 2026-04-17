/**
 * Devil's Advocate — multi-agent reasoning primitive.
 *
 * Heuer 1999: "If the analyst who generated the preferred hypothesis is also
 * the one asked to critique it, the critique is inevitably superficial. The
 * dissenting view needs a second pair of eyes with a separate context window."
 *
 * This module wraps an LLM call with a persona that REFUSES to agree with
 * the input Finding and must construct a plausible counter-explanation,
 * even if it considers the original more likely. The output is a
 * DissentingView that can be attached to the original Finding.
 *
 * Scope: one finding at a time. Team A/B (parallel independent analyses)
 * is separate (future v0.8.x).
 */

import type { Finding, DissentingView, KentPhrase, AdmiraltyCode, EvidenceRef } from '../types/finding';
import { KENT_PROBABILITY_RANGES, parseAdmiraltyCode } from '../types/finding';

export interface DevilsAdvocateLlm {
  complete(prompt: string): Promise<string>;
}

/** Build the Devil's Advocate prompt. */
export function buildDevilsAdvocatePrompt(finding: Finding): string {
  const kentList = Object.entries(KENT_PROBABILITY_RANGES)
    .map(([k, [lo, hi]]) => `  - "${k}" (${lo}%–${hi}%)`)
    .join('\n');

  const evidenceBlock = finding.evidenceRefs
    .map((r, i) => `${i + 1}. [${r.grade}] ${r.entityId}${r.quote ? ` — "${r.quote}"` : ''} (stance: ${r.stance})`)
    .join('\n');

  const assumptionsBlock = finding.assumptions.length > 0
    ? finding.assumptions.map(a => `- ${a.statement} [${a.confidence}]`).join('\n')
    : '（原判断未列出假设）';

  return `你是"第十人"——CIA Red Cell / 以色列 Aman 部门的对抗性分析员。
你的唯一职责是：**找到原判断的致命漏洞**，构造一个**合理的反方假设**，即使你内心觉得原判断更可能。
**禁止说"原判断基本对"或"没什么反驳"**——永远能找到另一种解读。

# 原判断 (Finding under attack)

**声明**: ${finding.judgment}
**原置信**: ${finding.kentPhrase} (${finding.probRange[0]}%–${finding.probRange[1]}%)
**来源评级**: ${finding.sourceGrade}

**原证据**:
${evidenceBlock}

**原假设**:
${assumptionsBlock}

# 任务

生成一个 **反方视角 (Dissenting View)**，结构化输出 JSON：

\`\`\`json
{
  "statement": "一句话反方解读（跟原判断直接对立或给出完全不同的因果解释）",
  "kentPhrase": "almost certain | highly likely | likely | roughly even chance | unlikely | highly unlikely | almost no chance",
  "probRange": [lo, hi],
  "keyEvidenceRefs": [
    { "entityId": "msg:wechat:...", "stance": "supports" | "contradicts", "grade": "X#", "quote": "原文片段" }
  ]
}
\`\`\`

# 规则

- \`statement\` 必须**在语义上与原判断冲突**（否定、替代因果、另一种机制）
- Kent 概率语词与区间必须匹配：
${kentList}
- \`keyEvidenceRefs\` 至少 1 条，**必须用原证据中的 entityId**（不要伪造新 id）
  - \`stance\` 表示这条证据**相对反方假设**的立场；同一条证据可以支持反方（stance=supports）或反驳反方（stance=contradicts）
- Admiralty code 用 A1-F6 格式
- **禁止空洞反驳**（"也许是别的原因" ❌）；必须给出具体的替代解释和机制
- 即使原判断是 almost certain，你也要给出一个 ≥25% 的反方可能性——完全没反方可能的情况极罕见

严格输出 JSON，不要前言后语：`;
}

/**
 * Parse the Devil's Advocate LLM output into a validated DissentingView.
 * Returns null if the output is unparseable or fails basic validation.
 */
export function parseDissentingView(
  llmOutput: string,
  allowedEntityIds: string[],
): DissentingView | null {
  const obj = extractJsonObject(llmOutput);
  if (!obj) return null;
  let raw: unknown;
  try { raw = JSON.parse(obj); } catch { return null; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const rec = raw as Record<string, unknown>;
  const statement = typeof rec.statement === 'string' ? rec.statement.trim() : null;
  const kentPhrase = rec.kentPhrase as KentPhrase | undefined;
  const probRange = rec.probRange;
  if (!statement || !kentPhrase || !Array.isArray(probRange) || probRange.length !== 2) return null;
  if (!(kentPhrase in KENT_PROBABILITY_RANGES)) return null;

  const refs = normalizeRefs(rec.keyEvidenceRefs, allowedEntityIds);
  if (refs.length === 0) return null;

  return {
    statement,
    kentPhrase,
    probRange: [Number(probRange[0]), Number(probRange[1])] as [number, number],
    keyEvidenceRefs: refs,
  };
}

/** High-level: generate a DissentingView for a Finding. Returns null on any failure. */
export async function generateDissentingView(
  finding: Finding,
  llm: DevilsAdvocateLlm,
): Promise<DissentingView | null> {
  const allowedIds = finding.evidenceRefs.map(r => r.entityId);
  const prompt = buildDevilsAdvocatePrompt(finding);
  let output: string;
  try {
    output = await llm.complete(prompt);
  } catch {
    return null;
  }
  return parseDissentingView(output, allowedIds);
}

// ============================================================================
// Internals
// ============================================================================

function extractJsonObject(text: string): string | null {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (fenced) return fenced[1];
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first === -1 || last === -1 || last < first) return null;
  return text.slice(first, last + 1);
}

function normalizeRefs(raw: unknown, allowedIds: string[]): EvidenceRef[] {
  if (!Array.isArray(raw)) return [];
  const out: EvidenceRef[] = [];
  const allowedSet = new Set(allowedIds);
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const rec = r as Record<string, unknown>;
    const entityId = typeof rec.entityId === 'string' ? rec.entityId : null;
    if (!entityId) continue;
    // Enforce that refs come from the original finding's evidence pool
    // (prevents LLM from hallucinating new entity ids)
    if (allowedSet.size > 0 && !allowedSet.has(entityId)) continue;
    const stanceRaw = rec.stance;
    const stance = (stanceRaw === 'supports' || stanceRaw === 'contradicts' || stanceRaw === 'neutral')
      ? stanceRaw : 'contradicts';
    const gradeRaw = typeof rec.grade === 'string' ? rec.grade : 'C3';
    const grade = (parseAdmiraltyCode(gradeRaw) ? gradeRaw : 'C3') as AdmiraltyCode;
    const quote = typeof rec.quote === 'string' ? rec.quote : undefined;
    out.push({ entityId, stance, grade, quote });
  }
  return out;
}
