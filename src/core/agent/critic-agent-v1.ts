/**
 * CriticAgentV1 — re-implementation of CriticAgent using the SkillRegistry +
 * AgentRunner (vercel/ai SDK + Hermes function-calling).
 *
 * Key difference vs v0 (single-pass prompt): the LLM CALLS tools to verify
 * specific facts (look up message X, check if wxid Y is the user) instead
 * of getting all context up front. This scales to large briefings without
 * blowing the context window AND lets the model selectively investigate
 * just the suspicious findings.
 *
 * Same input/output shape as v0 so it's a drop-in replacement.
 */

import type { Finding } from '../types/finding';
import type { CritiqueIssue } from './critic-agent';
import { parseCritiqueOutput } from './critic-agent';
import { AgentRunner } from './agent-runner';
import { SkillRegistry } from '../skills/skill-registry';
import { defaultCritiqueSkills, type BuiltinSkillContext } from '../skills/builtin-skills';

export interface CriticV1Config extends BuiltinSkillContext {
  /** OpenAI-compatible LLM endpoint (LM Studio default localhost:1234/v1). */
  baseURL: string;
  /** Model id; empty string lets LM Studio auto-pick. */
  modelId: string;
  /** Max ReAct iterations. Default 8 — usually enough for 3-5 findings. */
  maxSteps?: number;
}

export interface CriticV1Request {
  briefingMarkdown: string;
  findings: Finding[];
}

export class CriticAgentV1 {
  private runner: AgentRunner;
  private findingsSnapshot: Finding[] = [];

  constructor(cfg: CriticV1Config) {
    const skills = new SkillRegistry();
    skills.registerAll(defaultCritiqueSkills(cfg));
    this.runner = new AgentRunner({
      baseURL: cfg.baseURL,
      modelId: cfg.modelId,
      skills,
      maxSteps: cfg.maxSteps ?? 8,
      temperature: 0.1,
    });
  }

  async critique(req: CriticV1Request): Promise<{ issues: CritiqueIssue[]; raw: string; errors: string[] }> {
    this.findingsSnapshot = req.findings;
    const findingsBlock = req.findings.map((f, i) => {
      const refs = f.evidenceRefs.map(r => `[${r.entityId}, stance=${r.stance}]`).join(', ');
      return `${i + 1}. id=${f.id}\n   judgment: ${f.judgment}\n   confidence: ${f.kentPhrase} (${f.probRange[0]}%-${f.probRange[1]}%)\n   evidence: ${refs}`;
    }).join('\n\n');

    const userPrompt = `这是今日生成的简报和已抽取的 ${req.findings.length} 条 Findings。
请对每条 finding 验证其归属是否正确（特别是 "领导本人" 类主张）。

# 简报正文

${req.briefingMarkdown.slice(0, 6000)}${req.briefingMarkdown.length > 6000 ? '\n\n...(已截断)' : ''}

# 待核查 Findings

${findingsBlock}

# 你的任务

按下面的步骤工作：
1. 先调用 \`get_user_identities\` 拿到领导的 wxid 列表
2. 对每条 finding 的每个 evidenceRef，调用 \`lookup_message\` 拿到发送者的真名 + wxid + 是否是领导
3. 如果发现"领导的 / 我的 / 子女 / 我们公司"类主张但证据来源不是领导本人 → 标记为 misattribution
4. 如果证据 messageId 在 lookup_message 返回 ok=false → 标记 evidence-mismatch
5. 全部检查完后，**输出最终 JSON 数组**：

[
  {"findingId": "<id>", "type": "misattribution|unsupported|overconfident|evidence-mismatch|other", "severity": "high|medium|low", "explanation": "...", "suggestion": "..."}
]

如果都没问题，返回 \`[]\`。**只输出 JSON 数组，不要前言后语。**`;

    const systemPrompt = `你是情报分析员的事实核查助手（CriticAgent）。
你的工具可以查询任意消息的发送者、检查 wxid 是不是领导本人。
按 ReAct 模式工作：Thought → Tool Call → Observation → 重复 → 最终给 JSON 结论。`;

    const result = await this.runner.run(userPrompt, systemPrompt);

    if (result.error) {
      return { issues: [], raw: '', errors: [`Agent 运行失败: ${result.error}`] };
    }

    const { issues, errors } = parseCritiqueOutput(result.text, this.findingsSnapshot);
    if (issues.length === 0 && errors.length === 0 && result.text) {
      // Empty array — no issues found
    }
    return { issues, raw: result.text, errors };
  }
}
