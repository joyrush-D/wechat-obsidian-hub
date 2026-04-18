/**
 * CriticAgent — fact-checks a generated briefing against the EvidenceStore
 * and the user's identity profile.
 *
 * Per VISION.md §Cap 2 (Structured Adversarial Reasoning) + user feedback
 * "全部靠 skill 的方式不行的，需要 Agent 框架来做事实核查". Prompt-tweaks
 * have a ceiling — when the LLM hallucinates "user's child got into
 * Berkeley" because someone else announced it in a group, no amount of
 * prompt engineering bullets will reliably catch every variant.
 *
 * Approach (v0 — single-pass structured critique):
 *   1. Caller provides briefing + extracted Findings + user identity list +
 *      a lookup for {messageId → senderWxid + senderName + container}
 *   2. Critic formats all the verification context into ONE prompt
 *   3. LLM returns JSON list of issues with type/severity/finding/suggestion
 *
 * v1 will convert to a multi-step ReAct loop with Hermes tool calls
 * (lookup_message, is_user, etc.) so the LLM can drill in selectively
 * instead of getting fed everything up front.
 */

import type { Finding } from '../types/finding';

export interface CritiqueLlm {
  complete(prompt: string, opts?: { temperature?: number }): Promise<string>;
}

export interface MessageContext {
  messageId: string;
  senderWxid: string;
  senderName: string;
  containerName: string;
  text: string;
}

export interface CritiqueIssue {
  /** Finding id whose attribution is questioned. */
  findingId: string;
  /** Human-readable type label. */
  type: 'misattribution' | 'unsupported' | 'overconfident' | 'evidence-mismatch' | 'other';
  /** 'high' = factual error; 'medium' = ambiguous; 'low' = stylistic. */
  severity: 'high' | 'medium' | 'low';
  /** Plain-Chinese explanation of the problem. */
  explanation: string;
  /** Plain-Chinese suggested correction. */
  suggestion: string;
}

export interface CritiqueRequest {
  briefingMarkdown: string;
  findings: Finding[];
  userWxids: string[];               // all wxids/aliases the user is known by
  /** lookup_message(id) → context for cited evidence. May be partial. */
  messageContexts: Record<string, MessageContext>;
}

export class CriticAgent {
  constructor(private llm: CritiqueLlm) {}

  async critique(req: CritiqueRequest): Promise<{ issues: CritiqueIssue[]; raw: string; errors: string[] }> {
    const prompt = buildCritiquePrompt(req);
    let rawOutput: string;
    try {
      rawOutput = await this.llm.complete(prompt, { temperature: 0.1 });
    } catch (e) {
      return { issues: [], raw: '', errors: [`LLM 调用失败: ${(e as Error).message}`] };
    }
    const { issues, errors } = parseCritiqueOutput(rawOutput, req.findings);
    return { issues, raw: rawOutput, errors };
  }
}

export function buildCritiquePrompt(req: CritiqueRequest): string {
  const userIdsList = req.userWxids.length > 0
    ? req.userWxids.slice(0, 30).join(' / ')
    : '(未提供 — 任何"领导/我"主张都视为可疑)';

  const findingsBlock = req.findings.map((f, i) => {
    const refs = f.evidenceRefs.map(r => `[${r.entityId}, ${r.stance}]`).join(', ');
    return `${i + 1}. [${f.id}] ${f.judgment}\n   置信: ${f.kentPhrase} (${f.probRange[0]}%-${f.probRange[1]}%)\n   证据: ${refs}`;
  }).join('\n\n');

  // Build a compact lookup table: id → "[sender_name (sender_wxid) @ container]: text..."
  const ctxLines = Object.values(req.messageContexts).slice(0, 60).map(c => {
    const userTag = req.userWxids.includes(c.senderWxid) ? ' 🟢领导本人' : '';
    return `[${c.messageId}] **${c.senderName}** (\`${c.senderWxid}\`)${userTag} @ ${c.containerName}: "${c.text.slice(0, 120)}"`;
  }).join('\n');

  return `你是情报分析员的**事实核查助手**（CriticAgent）。
工作纪律：审查下面这份简报里的每条 Finding（结构化判断），找出**事实性错误**——尤其是**归属错误**：
错把别人的事说成"领导的事"，错把第三方家庭/公司事件当成领导自己的。

# 领导身份（这些 wxid / 别名都是同一个人 = 领导本人）
${userIdsList}

# 本日 Findings（已抽取的结构化判断）

${findingsBlock || '(无 finding)'}

# 证据引用上下文（messageId → 发送者 + 内容；🟢 = 领导本人发的）

${ctxLines || '(无可查上下文)'}

# 你的任务

逐条审查上面的 Findings。对每条：
1. **检查 judgment 里隐含的"领导本人"主张**（"子女...""我的客户...""我们公司..."）
2. **核对 evidenceRefs 里 messageId 的发送者**：
   - 如果发送者 wxid 在领导身份列表里（🟢） → 主张可能成立
   - 如果发送者是别人 → 这是**第三方**消息，judgment 不应假设是领导的事 → 标记 misattribution
3. **检查置信度是否合理**：单一来源 + B/C 级评级却给 [几乎肯定] 是 overconfident

# 输出格式（严格 JSON 数组，不要前言后语）

[
  {
    "findingId": "finding:xxx",
    "type": "misattribution | unsupported | overconfident | evidence-mismatch | other",
    "severity": "high | medium | low",
    "explanation": "一句话说清楚错在哪",
    "suggestion": "一句话说清楚怎么改"
  }
]

如果**没有发现任何问题**，返回 \`[]\`。

# 严格规则
- 只标真问题，不要鸡蛋里挑骨头
- misattribution = high severity（事实错误，最严重）
- 如果证据 messageId 在上下文里查不到，type 用 "evidence-mismatch"
- 输出仅 JSON 数组，不要解释`;
}

export function parseCritiqueOutput(
  llmOutput: string,
  findings: Finding[],
): { issues: CritiqueIssue[]; errors: string[] } {
  const errors: string[] = [];
  const arr = extractJsonArray(llmOutput);
  if (!arr) return { issues: [], errors: ['LLM 输出未包含 JSON 数组'] };
  let raw: unknown;
  try { raw = JSON.parse(arr); } catch (e) {
    return { issues: [], errors: [`JSON 解析失败: ${(e as Error).message}`] };
  }
  if (!Array.isArray(raw)) return { issues: [], errors: ['JSON 不是数组'] };

  const knownIds = new Set(findings.map(f => f.id));
  const issues: CritiqueIssue[] = [];
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    if (!r || typeof r !== 'object') continue;
    const rec = r as Record<string, unknown>;
    const findingId = typeof rec.findingId === 'string' ? rec.findingId : null;
    const explanation = typeof rec.explanation === 'string' ? rec.explanation : null;
    const suggestion = typeof rec.suggestion === 'string' ? rec.suggestion : null;
    if (!findingId || !explanation || !suggestion) {
      errors.push(`Row ${i}: 缺必需字段`);
      continue;
    }
    if (!knownIds.has(findingId)) {
      errors.push(`Row ${i}: findingId "${findingId}" 不在 finding 列表中`);
      continue;
    }
    const t = rec.type;
    const type: CritiqueIssue['type'] =
      (t === 'misattribution' || t === 'unsupported' || t === 'overconfident' || t === 'evidence-mismatch')
        ? t : 'other';
    const s = rec.severity;
    const severity: CritiqueIssue['severity'] = s === 'high' || s === 'low' ? s : 'medium';
    issues.push({ findingId, type, severity, explanation, suggestion });
  }
  return { issues, errors };
}

function extractJsonArray(text: string): string | null {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
  if (fenced) return fenced[1];
  const first = text.indexOf('[');
  const last = text.lastIndexOf(']');
  if (first === -1 || last === -1 || last < first) return null;
  return text.slice(first, last + 1);
}

/**
 * Render issues as markdown for embedding into the briefing.
 */
export function renderCritiqueMarkdown(issues: CritiqueIssue[]): string {
  if (issues.length === 0) return '## 🔍 事实核查（CriticAgent）\n\n✅ 未发现归属或置信度问题。\n';

  const high = issues.filter(i => i.severity === 'high');
  const med = issues.filter(i => i.severity === 'medium');
  const low = issues.filter(i => i.severity === 'low');

  const lines: string[] = [];
  lines.push('## 🔍 事实核查（CriticAgent）');
  lines.push('');
  lines.push(`> 共 ${issues.length} 条问题：${high.length} 高 / ${med.length} 中 / ${low.length} 低`);
  lines.push('');

  for (const sev of ['high', 'medium', 'low'] as const) {
    const subset = issues.filter(i => i.severity === sev);
    if (subset.length === 0) continue;
    const icon = sev === 'high' ? '🔴' : sev === 'medium' ? '🟡' : '🟢';
    const label = sev === 'high' ? '高（事实错误）' : sev === 'medium' ? '中（值得复核）' : '低（建议优化）';
    lines.push(`### ${icon} ${label}`);
    lines.push('');
    for (const i of subset) {
      lines.push(`- **${typeLabel(i.type)}** \`${i.findingId}\``);
      lines.push(`  - ❓ ${i.explanation}`);
      lines.push(`  - 💡 建议: ${i.suggestion}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function typeLabel(t: CritiqueIssue['type']): string {
  switch (t) {
    case 'misattribution': return '归属错误';
    case 'unsupported': return '证据不足';
    case 'overconfident': return '过度自信';
    case 'evidence-mismatch': return '证据 ID 不存在';
    default: return '其他';
  }
}
