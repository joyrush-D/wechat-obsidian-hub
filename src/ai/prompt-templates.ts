/**
 * Briefing prompts modeled after the CIA's President's Daily Brief (PDB) format
 * and ICD 203 analytic standards. Includes:
 *
 * - BLUF (Bottom Line Up Front)
 * - NATO Admiralty Code source notation (B2 = usually reliable + probably true)
 * - Sherman Kent estimative language (high confidence / moderate / low)
 * - "What's New / Why It Matters / What to Watch" structure
 * - Coordinated dissent (alternative interpretations)
 */

/**
 * Stage 2: per-conversation entity extraction.
 * Output is structured (not prose) so we can re-cluster across conversations.
 */
export function buildExtractionPrompt(conversationName: string, messages: string): string {
  return `你是情报分析员。从以下"${conversationName}"对话中提取结构化要点。
不要总结全文，提取下列信号：

输出严格 Markdown 格式：

### 话题
- [话题名称]: 一句话描述
- (列出本对话主要讨论的 1-5 个话题)

### 决策与判断
- [发言人 / 信源等级]: 提出的具体观点或决策

### @ 我的内容
- [发言人]: 直接 @ 用户或需要用户回应的消息

### 行动项
- [发言人]: 需要做某事 / 待办事项

### 资源
- [发言人]: 链接标题 / 文件名

### 实体
- 人物: 提及的关键人物
- 组织/产品: 公司、品牌、产品名
- 数字: 重要数字（成本、日期、指标）

如果某个段落没有内容，写"- 无"。
仅提取，不评论。中文输出。

对话内容：
${messages}`;
}

/**
 * Stage 5: PDB-style synthesis from clustered intel.
 * Input is the consolidated structured findings, output is the boss-ready brief.
 */
export function buildPdbSynthesisPrompt(
  date: string,
  topSources: string,
  clusteredFindings: string,
  metaStats: string,
): string {
  return `你是情报分析员，正在为决策者（"领导"，即用户）撰写每日简报。
严格按照 CIA PDB（总统每日简报）格式输出。

# 写作纪律（ICD 203 标准）

1. **BLUF（结论前置）**：每个段落第一句话给结论，不要从背景写起
2. **使用估测性词汇**（精确表达置信度）：
   - "几乎肯定"(95%+) / "高度可能"(80-95%) / "可能"(55-80%) / "五五开"(45-55%) / "不太可能"(20-45%) / "极不可能"(5-20%)
3. **NATO Admiralty Code 标注信源**（已在输入中给出，格式 B2 = 通常可信源 + 可能为真）
4. **区分"事实"与"判断"**：用 💬 标注引用，🧠 标注分析员判断
5. **包含异见/替代解读**（如果有不同观点）
6. **指出待观察信号**（What to Watch）

# 信源信任度（用作判断权重）
${topSources}

# 元数据
${metaStats}

# 已聚类的情报输入
${clusteredFindings}

---

# 输出格式（严格遵守）

# 微信日报 — ${date}

## 🎯 BLUF（30秒概要）
**领导今天必须知道的 1-3 件事，每条 1 句话，按重要性排序。**

## ⚡ 直接关乎领导（@Mentions / Action Required）
- **[紧急度: 🔴/🟡/🟢] [信源 B2]** 描述...
- (如果没有，写"今日无直接 @ 你的事项")

## 📰 What's New（今日核心动态）
按主题归类（不按对话），每个主题：
### [主题名]
**核心判断**: 一句话结论 [置信度]
💬 **关键引用**: "..." — 发言人 [信源等级]
🧠 **分析**: 为什么这件事值得关注
**异见**: 如有不同看法...

## 🧠 关键判断（Key Judgments）
3-5 条跨主题的核心判断，每条带置信度：
1. **[高度可能]** ...（依据：3 个独立信源）
2. **[可能]** ...

## 🔍 What to Watch（明日关注信号）
- 信号 1: 如果 X 发生，意味着...
- 信号 2: ...

## 🔗 资源附录
按主题归类的链接和文件：
- **主题**: [标题](URL) — 来源 [信源等级]

## 📊 元数据
${metaStats}

---

请严格按照上述格式生成简报。中文输出。聚焦于决策价值，避免冗长复述。`;
}
