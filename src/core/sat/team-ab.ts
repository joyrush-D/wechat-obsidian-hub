/**
 * Team A / Team B — parallel independent analyses (Heuer 1999, Pherson 2019).
 *
 * Origin: 1976 CIA experiment where two teams of analysts received the same
 * raw intelligence on Soviet strategic intent and reached opposite conclusions.
 * Team B (the contrarians) saw threats Team A had dismissed. The experiment
 * exposed how analyst priors silently shape conclusions.
 *
 * Heuer's CRITICAL design rule: the two teams MUST work in independent
 * context (no shared scratchpad, no inter-team chatter). Otherwise the
 * exercise degrades to a single self-consistent narrative with cosmetic
 * disagreement.
 *
 * This module enforces independence by making two SEPARATE LLM calls with
 * SEPARATE prompts that NEVER reference each other's existence. A third
 * "judge" call then surfaces real disagreements (without trying to merge them).
 */

import type { Finding, KentPhrase, AdmiraltyCode, EvidenceRef } from '../types/finding';
import { KENT_PROBABILITY_RANGES, parseAdmiraltyCode, normalizeProbRange } from '../types/finding';

export interface TeamAbLlm {
  complete(prompt: string, opts?: { temperature?: number }): Promise<string>;
}

/** Output from one team's analysis. Same shape as Finding (subset). */
export interface TeamFinding {
  team: 'A' | 'B';
  judgment: string;
  kentPhrase: KentPhrase;
  probRange: [number, number];
  sourceGrade: AdmiraltyCode;
  evidenceRefs: EvidenceRef[];
  reasoning: string;
}

/** Judge's reconciliation report. Surfaces disagreements; does NOT merge. */
export interface TeamAbReport {
  topic: string;
  teamA: TeamFinding | null;
  teamB: TeamFinding | null;
  agreements: string[];
  disagreements: string[];
  judgeNote: string;
  createdAt: string;
}

// ============================================================================
// Prompt templates
// ============================================================================

/**
 * Team A prompt: "establishment" analyst persona — looks for the simplest
 * explanation consistent with the available evidence.
 */
export function buildTeamAPrompt(topic: string, evidence: string): string {
  return `你是情报分析员（Team A）—— 主流分析视角，倾向**简洁解释、最小假设**。

# 任务
针对话题「${topic}」给出**你的核心判断**。

# 你的工作纪律（4 条，必须全部满足）
1. **奥卡姆剃刀**：能用一个常见原因解释的，不假设两个或阴谋
2. **先看官方/主要利益方说法**：通报、公告、当事人原话优先于二手转述
3. **判断要落到具体事实**："项目可能成功"是空话；"3 年内通过电网接入审批"才是判断
4. **风险也要点明**：即使主流路径，也要承认 1-2 个最可能让它失败的具体因素

# 证据
${evidence}

# 输出格式（**严格 JSON，禁止前言后语，禁止 markdown 代码块**）

JSON schema（**probRange 用 0-100 整数，不要用 0-1 小数**；如该话题置信度高，typical 75-95；中等 55-80；低 25-50）：

{
  "judgment": "一句具体判断（包含可证伪的事实/数字/时间）",
  "kentPhrase": "almost certain | highly likely | likely | roughly even chance | unlikely | highly unlikely | almost no chance",
  "probRange": [70, 90],
  "sourceGrade": "B2",
  "evidenceRefs": [
    { "entityId": "msg:wechat:<完整原始 ID>", "stance": "supports", "grade": "B2", "quote": "原话片段" }
  ],
  "reasoning": "一段 2-4 句的逻辑链：证据 → 推理 → 结论。不要废话。"
}

# 必须项检查清单（输出前自检）
- [ ] judgment 是具体事实判断而非套话
- [ ] kentPhrase 与 probRange 一致（如 highly likely 应在 75-95）
- [ ] probRange 是 0-100 整数，不是 0-1 小数
- [ ] evidenceRefs 至少 1 条，entityId 用证据原文里的 \`msg:wechat:...\` ID
- [ ] sourceGrade 是 A1-F6 格式

只输出 JSON 对象。`;
}

/**
 * Team B prompt: "contrarian" analyst persona — actively looks for the
 * non-obvious / suppressed / inconvenient interpretation. Team A's existence
 * is NEVER mentioned to preserve independence.
 */
export function buildTeamBPrompt(topic: string, evidence: string): string {
  return `你是情报分析员（Team B）—— 对抗性 / 怀疑性视角，受 1976 年 CIA Team B 实验启发。

# 任务
针对话题「${topic}」给出**你的核心判断**。

# 你的工作纪律（4 条）
1. **怀疑表面解读**：主流叙事是不是被有意放大 / 选择性呈现？
2. **追问被忽略的证据**：哪些消息被默认为不重要但其实暗藏信号？
3. **检查相反的因果方向**：B 导致 A 还是 A 导致 B？是不是有第三因素 C 同时驱动了 A 和 B？
4. **问"如果我错了，怎么知道"**：你的判断有没有可证伪的标准？

# 证据
${evidence}

# 输出格式（**严格 JSON，禁止前言后语，禁止 markdown 代码块**）

JSON schema（**probRange 用 0-100 整数，不要用 0-1 小数**；对抗性视角通常置信度中等：roughly even chance 40-60、likely 55-80）：

{
  "judgment": "一句具体的非主流判断（包含可证伪的事实/数字/时间）",
  "kentPhrase": "almost certain | highly likely | likely | roughly even chance | unlikely | highly unlikely | almost no chance",
  "probRange": [50, 75],
  "sourceGrade": "C3",
  "evidenceRefs": [
    { "entityId": "msg:wechat:<完整原始 ID>", "stance": "supports | contradicts", "grade": "C3", "quote": "原话片段" }
  ],
  "reasoning": "一段 2-4 句逻辑链：证据 → 反方推理 → 结论。重点是常被忽略的角度。"
}

# 必须项检查清单
- [ ] probRange 是 0-100 整数（如 50, 75），不是 0-1 小数（如 0.5, 0.75）
- [ ] kentPhrase 与 probRange 一致
- [ ] evidenceRefs 至少 1 条，entityId 用证据原文里的 \`msg:wechat:...\` ID
- [ ] sourceGrade 是 A1-F6

只输出 JSON 对象。`;
}

/**
 * Judge prompt: receives both team outputs and surfaces real agreements
 * vs. real disagreements. Critical: the judge does NOT pick a winner and
 * does NOT try to synthesize a "compromise" — that would defeat the
 * purpose of independent analysis.
 */
export function buildJudgePrompt(topic: string, a: TeamFinding, b: TeamFinding): string {
  return `你是裁判员，不是分析员。两组独立分析师对话题「${topic}」给出了各自判断。
你的任务**不是评谁对**，而是诚实地标出：

1. 他们**真正同意**了什么（相同的证据立场、相同的实体识别、相同的趋势判断）
2. 他们**真正冲突**了什么（对同一证据的相反解读、对未来走向的对立预期）
3. 一句裁判员观察：**冲突点是来自"有限证据下的合理分歧"还是"某一方掩盖了关键证据"**？

# Team A 判断
**结论**: ${a.judgment}
**置信**: ${a.kentPhrase} (${a.probRange[0]}%-${a.probRange[1]}%)
**信源**: ${a.sourceGrade}
**推理**: ${a.reasoning}

# Team B 判断
**结论**: ${b.judgment}
**置信**: ${b.kentPhrase} (${b.probRange[0]}%-${b.probRange[1]}%)
**信源**: ${b.sourceGrade}
**推理**: ${b.reasoning}

# 输出要求
严格输出 JSON 对象，不要前言后语：

\`\`\`json
{
  "agreements": ["共识 1（具体事实，不要废话）", "共识 2"],
  "disagreements": ["冲突 1（双方对同一事实的不同解读，要点明）", "冲突 2"],
  "judgeNote": "一句话总结：分歧是合理的还是病态的？"
}
\`\`\``;
}

// ============================================================================
// Parsers
// ============================================================================

export function parseTeamFinding(team: 'A' | 'B', llmOutput: string): TeamFinding | null {
  const obj = extractJsonObject(llmOutput);
  if (!obj) return null;
  let raw: unknown;
  try { raw = JSON.parse(obj); } catch { return null; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;

  const judgment = typeof r.judgment === 'string' ? r.judgment : null;
  const kentPhrase = r.kentPhrase as KentPhrase | undefined;
  const probRange = r.probRange;
  const sourceGrade = r.sourceGrade as AdmiraltyCode | undefined;
  if (!judgment || !kentPhrase || !sourceGrade) return null;
  if (!(kentPhrase in KENT_PROBABILITY_RANGES)) return null;
  if (!parseAdmiraltyCode(sourceGrade)) return null;
  if (!Array.isArray(probRange) || probRange.length !== 2) return null;

  const refs = normalizeRefs(r.evidenceRefs);
  if (refs.length === 0) return null;

  return {
    team,
    judgment,
    kentPhrase,
    probRange: normalizeProbRange([Number(probRange[0]), Number(probRange[1])] as [number, number]),
    sourceGrade,
    evidenceRefs: refs,
    reasoning: typeof r.reasoning === 'string' ? r.reasoning : '',
  };
}

export function parseJudgeOutput(llmOutput: string): {
  agreements: string[];
  disagreements: string[];
  judgeNote: string;
} {
  const empty = { agreements: [], disagreements: [], judgeNote: '' };
  const obj = extractJsonObject(llmOutput);
  if (!obj) return empty;
  let raw: unknown;
  try { raw = JSON.parse(obj); } catch { return empty; }
  if (!raw || typeof raw !== 'object') return empty;
  const r = raw as Record<string, unknown>;
  return {
    agreements: Array.isArray(r.agreements) ? r.agreements.filter((x): x is string => typeof x === 'string') : [],
    disagreements: Array.isArray(r.disagreements) ? r.disagreements.filter((x): x is string => typeof x === 'string') : [],
    judgeNote: typeof r.judgeNote === 'string' ? r.judgeNote : '',
  };
}

// ============================================================================
// Runner
// ============================================================================

export async function runTeamAb(
  topic: string,
  evidence: string,
  llm: TeamAbLlm,
): Promise<TeamAbReport> {
  // CRITICAL: independent calls. Even though we sequence them here, each
  // call has zero prior context — it does not see the other team's output.
  // Each team gets a one-shot retry if its first response fails to parse.
  // Use low temperature (0.1) for the structured-JSON team calls — the
  // creative work is in the persona discipline, not in token sampling.
  const [aOut, bOut] = await Promise.all([
    llm.complete(buildTeamAPrompt(topic, evidence), { temperature: 0.1 }),
    llm.complete(buildTeamBPrompt(topic, evidence), { temperature: 0.1 }),
  ]);

  let teamA = parseTeamFinding('A', aOut);
  let teamB = parseTeamFinding('B', bOut);

  if (!teamA) {
    try {
      const retryOut = await llm.complete(buildTeamAPrompt(topic, evidence), { temperature: 0.05 });
      teamA = parseTeamFinding('A', retryOut);
    } catch { /* swallow */ }
  }
  if (!teamB) {
    try {
      const retryOut = await llm.complete(buildTeamBPrompt(topic, evidence), { temperature: 0.05 });
      teamB = parseTeamFinding('B', retryOut);
    } catch { /* swallow */ }
  }

  let agreements: string[] = [];
  let disagreements: string[] = [];
  let judgeNote = '';
  if (teamA && teamB) {
    const judgeOut = await llm.complete(buildJudgePrompt(topic, teamA, teamB));
    const parsed = parseJudgeOutput(judgeOut);
    agreements = parsed.agreements;
    disagreements = parsed.disagreements;
    judgeNote = parsed.judgeNote;
  }

  return {
    topic,
    teamA,
    teamB,
    agreements,
    disagreements,
    judgeNote,
    createdAt: new Date().toISOString(),
  };
}

export function renderTeamAbMarkdown(r: TeamAbReport): string {
  const lines: string[] = [];
  lines.push(`# Team A / Team B 分析: ${r.topic}`);
  lines.push('');
  lines.push(`> 生成时间: ${r.createdAt}`);
  lines.push('');
  lines.push('## ℹ️ 这个分析在干嘛');
  lines.push('');
  lines.push('**Team A / Team B** —— 1976 年 CIA 在评估苏联战略意图时的对照实验。两组分析师拿同一批证据**独立分析**（互不知情），');
  lines.push('得出对立结论。这个分歧本身揭示了"分析员先验"如何无声塑造结论。');
  lines.push('');
  lines.push('**裁判员的纪律**：不评谁对，只标出真同意 / 真冲突。冲突值得围观，不该被强行调和成"折中观点"。');
  lines.push('');

  if (r.teamA) {
    lines.push('## 🅰️ Team A（主流视角）');
    lines.push('');
    lines.push(`**结论**: ${r.teamA.judgment}`);
    lines.push(`**置信**: ${r.teamA.kentPhrase} (${r.teamA.probRange[0]}%-${r.teamA.probRange[1]}%) [${r.teamA.sourceGrade}]`);
    lines.push('');
    lines.push(`**推理**: ${r.teamA.reasoning}`);
    lines.push('');
    if (r.teamA.evidenceRefs.length > 0) {
      lines.push('**关键证据**:');
      for (const e of r.teamA.evidenceRefs.slice(0, 5)) {
        lines.push(`- \`${e.entityId}\` [${e.grade}] (${e.stance})${e.quote ? ` — "${e.quote}"` : ''}`);
      }
      lines.push('');
    }
  } else {
    lines.push('## 🅰️ Team A — *无效输出*\n');
  }

  if (r.teamB) {
    lines.push('## 🅱️ Team B（对抗视角）');
    lines.push('');
    lines.push(`**结论**: ${r.teamB.judgment}`);
    lines.push(`**置信**: ${r.teamB.kentPhrase} (${r.teamB.probRange[0]}%-${r.teamB.probRange[1]}%) [${r.teamB.sourceGrade}]`);
    lines.push('');
    lines.push(`**推理**: ${r.teamB.reasoning}`);
    lines.push('');
    if (r.teamB.evidenceRefs.length > 0) {
      lines.push('**关键证据**:');
      for (const e of r.teamB.evidenceRefs.slice(0, 5)) {
        lines.push(`- \`${e.entityId}\` [${e.grade}] (${e.stance})${e.quote ? ` — "${e.quote}"` : ''}`);
      }
      lines.push('');
    }
  } else {
    lines.push('## 🅱️ Team B — *无效输出*\n');
  }

  lines.push('## ⚖️ 裁判员观察');
  lines.push('');
  if (r.agreements.length > 0) {
    lines.push('**真同意**:');
    for (const a of r.agreements) lines.push(`- ${a}`);
    lines.push('');
  }
  if (r.disagreements.length > 0) {
    lines.push('**真冲突**:');
    for (const d of r.disagreements) lines.push(`- ${d}`);
    lines.push('');
  }
  if (r.judgeNote) {
    lines.push(`> ${r.judgeNote}`);
  }

  return lines.join('\n');
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

function normalizeRefs(raw: unknown): EvidenceRef[] {
  if (!Array.isArray(raw)) return [];
  const out: EvidenceRef[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const rec = r as Record<string, unknown>;
    const entityId = typeof rec.entityId === 'string' ? rec.entityId : null;
    if (!entityId) continue;
    const stanceRaw = rec.stance;
    const stance = (stanceRaw === 'supports' || stanceRaw === 'contradicts' || stanceRaw === 'neutral')
      ? stanceRaw : 'neutral';
    const gradeRaw = typeof rec.grade === 'string' ? rec.grade : 'C3';
    const grade = (parseAdmiraltyCode(gradeRaw) ? gradeRaw : 'C3') as AdmiraltyCode;
    out.push({ entityId, stance, grade, quote: typeof rec.quote === 'string' ? rec.quote : undefined });
  }
  return out;
}
