/**
 * Briefing prompt template inspired by US Intelligence Community (IC) analytic standards:
 * - BLUF (Bottom Line Up Front): lead with the most important conclusion
 * - Key Judgments with confidence levels (high/moderate/low)
 * - Indicators & Warnings: things to watch
 * - Action Items: what the reader should do
 * - Source quality assessment
 *
 * Reference: ICD 203 (Analytic Standards), DIA briefing format, NSA SIGINT reports
 */

export function buildBriefingPrompt(date: string, messagesText: string): string {
  return `你是一名情报分析师，按照美军/情报界的标准格式（ICD 203 / BLUF）为用户分析今日微信消息。

## 输出格式（严格遵循）

### 📌 核心要点（BLUF — Bottom Line Up Front）
用 1-2 句话给出今日最关键的判断或最值得用户立即关注的事项。

### 🎯 关键判断（Key Judgments）
按重要性排序，每条包含：
- **判断**：明确陈述
- **依据**：来自哪个对话、谁说的、何时
- **置信度**：高 / 中 / 低（基于消息数量、来源可信度、是否有交叉验证）

### ⚠️ 警示与异常（Indicators & Warnings）
需要警惕的信号——异常活跃的对话、敏感话题、潜在冲突、需要快速回复的请求等。

### ✅ 行动项（Action Items）
用户今天/明天应该采取的具体行动，按优先级排序：
- 🔴 紧急（24小时内）
- 🟡 重要（本周内）
- 🟢 可选（有空时）

### 💡 趋势与洞察（Trends & Insights）
跨对话发现的模式：同一话题在多个群讨论、某个人在多处出现、行业动态、技术热点。

### 🔗 重要资源（Key Resources）
今日分享的有价值链接、文章、文件，按主题归类。

### 📊 元数据
- 总消息数 / 活跃对话数 / 最活跃发言人前3
- 数据日期：${date}

---

## 分析原则
1. **BLUF 优先**：最重要的结论放最前面，不要从背景讲起
2. **量化判断**：使用"高/中/低"置信度，避免模糊措辞
3. **避免冗余**：不重复消息原文，只提炼判断和洞察
4. **跳过噪音**：寒暄、表情、闲聊不进入简报
5. **关注用户**：标注哪些消息直接@用户、需要回复

## 今日消息（${date}）

${messagesText}

请按照上述格式生成简报。中文输出。`;
}

/**
 * Per-batch summary prompt (used in progressive generation).
 * Focuses each batch on extracting structured findings.
 */
export function buildBatchPrompt(batchText: string): string {
  return `你是情报分析师。从以下对话提取要点，输出结构化笔记：

每个对话用 "### 对话名" 开头，列出：
- **主要议题**：用户在讨论什么（不超过3点）
- **关键判断**：值得关注的结论或观点（含发言者）
- **行动项**：需要回复或跟进的事项（标注紧急程度）
- **资源**：分享的链接/文件（含标题）

跳过：纯寒暄、表情、无信息量的回复。
中文输出。

对话内容：

${batchText}`;
}
