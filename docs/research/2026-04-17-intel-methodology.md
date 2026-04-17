# 情报分析方法论全面调研报告

> **目的**：为域无关的情报分析 Agent 提供方法论基础。当前首个应用场景是微信消息分析 (OWH)，但所有推理逻辑必须可迁移至金融市场、OSINT、威胁情报、新闻调查等领域。
> **调研时间**：2026-04-17

---

## Part 1: 结构化分析技术 (SATs) 完整体系

SATs 的权威来源是 Heuer & Pherson 的 *Structured Analytic Techniques for Intelligence Analysis*（CQ Press，第 3 版 2020）以及美国国家情报总监办公室 (ODNI) 的 *Tradecraft Primer* (2009)。SATs 的根本目的是**把分析师大脑中的隐性推理外化为可审计、可挑战、可复盘的步骤**——这正是 Agent 化的天然切入点。

### 1.1 诊断类 (Diagnostic Techniques)

#### Key Assumptions Check (KAC，关键假设检查)
**来源**：Heuer & Pherson 2020 第 8 章；ODNI *Tradecraft Primer* 2009。

**定义**：系统列出分析所依赖的所有隐含假设，对每条假设评估「如果这条错了，结论会崩吗？」。

**步骤**：①写出当前结论 ②逆向追问每个结论依赖哪些假设 ③对每条假设打「solid / caveat / unsupported」三级标签 ④标出结论崩塌的临界假设。

**经典案例**：2003 年伊拉克 WMD 评估失败的事后归因（Butler Report 2004）——关键假设「萨达姆没有放弃 WMD 计划」从未被明确检验。

**Agent 化拆解**：LLM 读入初步结论 → 生成 10-15 条候选假设 → 对每条假设检索反证（tool use: 历史消息/数据库）→ 结构化输出 `{assumption, evidence, confidence, criticality}` JSON。

#### Quality of Information Check
**来源**：Heuer & Pherson 2020；NATO Admiralty Code。定义：逐条评估情报来源的可靠性 (A-F) 和信息可信度 (1-6)。
**Agent 化**：对每条证据自动打 Admiralty 标签，持久存储 source trust 档案，随时间 Bayesian 更新。

#### Indicators / Signposts of Change
**来源**：Grabo *Anticipating Surprise* (2002)；Pherson *Handbook*。
**定义**：对每个可能场景预先定义**可观测指标**，当指标触发时反推场景成真的概率。
**Agent 化**：机械步骤是指标扫描（cron job，规则匹配，非 LLM）；生成步骤是指标设计和权重调整。

#### Deception Detection
**来源**：Heuer *Psychology of Intelligence Analysis* 第 8 章；Bennett & Waltz *Counterdeception Principles and Applications*。
**Agent 化**：机械侧——证据一致性统计检验；生成侧——LLM 生成「如果这是欺骗，剧本是什么？」反事实叙事，再与证据比对。

### 1.2 对抗/反思类 (Contrarian Techniques)

#### Devil's Advocate
**来源**：Heuer & Pherson 2020；天主教教廷历史上的 *advocatus diaboli*。
**Agent 化**：多 Agent 辩论经典场景——Persona A 持主流判断，Persona B 被 system prompt 强制反对，第三方 judge Agent 裁决证据权重。

#### Team A / Team B
**来源**：1976 年 CIA 对苏联战略意图评估实验；Pherson 2019。
**Agent 化**：启动两个独立 Agent session（**禁止共享 scratchpad**），最终在 judge Agent 面前交叉质询。关键：两组必须真独立，不能共享 context，否则退化为单 Agent 自洽。

#### Red Team / Red Hat Analysis
**来源**：US Army TRADOC *Red Team Handbook* (2015)；Pherson 2019。
**Agent 化**：持久化「对手人格档案」（价值观、风险偏好、历史决策模式），Agent 扮演该人格做决策模拟。

#### Pre-Mortem Analysis
**来源**：Gary Klein *Performing a Project Premortem* (HBR 2007)；Kahneman *Thinking, Fast and Slow* 第 24 章。
**Agent 化**：在关键决策点触发，LLM 生成 10+ 失败剧本，人工筛选。

#### High-Impact / Low-Probability Analysis
**来源**：ODNI *Tradecraft Primer* 2009；Taleb *The Black Swan* (2007)。
**Agent 化**：自动生成 `impact × probability` 矩阵，标红 HI/LP 象限，强制人工复核。

### 1.3 想象/假设类 (Imaginative Techniques)

#### Structured Brainstorming
分「发散 → 收敛」两阶段。**Agent 化**：温度调高 (T=1.2) 做发散；温度调低 (T=0.2) 做收敛聚类。

#### Outside-In Thinking & Scenarios Analysis
**来源**：Shell 石油 1970 年代情境规划；Peter Schwartz *The Art of the Long View* (1991)。
**Agent 化**：识别 2 个关键不确定轴 → 构建 2×2 四种未来场景 → 为每种场景定义 indicator。

### 1.4 竞争性判断类 (Hypothesis Testing)

#### Analysis of Competing Hypotheses (ACH)
**来源**：Heuer *Psychology of Intelligence Analysis* (CIA 1999) 第 8 章。
**核心洞见**：不看哪个假设「证据最多」，而看「哪个假设被最少证据否定」——因为证伪强于证实（波普尔）。
**步骤**：①列所有合理假设（至少 4-5 个，包括 null hypothesis）②列所有证据 ③填矩阵 ④计算每个假设的「不一致分数」⑤诊断性最高的证据优先收集 ⑥敏感性分析。
**Agent 化**：
- 机械：矩阵构造、评分、排序（严禁 LLM 做算术）
- 生成：假设枚举、每个 cell 的 C/I/N 判定、反证检索
- Tool use：针对每条「诊断性高」证据主动查库

### 1.5 偏差缓解 (Bias Mitigation)

Heuer 的 认知偏差清单（Heuer 1999 第 2-5 章）：confirmation bias, anchoring, availability heuristic, hindsight bias, mirror imaging, vividness bias, absence of evidence, oversensitivity to consistency。

**Dual-Process (Kahneman *Thinking, Fast and Slow* 2011)**：LLM 默认是 System 1（流畅生成），必须用 SATs 结构化流程强制 System 2。这就是为什么 CoT + self-consistency + 多 Agent 辩论有效。

### 1.6 输出形态 (Output Formats)

| 格式 | 来源 | 核心 |
|---|---|---|
| BLUF / Tearline | US DoD 写作规范 | 结论前置，细节可拆 |
| Estimative Probability | Sherman Kent *Words of Estimative Probability* (1964) | almost certain (93±6%), probable (75±12%), chances about even (50±10%) |
| NATO Admiralty Code | NATO STANAG 2022 | Source (A-F) × Info (1-6) 双轴评级 |
| ICD 203 | ODNI *Intelligence Community Directive 203* (2015) | 12 项分析标准 |

---

## Part 2: 必读书单

### 奠基经典

**1. Richards Heuer — *Psychology of Intelligence Analysis* (CIA 1999)**
情报分析领域的《物种起源》。核心论点：分析失败主要不是情报不足，而是**认知局限**——人脑在处理模糊、矛盾信息时系统性犯错。提出 ACH 方法。**Agent 启发**：LLM 既继承了人类语料里的认知偏差，又有幻觉这个新偏差，Agent 必须把 Heuer 的偏差清单作为 self-critique 清单内置。

**2. Heuer & Pherson — *Structured Analytic Techniques for Intelligence Analysis* (CQ Press, 3rd ed. 2020)**
SATs 的标准工具书，50+ 种方法。**Agent 启发**：这本书就是我们 Agent 的「技能目录」，每种 SAT 对应一个 tool 或 sub-agent workflow。

**3. Sherman Kent — *Strategic Intelligence for American World Policy* (Princeton 1949) + *Words of Estimative Probability* (1964)**
奠定美国情报分析职业化。**Agent 启发**：Agent 输出必须标准化概率语词并附数字区间，不能说「可能」「也许」而无数值锚定。

**4. Robert Clark — *Intelligence Analysis: A Target-Centric Approach* (CQ Press, 6th ed. 2019)**
批判传统「情报循环」的线性假设，提出**以目标为中心**的协作模型——分析师、收集者、消费者围绕同一个目标模型协作。**Agent 启发**：我们的 Agent 不应是「输入消息 → 输出报告」的管道，而应维护一个**持久的目标模型**（Pattern of Life），所有新证据都增量更新这个模型。

**5. Mark Lowenthal — *Intelligence: From Secrets to Policy* (CQ Press, 9th ed. 2022)**
核心论点：情报分析的价值在于**服务决策**，不服务决策的正确分析等于零。**Agent 启发**：Agent 必须知道「用户现在要做什么决策」，BLUF 要回答用户的具体问题，不是展示 Agent 多博学。

**6. Randolph Pherson — *Handbook of Analytic Tools and Techniques* (Pherson Associates, 5th ed. 2019)**
SATs 的实操手册，每种方法给 checklist 和模板。**Agent 启发**：直接可翻译成 prompt template 库。

**7. Jack Davis — *Sherman Kent School Occasional Papers* (CIA 2002-2008)**
核心是「分析师与政策制定者的沟通」。

**8. UK *Butler Report* (2004) 与 *Chilcot Report* (2016)**
对伊拉克 WMD 情报失败的两份官方调查。方法论教训：①"group think" ②关键假设未检验 ③证据缺失被当作证据存在 ④原始情报与分析判断在传递过程中被平滑失真。
**Agent 启发**：
- 保留原始证据到结论的完整 chain-of-evidence，不允许中间环节"总结"后丢原文
- 单一来源的强判断必须降 confidence
- "没找到证据" ≠ "证据不存在"

**9. Philip Tetlock — *Superforecasting: The Art and Science of Prediction* (Crown 2015)**
Good Judgment Project 的 20 年研究。**Agent 启发**：Agent 必须跟踪自己的预测校准（Brier score），长期低校准的 Agent 降权；Bayesian 增量更新是 baseline。

**10. Daniel Kahneman — *Thinking, Fast and Slow* (FSG 2011)**
双系统理论、前景理论、可用性启发。**Agent 启发**：LLM 默认 System 1，必须通过结构化流程强制进入 System 2。

**11. Eliot Higgins / Bellingcat team — *We Are Bellingcat* (Bloomsbury 2021)**
OSINT 实战圣经。**Agent 启发**：OSINT 场景里机械步骤占 80%（抓取、对齐、去重），生成步骤占 20%，Agent 架构必须把机械部分下沉到 tool layer。

**12. Nate Silver — *The Signal and the Noise* (Penguin 2012)**
预测建模通俗读本。**Agent 启发**：金融/选举场景下，Agent 要能区分「新证据是信号还是噪声」——这需要持久的 baseline model。

### 关键期刊与报告
- CIA *Studies in Intelligence*（公开部分）
- *Intelligence and National Security*（Taylor & Francis）
- RAND *Assessing the Tradecraft of Intelligence Analysis* (Treverton & Gabbard 2008)
- ODNI Analytic Standards (ICD 203 / 206)
- Grabo *Anticipating Surprise: Analysis for Strategic Warning* (JMIC 2002)
- Bennett & Waltz *Counterdeception Principles and Applications* (Artech 2007)

---

## Part 3: SAT 的 Agent 化拆解表

| SAT 类别 | 机械步骤（非 LLM） | 生成步骤（LLM） | Tool Use | 多 Agent 辩论 | 持久记忆 | 人机协同 |
|---|---|---|---|---|---|---|
| ACH | 矩阵评分、排序、敏感性计算 | 假设枚举、C/I/N 判定 | 证据检索 | 可选 | 假设库、证据库 | 假设增补 |
| KAC | 假设-结论图谱对齐 | 假设生成、反证叙事 | 历史消息查询 | 否 | 假设历史 | 临界假设复核 |
| Devil's Advocate | 无 | 全部 | 反证检索 | **必需**（A/B + judge） | 否 | 裁决 |
| Team A/B | 独立 context 隔离 | 全部 | 各自独立 | **必需** | 否 | 终审 |
| Pre-Mortem | 触发条件检测 | 失败剧本生成 | 历史失败案例 | 可选 | 失败模式库 | 触发点设定 |
| Indicators | **指标扫描是主体** | 指标设计、权重调整 | 数据源轮询 | 否 | 指标-场景映射 | 指标审核 |
| Deception | 一致性统计检验 | 欺骗剧本构造 | 对手能力查询 | Red Hat Agent | 对手 profile | 告警复核 |
| Scenarios | 矩阵绘制、indicator 追踪 | 场景叙事 | 宏观数据 | 否 | 场景版本 | 维度选择 |
| QualityCheck | 来源-评级查询 | 新来源初次评级 | source DB | 否 | **source trust** | 争议评级 |
| Bias Audit | checklist 遍历 | 自评叙述 | 否 | Judge Agent | **calibration log** | 复盘 |

**关键原则**：
1. **算术归机械**：C/I/N 计数、Brier score、矩阵排序绝不让 LLM 做
2. **叙事归 LLM**：假设生成、反事实、场景故事是 LLM 强项
3. **证据检索归 Tool**：RAG / DB query / web search
4. **对抗归多 Agent**：Team A/B、Devil's Advocate 用独立 context
5. **校准归持久层**：source trust、prediction calibration、bias log 必须跨 session 持久

---

## Part 4: 情报分析 Agent 五大必备能力

### 能力 1: 证据链完整性 (Evidence Chain Integrity)
从原始数据到最终结论的每一步必须可追溯到原文，中间不允许「总结后丢原文」。**为什么**：Butler/Chilcot 报告的核心教训就是信息在层层传递中被平滑失真；LLM 幻觉会把这个问题放大十倍。实现方式：每个判断节点引用 evidence id，evidence store 不可变。

### 能力 2: 结构化反驳机制 (Structured Adversarial Reasoning)
Agent 不能只产出一个主流判断，必须内置 Devil's Advocate / Team B / ACH 的反驳流水线。**为什么**：Heuer 的核心发现是人脑（以及 LLM）默认 satisficing，找到第一个说得通的解释就停；必须用结构强制探索假设空间。实现方式：多 Agent 独立 context + judge 裁决。

### 能力 3: 校准跟踪与自我修正 (Calibration Tracking)
Agent 每次给出概率判断都登记到 calibration log，事后回看 Brier score，长期低校准的领域自动降置信。**为什么**：Tetlock 证明「预测技能是可学习、可测量的」，但只有在跟踪校准的系统里才能学习。

### 能力 4: 持久化目标模型 (Target-Centric Persistent State)
遵循 Robert Clark 的目标中心模型：Agent 维护每个分析对象（人、公司、议题）的持久模型（Pattern of Life、关系图、历史基线），新证据是**增量更新**而非**每次重算**。

### 能力 5: 概率与不确定性的一等公民化 (First-Class Uncertainty)
所有判断都带 Kent 式标准化概率语词 + 数字区间 + Admiralty 来源评级；从不输出「确定」「肯定」这类裸断言。实现方式：output schema 强制 `{judgment, kent_phrase, prob_range, source_grade, key_assumptions}`。

---

## 结论要点

1. **SATs 是 Agent 化的天然目标**：步骤即 workflow，workflow 即 Agent
2. **机械/生成必须分层**：否则幻觉污染
3. **校准与持久层是 moat**：跨周/月/年跟踪校准和 Pattern of Life 才是专业情报 Agent 的护城河
4. **Butler/Chilcot 的 20 年老教训直接适用于 LLM**：关键假设未检验、group think、证据平滑失真
5. **域无关性来自方法，不是来自数据**：ACH、KAC、Indicators 在所有领域通用，数据 adapter 替换即可
