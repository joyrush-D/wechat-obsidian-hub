# 跨领域情报分析方法论与工具生态调研

> **调研时间**：2026-04-17。为域无关的情报分析 Agent 提供跨域迁移的架构依据。

---

## Part A：七大领域的典型工作流与 SAT 对应

### 1. 金融市场情报 — 卖方分析员的一天

| 时间 | 动作 | SAT 对应 |
|------|------|---------|
| 6:30 | 预市简报（Bloomberg First Word、Reuters）| Indicators & Signposts、Source Triage |
| 7:30 | Morning Meeting，2 分钟 pitch，风险经理挑战 | Devil's Advocacy、BLUF |
| 9:30 | 开盘后盘中监控，异常成交 | Anomaly Detection、Change Analysis |
| 盘中 | Earnings call，Q&A 细读管理层措辞 | Linguistic Analysis、ACH |
| 16:00-18:00 | Initiation report / Update note | Key Assumptions Check、Scenario Analysis |

**核心工具**：OpenBB、FinGPT、Qlib、BloombergGPT（闭源）、Bridgewater "Principles"
**核心洞察**：估值 = 假设 × 数据。分析员的真正价值在假设层，这正是 KAC + ACH 的金融版。

### 2. 威胁情报（CTI）— SOC 分析员工作流

**告警接入 → 富化 → 关联 → 研判 → 处置 → 共享**

1. 接入：SIEM (Splunk/Elastic) 告警进 SOAR
2. 富化：IOC 查 VirusTotal / AlienVault OTX / MISP —— Source Triage
3. 关联：映射到 MITRE ATT&CK —— Pattern Matching
4. 研判：Diamond Model 四顶点 —— ACH（APT28 还是模仿者？）
5. 时间线：沿 Cyber Kill Chain 7 阶段对齐
6. 输出：STIX 2.1 bundle，TAXII 2.1 推送

**开源工具**：MITRE ATT&CK、OpenCTI、MISP、TheHive + Cortex、STIX/TAXII
**商业产品**：CrowdStrike Falcon、Recorded Future、Mandiant

### 3. 调查新闻 / OSINT — ICIJ 式协作

**数据获取 → 清洗 → 实体抽取 → 跨源交叉 → 时间线 → 成稿**

Bellingcat 4 原则：**Origin（来源）/ Date / Location / Content**（Source Grading + Triangulation）

**开源工具**：Aleph (OCCRP)、Datashare (ICIJ)、Maltego CE、SpiderFoot、theHarvester、Shodan/Censys、Bellingcat Toolkit

### 4. 尽职调查 / M&A / 合规

**流程**：身份 → UBO 穿透 → 制裁/PEP 匹配 → 负面新闻 → 关联方图谱 → Red flag 评分

**工具**：OpenCorporates、Sayari Graph、PACER/CourtListener、OpenSanctions、TRACE International
**本质**：Structured Checklist SAT

### 5. 竞争情报（CI）

**SCIP 五步法**：Plan → Collect → Analyze → Disseminate → Feedback
**框架**：Porter 五力、PESTLE、SWOT、War Games（Red Team Analysis）
**商业**：Crayon、Klue、Kompyte/Contify
开源对标较弱——**LLM Agent 机会窗口**

### 6. 公共政策情报

- 智库报告：Brookings / RAND / CSIS / CFR
- 美国 CRS（Congressional Research Service）— "no policy prescription" 原则
- 方法：Delphi、Structured Expert Elicitation、Foresight

### 7. 社交媒体情报（SOCMINT）

**核心数据集**：GDELT（全球事件）、ACLED（武装冲突）、Common Crawl
**要素**：情感分析、话题建模、网络中心性、bot 检测、影响力溯源
**工作流**：关键词/用户监控 → 抓取 → 清洗去重 → 实体/话题抽取 → 网络图 → 叙事追踪

---

## Part B：跨域不变量（Agent 核心模块）

**所有七个领域共享以下基本功** —— 这是 Agent 的核心层：

| 模块 | 跨域表现 |
|---|---|
| **Source Grading** | 金融（卖方/买方/官方）、CTI（TLP + Admiralty）、新闻（Bellingcat 4 原则）、DD（primary vs. secondary）一致 |
| **Triangulation** | 一条信息 ≥2 个独立来源才进入 finding |
| **ACH** | 金融做多空、CTI 做归因、新闻做指控、DD 做风险判定全都适用 |
| **Key Assumptions Check** | 所有判断必须 surface 其隐含假设 |
| **Timeline Reconstruction** | Kill Chain、交易序列、事件链、UBO 变更史本质同构 |
| **Entity Resolution** | 人/组织/资产/标识符的去重合并（OWH 的 IdentityResolver 就是这个抽象） |
| **Bias Audit** | confirmation / anchoring / availability / mirror imaging — Heuer 列的 8 种 |
| **BLUF / Tearline** | 军情、金融 morning note、CTI report、调查稿的 lede 段都是最关键结论前置 |
| **Confidence Language** | ICD-203 标准（almost certain / likely / even chance / unlikely） |
| **Red Team / Devil's Advocate** | 强制反方是所有严肃情报产品的质控环节 |

这 10 个模块就是 Agent 的**域无关内核**。

---

## Part C：领域专属扩展点（适配器接口）

| 域 | 必须独立适配的要素 |
|---|---|
| 金融 | 估值模型（DCF/可比/SOTP）、因子暴露、财报日历、10-K/10-Q/8-K 解析 |
| CTI | IOC 类型学、ATT&CK TTP 映射、Kill Chain 对齐、STIX 序列化 |
| OSINT | 地理定位、时间定位、图像取证（EXIF、反向搜索）、Wayback 档案 |
| DD | UBO 穿透、制裁/PEP 匹配、Red flag checklist、管辖权风险 |
| CI | 竞品矩阵、定价追踪、招聘信号、专利/商标新增 |
| Policy | Stakeholder mapping、法规文本 diff、立法周期识别 |
| SOCMINT | 叙事追踪、bot/协同行为检测、影响力网络中心性、多语言情感 |

每个扩展点应实现为**统一接口下的插件**（类比 Cortex Analyzer 或 Maltego Transform）。

---

## Part D：微信之后的域优先级

评分（1-5 分，合计越高越优先）：

| 域 | 技术可行 | 数据可得 | 市场空间 | 架构适配 | **合计** | 备注 |
|---|---|---|---|---|---|---|
| **SOCMINT** | 5 | 5 | 4 | 5 | **19** | **强烈建议第二站**，与微信同构 |
| **OSINT 调查** | 4 | 5 | 4 | 4 | **17** | 方法论最成熟 |
| **CTI** | 4 | 4 | 5 | 3 | **16** | To B 付费意愿最强 |
| **CI** | 4 | 4 | 3 | 5 | **16** | 产品化最轻 |
| **金融** | 3 | 3 | 5 | 4 | **15** | 竞争红海 |
| **DD / 合规** | 3 | 3 | 5 | 3 | **14** | 数据成本高 |
| **Policy** | 3 | 4 | 2 | 4 | **13** | 采购周期长 |

**推荐路径**：微信（人际/叙事）→ SOCMINT（公开社交网络）→ OSINT 调查 → CTI（转 B 端变现）。前三步复用 80% 代码。

---

## Part E：对 Agent 架构的 5 条启发

1. **SourceAdapter 抽象层必须提前建好**。每个来源（微信 DB / GDELT / Shodan / SEC EDGAR）实现统一接口 `fetch() → normalize() → grade()`，返回带 provenance 和置信度的标准化记录。

2. **把 SAT 做成可组合的"分析算子"，而不是 prompt 模板**。ACH / KAC / Devil's Advocate / Timeline / Red Team 每个都是独立函数，输入 = findings 集合 + 假设集合，输出 = 带置信度的判断。参考 Cortex 的 Analyzer/Responder 二分：`Collector / Analyzer / Critic / Reporter` 四类算子。

3. **采用 STIX-like 的统一对象模型**。所有领域的实体最终都能映射到 `{Actor, Object, Event, Relationship, Indicator, Report}` 六元组。微信里的"人-消息-群-事件-关系"完全可以 STIX 化。

4. **Confidence 和 Provenance 必须是一等公民**。每个 finding 携带 `(confidence_level, evidence_refs[], assumptions[], dissenting_view?)`。ICD-203 的 7 级置信度语言应直接内建到输出模板。

5. **输出层分离 Tearline / BLUF / Full Report 三档**。同一份分析结果按受众切三个 view，而不是重新生成——这要求内部数据结构足够结构化。

---

**方法论引用**：Heuer《Psychology of Intelligence Analysis》、US ICD-203、MITRE ATT&CK、Bellingcat Toolkit、SCIP Code of Ethics、Lockheed Martin Cyber Kill Chain 白皮书、Diamond Model（Caltagirone et al. 2013）。
