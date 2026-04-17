# Intelligence Analysis Agent — 产品愿景与架构

> **Draft 2026-04-17**，基于三份调研综合。定位、架构、路线图。

---

## 1. 产品本质

**专业情报分析 Agent**，不是"微信聊天摘要工具"。

- **方法论内核 = 域无关**：ACH、KAC、Devil's Advocate、Pattern of Life、Timeline Reconstruction、Bias Audit 在微信、金融、OSINT、威胁情报、新闻调查里**公式完全一样**，只是喂进去的数据不同
- **微信 = 首个数据源 adapter**（beachhead，不是终点）
- **Obsidian = 首个宿主 adapter**（beachhead，不是终点）
- **LM Studio = 首个 LLM 后端 adapter**

名字建议（v1.0 重命名）：
- Intelligence Analysis Agent (IAA)
- Personal Intel
- Analyst Agent
- Saga（情报 saga）
- 暂定内部代号 **IAA**

---

## 2. 五大核心能力（产品护城河）

1. **证据链完整性 (Evidence Chain Integrity)** —— 每个判断可溯源到原文 evidence id，LLM 不能"总结后丢原文"。Butler/Chilcot 教训。
2. **结构化反驳 (Structured Adversarial Reasoning)** —— 主流判断必须过 Devil's Advocate / Team B / ACH 反驳 pipeline；Heuer satisficing。
3. **校准跟踪 (Calibration Tracking)** —— 每个概率判断登记 Brier score，长期低校准的领域自动降置信。Tetlock。
4. **目标中心持久模型 (Target-Centric Persistent State)** —— Pattern of Life 是**增量更新**，不是每次重算。Robert Clark。
5. **不确定性一等公民 (First-Class Uncertainty)** —— Kent 概率语词 + 数字区间 + Admiralty 评级，schema 强制。ICD 203。

**这五条是产品与"LLM 摘要玩具"的根本分界**。

---

## 3. 架构：四层 + 四算子

### 3.1 四层架构

```
┌──────────────────────────────────────────────────┐
│  Host Adapter    Obsidian / CLI / Web / Tauri    │  ← UI + 文件系统
├──────────────────────────────────────────────────┤
│  Output Layer    Tearline / BLUF / Full Report   │  ← 三档输出
├──────────────────────────────────────────────────┤
│  Agent Core      [Collector | Analyzer |         │  ← 四类算子 + 记忆
│                   Critic | Reporter]             │
│                  Memory: source trust /          │
│                          calibration /           │
│                          target profiles         │
├──────────────────────────────────────────────────┤
│  Source Adapter  WeChat / Slack / GDELT /        │  ← 统一 Message 接口
│                  Reddit / SEC EDGAR / ...        │
└──────────────────────────────────────────────────┘
```

### 3.2 四类算子（Collector/Analyzer/Critic/Reporter）

学自 TheHive Cortex 的 Analyzer/Responder 二分，但情报分析需要更细：

| 类 | 职责 | 示例 |
|----|------|------|
| **Collector** | fetch / normalize / grade | WeChatSource、RedditSource、EDGARSource |
| **Analyzer** | 假设生成、矩阵构造、时间线、Pattern of Life | ACH、KAC、TimelineReconstructor、PatternOfLife |
| **Critic** | 反驳、偏差审查、Pre-Mortem、Red Team | DevilsAdvocate、BiasAuditor、PreMortem、RedHat |
| **Reporter** | 按受众生成 Tearline / BLUF / Full | TearlineReporter、PDBReporter、STIXExporter |

算子都是**可组合函数**，输入/输出都是统一的 Finding/Evidence/Assumption 对象。

### 3.3 统一对象模型（STIX-inspired 六元组）

```typescript
Actor      : 人 / 组织 / 账号（OWH 的 Identity 就是这个）
Object     : 资产 / 文档 / 消息
Event      : 会话 / 告警 / 交易 / 新闻
Relationship: Actor→Actor、Actor→Object、Event→Event
Indicator  : 可观测信号 + 阈值（Pattern of Life 的原子）
Report     : 分析产出（含 Finding[]、Assumption[]、Evidence[]）
```

微信里的"人-消息-群-事件-关系"完全可以映射到这六元组，未来跨域几乎零成本。

### 3.4 Finding 的结构（ICD 203 compliant）

```typescript
interface Finding {
  judgment: string;                 // 人话结论
  kent_phrase: KentPhrase;          // 'almost certain' | 'probable' | ...
  prob_range: [number, number];     // e.g. [75, 87]
  source_grade: AdmiraltyCode;      // 'A1' | 'B2' | ...
  evidence_refs: EvidenceId[];      // 不可变引用
  key_assumptions: Assumption[];    // 每个假设带 solid/caveat/unsupported
  dissenting_view?: Finding;        // Devil's Advocate 的反方
  confidence_source: 'raw' | 'calibrated';  // 是否经过 Brier 校准
}
```

---

## 4. 路线图（v0.3 — v1.0+）

| 版本 | 主题 | 产出 |
|------|------|------|
| **v0.3.0** | 主体一致性基本功 + 多模态（语音+图片） | IdentityResolver.groupAliases + 别名索引输出；whisper.cpp + RapidOCR + VLM |
| **v0.4.0** | **Package 重构 + 对象模型** | 抽 `packages/agent-core/`；Actor/Object/Event/Relationship/Indicator/Report 六元组；Finding schema |
| **v0.5.0** | **Evidence Store + Provenance** | 不可变证据存储（SQLite/DuckDB）；每个 Finding 带 evidence_refs；Host/Source adapter 接口 |
| **v0.6.0** | **SAT 算子库（第一批）** | ACH、KAC、BiasAudit、TimelineReconstructor 作为独立算子；Kent+Admiralty schema 强制 |
| **v0.7.0** | **持久目标模型 + 校准层** | Pattern of Life 增量模型；Brier calibration log；Indicator/Signpost 持久追踪 |
| **v0.8.0** | **多 Agent 辩论（Critic Loop）** | Devil's Advocate、Team A/B、Red Hat 独立 context subagent；Judge 裁决 |
| **v0.9.0** | **第二个 Source Adapter（SOCMINT）** | GDELT 或 Reddit 接入；验证跨域架构；80% 代码复用 |
| **v1.0.0** | **产品重命名 + Eval Set + 首次公开发布** | 20 段手工标注的 eval；STIX 2.1 导出；跨 Host（CLI/Web）支持 |
| v1.1+ | OSINT / CTI / 金融逐域扩展 | 每个域只需实现 SourceAdapter + 1-2 个 domain-specific Analyzer |

### 立刻行动的 3 条（来自调研报告 2）

1. **抽 agent-core package**（v0.4 目标，现在不抽以后迁移成本指数增长）
2. **精读三个项目源码**：Claude Agent SDK (TS)、Stanford STORM、TheHive 数据模型
3. **建 eval set**：20 段微信对话 + 手工理想输出标注（这是未来跨域最值钱资产）

---

## 5. 技术栈（B 档"平衡"方案）

- **TS 核心**：Obsidian + Vercel `ai` SDK + LM Studio adapter + LangGraph.js（轻量）
- **Python sidecar**（可选）：DSPy（抽取优化）+ Letta（长期记忆）
- **存储**：SQLite / DuckDB（evidence store、calibration log、target profiles）
- **输出标准**：STIX 2.1（CTI 时启用）+ FollowTheMoney（DD 时启用）
- **LLM**：LM Studio（本地，Qwen3.5-35b）+ whisper.cpp + Qwen2.5-VL-7B

---

## 6. 域优先级（微信之后）

基于调研报告 3 的评分：

1. **SOCMINT**（19 分）—— GDELT / Reddit，与微信同构
2. **OSINT 调查**（17 分）—— 方法论最成熟，Bellingcat 路线
3. **CTI**（16 分）—— To B 变现，STIX/ATT&CK 适配
4. **CI**（16 分）—— 产品化最轻
5. **金融**（15 分）—— 红海，只做细分
6. **DD / 合规**（14 分）—— 数据成本高
7. **Policy**（13 分）—— 采购周期长

**路径**：微信 → SOCMINT → OSINT → CTI，前三步 80% 代码复用。

---

## 7. 风险与护城河

### 风险
- **LLM 幻觉污染证据链** → 缓解：强制 evidence_refs + 不可变 store
- **方法论堆砌不等于产品** → 缓解：eval set 测每个算子的实际价值
- **跨域推广过早** → 缓解：先把微信做到"专业分析员愿意用"，再谈第二个域
- **TypeScript Agent 生态落后** → 缓解：核心 TS，可选 Python sidecar

### 护城河
- **本地 LLM + 专业方法论 + 身份消解**（Obsidian 生态零个做到）
- **eval set**（20 段手标 → 200 段 → 2000 段，跨域最值钱资产）
- **持久 target 模型 + 校准日志**（跨时间积累的历史是新用户复制不了的）

---

## 8. 这份 VISION 的后续

- 每次重大决策回到这份文档更新，不写新 doc
- 路线图只标方向，具体任务分到 `CHANGELOG.md` / `ROADMAP.md`
- 研究笔记都放 `docs/research/YYYY-MM-DD-*.md`
