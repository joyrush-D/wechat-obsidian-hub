/**
 * Prompt templates inspired by IC standards from US/UK/Israel/etc.
 * - PDB (CIA), JIC consensus (UK), Tenth Man (Israel), Tearline (NSA)
 * - ICD 203 analytic standards, Sherman Kent estimative language
 */

/**
 * DIRECT SYNTHESIS mode — single-pass briefing.
 * With large context models (100K+ tokens), bypass extraction/cluster stages entirely.
 * Let the LLM see ALL raw messages and do the full analysis in ONE call.
 * This avoids information loss from cascaded summarization.
 */
export function buildDirectSynthesisPrompt(
  date: string,
  allMessages: string,
  metaStats: string,
  userWxid: string = '',
  userIdentities: string[] = [],
): string {
  const identityList = userIdentities.length > 0
    ? userIdentities.slice(0, 30).join(' / ')
    : userWxid;
  return `你是情报分析员，以美军 PDB（总统每日简报）标准为决策者（你的领导）撰写日报。

【输入】${metaStats}
【重要 - 用户的所有身份】${identityList}
  → 消息中出现上述任何名字（如 @某个名字），都是在 @ 领导本人。
  → 领导在不同群可能用不同昵称（业务群一种、家长群另一种等），这些都是同一个人。
  → 领导发出的消息以其 wxid 开头。

【严格纪律 - ICD 203】
1. **结论前置**：每段第一句给结论
2. **估测词汇**：只用 [几乎肯定]/[高度可能]/[可能]/[五五开]/[不太可能]/[极不可能]
3. **标注信源**：每个判断注明来源（谁说的、哪个对话）
4. **严格聚类**：同一主题必须有共享实体（公司/产品/事件）—— 不相关的事绝不归一类
5. **第十人**：强制提出一个反方假设
6. **Bellingcat**：关键判断附"如何独立验证"
7. **证据可追溯**：消息正文每条前都有形如 \`[msg:wechat:<convoId>:<localId>]\` 的稳定 ID；**引用原话时，把该 ID 写在引用末尾**（格式：\`"原话" [msg:wechat:...]\`）以便下游 Finding 抽取器精准回溯证据。

【输出结构】

# 微信日报 ${date}

## 🎯 30 秒速读
领导最需要立刻知道的 3-5 件事，每条一句话 + 置信度。

## 📍 直接关乎你（@Mentions / Action Required）
列出所有直接 @ 领导、1对1私信、紧急求助、需要回应的消息。按紧急度（🔴紧急/🟡重要/🟢留意）。格式：
- 🔴/🟡/🟢 **[人名]** 在 [对话]: "原话摘要" → 建议回复要点

如果真的没有，写"今日无人直接 @ 你"（别编造）。

## 📰 今日要闻（按具体主题）
**尽量完整覆盖**：今天讨论的**每个有实质内容的主题**都要列出（通常 8-15 个，不要省略）。
每个主题必须是具体实体/事件（如"领克UI规范更新"而不是"业务讨论"）。
**业务 + 行业 + 家庭/个人事务都要覆盖**——微信是多维触点，不要只挑工作话题。
**无实质内容的闲聊/寒暄**不算主题。
### [具体主题]
**涉及**: 哪些对话提到
**核心**: 一句话结论 [置信度]
💬 引用: "..." [msg:wechat:...] — [人名]
🧠 分析: 为什么值得关注

## 🌐 今日信息接触面（Information Touchpoints）
**每一条外部信息输入（链接 / 新闻 / 报告 / 观点 / 分享的文档）都要抽取**——
不只是列 URL，而是把它视为"今天大脑被喂进来的一块知识"，用一句话说清这条信息**带来了什么新认知**。

按**知识类型**分组：
### 📊 行业 / 市场情报
- **[分享人]** — [主题]：核心观点 / 数据点 / 来源
  🔗 [链接或出处]
### 🌍 宏观 / 时事
（同上格式）
### 💡 技术 / 工具
### 📚 观点 / 方法论
### 🎭 其他（生活 / 娱乐 / 八卦）

如果**某类今日无内容**，那一小节直接省略。**整段不得少于 5 条输入**——除非今日真的很静默。

## 🧠 关键判断
**3-6 条**跨主题的重要判断（不要固守数量下限，有多少列多少）：
1. **[置信度]** 判断 — 依据：... — 如何验证：...

## 🤔 反方观点（第十人）
> 如果上述主要判断其实是错的，会是什么情况？

## 👥 重要人物动态
高频或与领导关系密切的 3-5 人，今日做了什么/说了什么：
- **[人名]**: 主要动态 / 关键一句话 / **带来的信息或观点**（如分享了什么、持什么立场）

## 🛡️ 可疑信息（Reflexive Control）
如有单一来源的重大断言、缺乏基础率的数字、或协调投放特征的信息，标出。没有就写"今日无显著操纵特征"。

## 🔍 明日关注
2-3 个值得盯的信号。

## ⚠️ 未处理媒体 / 信号缺口
如消息中出现 \`[voice]\` / \`[image]\` / \`[video]\` 等占位符（表示该模态未转文字），列出**数量 + 所在对话**，提醒领导这些是**情报盲区**。如果全部已处理，写"无"。

## 🔗 资源索引
把上面提过的所有链接 + 关键外部出处汇总，按主题索引。每条形如：
- **[主题]** — [标题或描述]（来源：[发起人]；置信度：[核心信源/生疏信源/陌生人]）
  🔗 https://...

严格按上述格式。中文。不要前言后语。**完整性优先于简洁**——少列比错列更可怕。

---

【今日全部消息（按对话分组）】

${allMessages}`;
}

/**
 * Stage 2: per-conversation entity extraction (legacy, for small-context fallback).
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
 * Stage 3: cluster compression with STRICT identity-based grouping.
 *
 * Bug fix: previous version grouped semantically-loose items ("SIM card penalty"
 * and "customs declaration") into one theme just because both were "business risk".
 * Now requires CONCRETE shared identity (same entity, same event, same decision).
 */
export function buildClusteringPrompt(extractions: string): string {
  return `你是情报分析员。下面是今日所有对话的抽取结果。

【任务】不按对话分组，而是按具体话题跨对话归并。

【严格聚类规则 — 非常重要】
两个或以上的条目只有在下列任一条件成立时，才能归入同一主题：
1. **共享实体**：同一个公司名、产品名、项目名、人物名（例如都提到"领克"）
2. **共享事件**：在讨论同一个具体事件（例如都在讨论"昨天某地发生的XX")
3. **共享决策**：围绕同一个具体决策或行动
4. **直接引用/回应**：A 的话被 B 引用或回应

【禁止的错误归类】
- ❌ 仅因"都是业务风险"、"都是合规问题"、"都是科技新闻"就归类 — 这些都是太泛的标签
- ❌ 没有共同实体只有模糊相似性就归类
- 如果一个条目找不到明确的共享实体/事件/决策，**单独列为一个主题**（独立主题），不要强行塞进别的主题里

输出格式（严格遵守）：

## 跨群话题

### [主题名: 必须是具体的实体名或事件名，不是抽象类别]
- **涉及对话**: [群A], [群B]（列出具体对话ID或群名）
- **共同标识**: 说明为什么这些条目属于同一主题（共享的实体/事件/决策是什么）
- **核心讨论**: 一两句话
- **关键发言**: [人名]: 观点
- **资源**: 标题 (URL)

### [独立主题A: xxx]
（只有一个条目相关的，也单独列出，不要硬塞）
- **单一来源**: 某个对话
- **核心**: ...

## 个人焦点
（直接 @ 用户、求助、需要回应的事项，按紧急度排序）
- 🔴 [紧急] [人名] 在 [对话]: 内容
- 🟡 [重要] ...
- 🟢 [留意] ...

## 重要人物今日动态
（高频或有备注的发言人都说了什么，按人分组）
- **[人名]**: 主要话题/观点

## 资源汇总
（按具体主题归类的真实链接，跳过"版本不支持"）
- **[具体主题]**: 标题 — URL

严格按上述结构，不要前言后语。中文输出。

【自检】生成前请自问：我归到同一主题的条目，它们真的有共享的具体实体/事件吗？如果没有，就拆成多个独立主题。

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
**严格要求**：每个主题必须明确说明涉及的具体实体/事件（不是抽象类别）。不相关的信息绝对不要硬凑在一起。
### [主题: 必须是具体事物，如"领克UI规范更新"而非"设计工作"]
**涉及**: 哪些具体实体/对话
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
 * Weekly Rollup: synthesize 7 days of extractions into cross-day patterns.
 * Identifies recurring topics, active people, emerging trends.
 */
export function buildWeeklyRollupPrompt(dateRange: string, weeklyData: string): string {
  return `你是周度情报分析员。下面是过去一周每天的抽取数据。

【任务】生成一份周报，不是 7 份日报的堆砌，而是发现**跨日模式**。

【重点识别】
1. **持续话题**：同一话题在多天出现 — 是上升趋势还是余烬？
2. **活跃人物动态**：谁这周异常活跃 / 异常沉默？
3. **决策与行动**：已达成的决策 vs 悬而未决的问题
4. **跨日信号**：前几天的预兆今天兑现了吗？
5. **未解问题**：一周前提出但仍悬而未决的事项

【输出格式】
# 微信周报 ${dateRange}

## 🎯 本周 BLUF（3 句话）
领导本周必须知道的最关键 3 件事。

## 📈 持续趋势（多天出现的话题）
### [话题名]
- **时间线**：第1天 → 第3天 → 本周末（简述演进）
- **核心判断**：[置信度]
- **当前状态**：进展/停滞/升级/降级

## 👥 本周重要人物
### [人名]
- **活跃度**：本周跨 N 天 M 条消息
- **主要主张**：用一句话概括
- **异常**：是否与其平时模式不同

## ✅ 已完成（本周闭环）
- 本周达成的决策或已处理的问题

## ⏳ 悬而未决（需你跟进）
- 本周提出但未完成的关键事项

## 🔮 下周关注信号
- 本周埋下的伏笔/预兆

## 📊 元数据
${dateRange}

请只输出上述结构，中文。不要前言。

本周数据:
${weeklyData}`;
}

/**
 * Topic Brief (Target-Centric): cross-time analysis of a specific topic.
 * Filters historical extractions by keyword, assembles timeline narrative.
 */
export function buildTopicBriefPrompt(topic: string, dateRange: string, filteredData: string): string {
  return `你是专题情报分析员。针对主题"${topic}"，分析 ${dateRange} 内的相关讨论。

【任务】不是把消息堆在一起，而是**按时间线重构事件演进**。

【输出格式】
# 专题简报: ${topic}

## 🎯 核心判断（BLUF）
关于"${topic}"目前的状况，一句话 [置信度]。

## 📅 时间线
按日期列出关键节点：
### YYYY-MM-DD
- **事件**：发生了什么
- **关键发言**：[人名] 说"..."
- **影响**：对话题走向的影响

## 👥 主要参与者
- **[人名]**：立场/观点概述
- **[人名]**：立场/观点概述

## 🔍 分歧与共识
- **共识点**：大家都同意什么
- **分歧点**：争议在哪里（如明显有争议，建议运行 ACH 深挖）

## 📌 待办事项
- 与此主题相关的悬而未决的事

## 🔗 相关资源
- 链接按时间排序

严格按格式输出，中文。不要前言后语。

原始数据（已按主题过滤）:
${filteredData}`;
}

/**
 * ACH (Analysis of Competing Hypotheses) — Heuer's signature technique.
 * Lays out competing hypotheses with evidence matrix.
 */
export function buildACHPrompt(topic: string, filteredData: string): string {
  return `你是资深情报分析员，现在用 Heuer 的 ACH 方法分析"${topic}"这个有争议的话题。

【ACH 核心步骤】
1. 识别 2-4 个**竞争性假设**（不能只有 1 个）
2. 列出关键证据
3. 构建矩阵：每条证据对每个假设是支持(✓) / 反驳(✗) / 中性(?)
4. 计算每个假设的"反驳分数"（反驳越少越可信）
5. 得出最可能的假设 + 置信度

【重要原则】
- 不要只选一个假设找证据支持（确认偏差）
- 要找能**反驳每个假设**的证据
- 假设必须**互斥** — 如果 H1 成立 H2 就不成立
- 诚实标注"证据不足"的地方

【输出格式】
# ACH 分析: ${topic}

## 🎯 最终判断
**最可能的假设**: H[x] [置信度]
**置信度理由**: 主要是因为反驳证据最少

## 📋 竞争性假设
- **H1**: 假设描述
- **H2**: 假设描述
- **H3**: 假设描述（可选）

## 🧱 关键证据
- **E1**: 证据 1 的描述 — 来源: [人名/对话]
- **E2**: 证据 2 的描述
- **E3**: ...

## 📊 证据矩阵

| 证据 | H1 | H2 | H3 |
|------|----|----|----|
| E1 | ✓/✗/? | ✓/✗/? | ✓/✗/? |
| E2 | ... | ... | ... |
| ... | ... | ... | ... |
| **反驳次数** | N | N | N |

## 💡 关键观察
- 哪个假设反驳最多？
- 哪条证据最具决定性？
- 有哪些**必要证据仍然缺失**？

## 🔍 验证路径
- 要进一步确认判断，应该收集什么证据？
- 向谁求证？

严格按上述格式输出。矩阵必须真的画表格。中文。

待分析材料:
${filteredData}`;
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
 * Shareable Tearline: desensitized version suitable for sharing with team.
 * Strips sender names, specific group names, personal details.
 * Keeps only objective facts, decisions, and general insights.
 *
 * Inspired by NSA tearline format — the portion below the dashed line
 * is the part that can be shared with allies after removing source-sensitive info.
 */
export function buildShareableTearlinePrompt(fullBriefing: string): string {
  return `将以下私人简报转为**可分享给团队的脱敏版**。

【脱敏纪律】
- ✂️ 删除：具体发言人姓名（用角色代替，如"某供应商"、"某同事"、"业务方"）
- ✂️ 删除：具体群名/对话名
- ✂️ 删除：所有"@你/我"、个人情绪、人身评价
- ✂️ 删除：明显只与用户相关的私人事务（个人财务、家庭、健康）
- ✅ 保留：客观事实、行业动态、技术讨论要点、公开资源链接
- ✅ 保留：对团队有共同价值的判断（但去掉"我认为"之类的主观口吻）
- ✅ 保留：值得团队关注的公开趋势

【输出格式】
## 📤 可分享版（脱敏）

### 业务与技术要点
- （客观描述，去人名去群名）

### 行业动态
- （公开可讨论的新闻、技术趋势）

### 值得关注的资源
- [标题] — URL（只保留公开链接）

不超过 500 字。如果简报里几乎全是私人事务，只写"本日简报以私人事务为主，无可分享内容"。

输入简报:
${fullBriefing}

输出脱敏版（直接输出内容，不要前言）：`;
}

/**
 * Reflexive Control Assessment — CONSERVATIVE version.
 * Only flags TRULY suspicious patterns. Default to "nothing suspicious".
 */
export function buildReflexiveControlPrompt(clusteredFindings: string): string {
  return `你是反制信息操纵分析员。任务：识别**真正**可能被故意投放的信息。

【极重要 - 必读】
默认假设：今日信息**没有**被操纵。
只在出现**强证据**时才标记。**绝对不要编造关联**。
"两件事在同一群出现" ≠ 它们有关系。
"某人说了一个观点" ≠ 这是操纵。

【强证据信号（缺一不可）】
只有同时满足以下 2 项以上才能标记：
- 📢 单一来源对重大事件做斩钉截铁断言
- 🔄 完全相同的论调出现在 ≥3 个独立来源（疑似协调投放）
- 📊 关键数字无出处但被反复引用
- 🗓️ 信息出现的时机正好对你的某决策有特定影响
- 🏷️ 同一信源在短时间内多次推动某结论

【禁止的标记原因】
- ❌ "在同一群同时出现两个不同话题" — 这只是巧合
- ❌ "某人发了链接但没解释" — 群里发链接很正常
- ❌ "信息缺少独立验证" — 99%的群聊信息都缺少独立验证
- ❌ 任何形式的"利用 X 掩护 Y" 推测 — 必须有明确证据

【输出格式】
## 🛡️ 操纵风险评估

如果**真的没发现强证据**（这是最常见的情况）：
> 本日未发现显著操纵特征。

如果发现强证据：
### 可疑信号 1
- **信息**: 具体引用
- **可疑原因**: 必须列出至少 2 个上面的强证据信号
- **来源**: 谁/哪个对话
- **建议**: 独立验证途径

宁可什么都不标记，也不要编造关联。中文输出。

待评估内容：
${clusteredFindings}`;
}

/**
 * Pattern of Life: per-person daily profile across all conversations.
 */
export function buildPatternOfLifePromptV2(perPersonData: string): string {
  return `你是行为模式分析员（Pattern of Life）。

下面是今日几位重要联系人在各群的发言汇总。每人生成一份画像：

### [姓名]
- **今日活跃度**: 高/中/低（依据：发言条数与跨群数）
- **主要关注**: 列 2-3 个具体话题
- **最有信息量的一句**: 直接引用最有价值的一条
- **情绪/口吻**: 平静 / 兴奋 / 抱怨 / 紧迫 / 犹豫...
- **异常**: 是否与其往常模式不同（如突然高频 / 突然沉默 / 罕见话题）

只为数据中出现的人生成画像。不要编造没说的话。中文输出。

数据：
${perPersonData}`;
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
