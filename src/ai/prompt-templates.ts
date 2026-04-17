/**
 * Prompt templates inspired by IC standards from US/UK/Israel/etc.
 * - PDB (CIA), JIC consensus (UK), Tenth Man (Israel), Tearline (NSA)
 * - ICD 203 analytic standards, Sherman Kent estimative language
 */

/**
 * Stage 2: per-conversation entity extraction.
 * Output is dense structured Markdown, not prose.
 */
export function buildExtractionPrompt(conversationName: string, messages: string): string {
  return `从"${conversationName}"对话中提取关键信号。严格按以下格式输出，不要扩展不要解释。

每段如果没内容，写"无"。中文输出。

### 议题
- 一行一个，不超过 5 个

### 决策与判断
- 谁说了什么具体观点（不是泛泛讨论）

### @我或求助
- 直接 @ 用户、需要回应、或求帮忙的消息

### 行动项
- 谁需要做什么具体的事

### 资源链接
- 标题: URL（只列真实链接，跳过"版本不支持"）

### 重要实体
- 人物: ...
- 公司/产品: ...
- 关键数字: ...

对话:
${messages}`;
}

/**
 * Stage 3: cluster compression - compress per-conversation extractions
 * into cross-conversation themes (cuts down tokens for final synthesis).
 */
export function buildClusteringPrompt(extractions: string): string {
  return `你是情报分析员。下面是今日所有对话的抽取结果。请重新组织：
不按对话分组，而是**按话题/主题**跨对话归并。

输出格式（严格遵守）：

## 跨群话题

### [主题1: 简短标题]
- 涉及对话: [群A], [群B]
- 核心讨论: 一两句话
- 关键发言: [人名]: 观点
- 资源: 标题 (URL)

### [主题2: ...]
...

## 个人焦点
（直接 @ 用户、求助、需要回应的事项，按紧急度排序）
- 🔴 [紧急] [人名] 在 [对话]: 内容
- 🟡 [重要] ...
- 🟢 [留意] ...

## 重要人物今日动态
（高频或有备注的发言人都说了什么）
- [人名]: 主要话题/观点

## 资源汇总
（按主题归类的所有真实链接）
- [主题]: 标题 — URL

请只输出上述结构，不要前言后语。中文输出。

抽取数据:
${extractions}`;
}

/**
 * Stage 5: PDB-style synthesis from clustered intel.
 * Inspired by CIA PDB + UK JIC + Israeli Tenth Man + Sherman Kent estimative language.
 */
export function buildPdbSynthesisPrompt(
  date: string,
  topSources: string,
  clusteredFindings: string,
  metaStats: string,
): string {
  return `你正在为决策者（"领导"）撰写一份**简洁、可执行**的微信日报。

# 写作纪律

1. **结论前置**：每段第一句给结论
2. **使用估测词汇**："几乎肯定"(95%+) / "高度可能"(80%+) / "可能"(55%+) / "五五开"(45-55%) / "不太可能"(<45%) / "极不可能"(<20%)
3. **区分**：💬 引用 vs 🧠 你的分析判断
4. **简洁**：每段不超过 3 句。整篇控制在 1500 字以内
5. **以色列第十人**：在"反方观点"段落故意提出一个相反的解读
6. **可验证性**：关键判断附"如何独立验证"（例如查某个新闻、问某人）

# 信源信任度
${topSources}

# 数据
${metaStats}

# 输入材料（已按主题聚类）
${clusteredFindings}

---

# 输出格式（严格遵守，不要画蛇添足）

# 微信日报 ${date}

## 🎯 30 秒速读
3 条最重要的事，每条一句话 + 置信度。
1. **[置信度]** ...
2. **[置信度]** ...
3. **[置信度]** ...

## ⚡ 直接关乎你
（@ 你或需要你回复的事，按紧急度排序）
- 🔴/🟡/🟢 **[人名 · 信源等级]** 在 [对话名]: 一句话说事 → 建议回复要点
- 如果完全没有，写"今日无人直接 @ 你"

## 📰 今日要闻
按主题（不按群），每个主题：
### [主题]
**核心**: 一句话结论 [置信度]
💬 关键引用: "..." — [人名 · 信源等级]
🧠 分析: 为何重要

## 🧠 关键判断
2-4 条跨主题的重要判断：
1. **[置信度]** 判断 — 依据：...

## 🤔 反方观点（第十人原则）
故意找出一个与上述判断相反的解读，避免群体盲思：
> 如果...其实是另一回事呢？

## 🔍 明日关注
- 信号 1: 如果出现 X，意味着...
- 信号 2: ...

## 🔗 资源
按主题分组的真实链接（跳过"版本不支持"）。

请按上述格式输出，不要添加额外段落。中文。`;
}

/**
 * Pattern of Life: per-person daily summary across conversations.
 * For 5-10 most important people, show what they said today across all groups.
 */
export function buildPatternOfLifePrompt(allMessages: string, importantPeople: string): string {
  return `你是行为画像分析员（Pattern of Life Analysis）。

任务：从今日所有微信消息中，为以下重要联系人生成"每日动态画像"：
${importantPeople}

每个人输出格式：
### [姓名 · 信源等级]
- **今日活跃度**: 高/中/低 (说了多少条/在几个群)
- **关注话题**: 列 2-3 个
- **关键发言**: 最有信息量的一句话引用
- **情绪/态度**: 平静/兴奋/抱怨/紧迫... (基于语气判断)
- **异常**: 与平时模式不同的地方（如突然活跃、突然沉默、罕见话题）

只为提到的这些人生成画像。其他人不需要。中文输出。如果某人今天没说话，写"今日无发言"。

消息数据:
${allMessages}`;
}

/**
 * Time-based situational report (SITREP).
 * Shows what happened morning / afternoon / evening.
 */
export function buildSitrepPrompt(allMessages: string): string {
  return `你是值班分析员，按时段做今日态势报告（SITREP）。

输出格式：

## ☀️ 上午 (06:00-12:00)
最重要的 1-2 件事，每条一句话

## 🌤 下午 (12:00-18:00)
最重要的 1-2 件事

## 🌙 晚上 (18:00-24:00)
最重要的 1-2 件事

## 🌌 深夜 (00:00-06:00)
若有异常活动，列出。否则写"无异常"

只列**真正发生的事**（决策、争论、事件、关键分享），不列日常聊天。中文输出。

消息数据:
${allMessages}`;
}

/**
 * Cross-conversation network analysis.
 * Finds bridge nodes (people active across multiple groups) and clustering patterns.
 */
export function buildNetworkAnalysisPrompt(crossGroupData: string): string {
  return `你是社交网络分析师，找出今日跨群关键节点。

输入：每个发言人在哪些群活跃。

输出：
## 🌉 桥接节点 (Bridge Nodes)
列出在 2 个以上群活跃的人物：
- **[姓名]**: 出现在 [群A], [群B]，主要把什么信息从 A 带到 B / 在 B 引发了什么讨论

## 🔁 跨群同步话题
今天在多个群同时讨论的话题：
- **[话题]**: [群A][群B][群C] 都在讨论，主要观点对比

只列**真有跨群关联**的，没有就写"今日无显著跨群关联"。中文输出。

数据:
${crossGroupData}`;
}

/**
 * Tearline: ultra-condensed 30-second summary.
 * For when the boss only has 30 seconds.
 */
export function buildTearlinePrompt(fullBriefing: string): string {
  return `把以下完整简报压缩成 30 秒速读版。

要求：
- 不超过 300 字
- 只保留最重要的 3 件事
- 每件事 1 句话
- 包含必须立即处理的事项
- 删除所有解释、引用、分析

输入完整简报:
${fullBriefing}

输出 30 秒速读版（直接输出内容，不要前言）：`;
}

/**
 * Bias audit: check the briefing for cognitive biases (Heuer's 18-bias list).
 */
export function buildBiasAuditPrompt(briefing: string): string {
  return `你是情报分析质量审查员，按 Richards Heuer 的 18 项认知偏差清单审查这份简报。

只标记**确实出现的**偏差，不要无中生有。每项不超过一行。

主要检查：
- **确认偏差** (Confirmation Bias): 所有判断都倾向同一方向？
- **可得性启发** (Availability): 过度引用最近发生或印象深刻的事件？
- **锚定** (Anchoring): 是否被某个数字/观点过度锚定？
- **镜像** (Mirror Imaging): 假设别人的思考方式和你一样？
- **群体盲思** (Groupthink): 反方观点段落有没有真正提出反方？
- **生动偏差** (Vividness): 把生动具体的故事当成普遍规律？

输出格式：
## 偏差审计
- ⚠️ [偏差名]: 具体出现在哪段，具体是什么问题
- 如果没有显著偏差，写"本报告未发现显著认知偏差"

简报内容:
${briefing}`;
}
