# 情报分析 Agent 工程选型调研

> **调研时间**：2026-04-17。所有 Star/更新时间为估算（基于训练截止 2026-01 + 近期趋势），**决策前用 `gh repo view` 核实**。

---

## Part 1: 通用 Agent 框架横评

### 1. Claude Agent SDK / Claude Skills
- **GitHub**: `anthropics/claude-agent-sdk-python` / `anthropics/claude-agent-sdk-typescript`
- **核心理念**：把 Claude Code 背后那套 harness（Skills、Tool use、subagents、context 管理）开放出来
- **语言**：TypeScript + Python 双 SDK
- **本地友好**：**半友好**。理论上可以接 LM Studio 的 OpenAI 兼容端点，但官方没有一等支持，需要改 adapter
- **核心抽象**：`Tool` / `Skill`（一整个目录）/ `Subagent`（上下文隔离）/ `Hook`（PreToolUse/PostToolUse）
- **评价**：**强烈推荐作为核心**。Skill 抽象对"情报分析"这种长 SOP 场景特别合适

### 2. LangChain / LangGraph
- **GitHub**: `langchain-ai/langgraph`
- **核心理念**：LangGraph 把 Agent 建模成有状态图（StateGraph）
- **语言**：Python（TS 版本有但落后）
- **本地友好**：是。Ollama / LM Studio / vLLM 都有官方 integration
- **核心抽象**：`StateGraph` / `Checkpointer`（持久化）/ `interrupt`（human-in-the-loop）/ `Send`（并发分发）
- **评价**：**生产级首选**。StateGraph 的显式状态转移对"侦察→提取→交叉验证→报告"极其贴合

### 3. CrewAI
- **核心理念**：角色扮演式多 Agent
- **评价**：**对 Demo 很香，对工程化有坑**。角色扮演范式容易让 Agent 失控；情报分析需要**可审计的确定性流程**，CrewAI 的自由度反而是负资产

### 4. Microsoft AutoGen v0.4
- **评价**：Actor 模型适合分布式，但**对话驱动 ≠ 任务驱动**，情报分析更适合图/流水线

### 5. Letta (formerly MemGPT)
- **核心理念**：把**长期记忆当一等公民**。core memory + archival memory + recall memory
- **评价**：**值得集成作为记忆后端**，不一定作为整个 agent runtime

### 6. smolagents (HuggingFace)
- **核心理念**：让 LLM 直接写 Python 代码调工具（code-as-action）
- **评价**：理念先进，但需要沙箱，在本地优先场景是额外负担

### 7-9. AutoGPT / OpenHands / Dify, Coze, n8n
- **AutoGPT**: 历史意义大于工程意义，别碰
- **OpenHands**: EventStream + Runtime 抽象值得学
- **Dify/n8n**: 低代码平台，不适合核心但 n8n 作为数据源接入层可以用

### 10. DSPy (Stanford)
- **核心理念**："不要手写 prompt，要编译 prompt"。用 optimizer 自动优化 prompt 和 few-shot
- **评价**：**情报分析的秘密武器**。"从一段微信聊天提取人物关系"这种任务，手写 prompt 永远调不完，DSPy 能用少量标注数据自动优化

### 11. Cognee
- **评价**：想法对（KG as memory），实现还嫩

### 12. Pydantic AI
- **评价**：**如果走 Python，这是最工程化的选择**。类型安全、轻、严谨

---

## Part 2: 经典论文与实现

| 论文 | 核心机制 | 对情报分析的启发 | 实现 |
|------|---------|----------------|------|
| ReAct (Yao 2022) | Thought → Action → Observation 循环 | 每步必须有 Thought（为什么查）+ Action（查什么）+ Observation（结果），是**可审计性基础** | 所有框架内置 |
| Reflexion (Shinn 2023) | 失败后生成语言化自我反思入 episodic memory | 情报分析的假设经常要推翻，"错误日志"非常适合 | `noahshinn/reflexion`，LangGraph 原生 |
| Tree of Thoughts (Yao 2023) | 推理树 BFS/DFS + value function | 多假设并行验证合适，但 token 消耗大 | LangGraph parallel branches |
| Voyager (Wang 2023) | 成功技能存入 skill library | **这正是 Claude Skills 的学术源头**。随时间积累 SOP | `MineDojo/Voyager` |
| Toolformer (Schick 2023) | 自监督学习何时调 API | 现代 function calling 模型已内化，不需复现 | — |
| Plan-and-Solve / Least-to-Most | 先出 plan 再逐步解 | 情报调查天生适合 plan-first，人可审 | LangGraph `plan-and-execute` |
| Constitutional AI / Critic Loops (Bai 2022) | 第二个 LLM 审查第一个 | **事实核查环节必须有独立 critic** | — |

---

## Part 3: 情报/OSINT 专业开源工具

| 工具 | 功能 | 集成价值 |
|------|------|---------|
| **SpiderFoot** | 200+ OSINT 模块自动化 | **高**。可 subprocess 调用作为数据采集层 |
| **Maltego CE** | 可视化情报图谱 | 低（闭源），但**图可视化交互模式**值得学 |
| **theHarvester** | 邮箱/子域名/员工收集 | **中**。单一工具，可作为 Skill 包装 |
| **Recon-ng** | 模块化 recon 框架 | **中**。参考其 module 接口设计 |
| **OpenCTI** | STIX 2.1 威胁情报平台 | **高**。STIX/TAXII 是威胁情报事实标准，**Agent 输出应能吐 STIX** |
| **MISP** | 情报共享平台（PHP 老） | 标准重要，代码不用看 |
| **TheHive + Cortex** | SOAR，case management | **高**。Case/Observable/Analyzer 数据模型是情报 domain model 标杆 |
| **Aleph** (OCCRP) | 大规模文档/泄漏数据调查 | **高**。FollowTheMoney (FtM) 数据模型直接能用 |
| **IntelOwl** | 多分析器编排 | **中**。Analyzer/Connector/Playbook 架构清晰 |

**必学两个数据模型**：STIX 2.1（OpenCTI）、FollowTheMoney（Aleph）。Agent 的输出 schema 应该对齐其中之一。TheHive 的 Case/Observable/TTP 抽象可以直接搬进插件。

---

## Part 4: LLM-as-Analyst 前沿

- **FinGPT** (`AI4Finance-Foundation/FinGPT`): 金融领域微调，数据 pipeline 值得借鉴
- **Stanford STORM** (`stanford-oval/storm`): **强烈推荐研读**。多 agent 模拟"研究员访谈专家"生成长文，架构（Outline→Perspective-guided→Section writing）可直接迁移到情报报告生成
- **Deep Research (Google/OpenAI)**: 闭源，架构是 **planner + parallel searcher + synthesizer** 三段式。社区复现：`dzhng/deep-research`、`GPT-Researcher`
- **Perplexity / Exa / Tavily**: 搜索 API 服务。本地优先场景下需要本地 fallback（SearXNG 自建）
- **AgentBench**: 评测基准。**建立你自己的情报分析 eval set 比用 AgentBench 更重要**——这是你的机会

---

## Part 5: 三档推荐栈

### A档 · 最简（本地 Node.js + 手写 ReAct）
- **栈**: TypeScript + `ai` SDK (Vercel) + LM Studio + 手写 ReAct + SQLite + Obsidian
- **实现成本**: 1-2 周
- **适用**: **MVP 和你现在这个阶段**

### B档 · 平衡（推荐）
- **栈**: **Claude Agent SDK (TS) + LM Studio 适配层 + LangGraph.js（轻量） + Obsidian + SQLite/DuckDB + STIX 2.1 输出 schema**
- 可选 Python sidecar 跑 DSPy（抽取优化）+ Letta（长期记忆）
- **实现成本**: 1-2 月
- **适用**: **目标架构**

### C档 · 完备
- **栈**: LangGraph (Python 核心) + CrewAI + Letta + OpenCTI + TheHive + SpiderFoot + Neo4j
- **实现成本**: 3-6 月
- **适用**: 如果未来拿到 to-B 合同再做

---

## Part 6: 跨宿主可移植性

**核心原则：三层分离**

```
┌─────────────────────────────────────┐
│  Host Adapter (Obsidian/CLI/Web)    │  ← UI + 存储位置
├─────────────────────────────────────┤
│  Agent Core (纯逻辑, 零 IO 依赖)    │  ← 可移植的大脑
├─────────────────────────────────────┤
│  Source Adapter (WeChat/Slack/...)  │  ← 数据源
└─────────────────────────────────────┘
```

**具体做法**：
1. **抽独立 package**：`@yourname/intel-agent-core`，依赖只有 `zod` + LLM client 接口
2. **Host 抽象**：`HostAdapter` 接口 — `readFile / writeFile / showNotice / openUI`
3. **Source 抽象**：`DataSource` 接口返回统一 `Message { author, timestamp, content, metadata }`
4. **跑在哪**：CLI（最容易）/ Web App / VS Code / Tauri 独立 app

---

## 三条行动建议

1. **立刻做**：把现有 Obsidian 插件里的 Agent 逻辑抽到 `packages/agent-core/`。现在不做，以后迁移成本指数增长。
2. **读代码、不读框架文档**：精读 **Claude Agent SDK (TS)** + **Stanford STORM** + **TheHive 数据模型**
3. **建立自己的 eval set**：找 20 段微信聊天，手工标注"理想分析输出"。没有 eval 就没有工程化
