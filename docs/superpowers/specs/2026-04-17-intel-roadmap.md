# OWH Intelligence Skills Roadmap

> 后续基于专业情报分析方法论的扩展功能。每个条目可以做成独立的 skill 或插件命令。

## Status of v1.0 (已实现)

基于 ICD 203 / PDB / NATO Admiralty Code 的简报生成已完成，包含：

- ✅ **Intelligence Cycle 5 阶段管道** (Triage → Entity → Cluster → Prioritize → Synthesize)
- ✅ **NATO Admiralty Code (STANAG 2511)** — 每条消息打 [B2] 等可信度标签
- ✅ **Sherman Kent 估测性词汇** — 强制 7 档置信度（"高度可能"等）
- ✅ **Source Trust System** — 持续累积发言人信任度，跨会话持久化
- ✅ **PDB-Style 输出** — BLUF / What's New / What to Watch
- ✅ **ICD 203 标准** — 9 项分析纪律

## v2.0 Roadmap — 情报分析 Skills 扩展

### 优先级 P1（立即可做，价值高）

#### 1. ACH (Analysis of Competing Hypotheses) Skill
**Heuer 体系核心技术**。对群里有争议的话题做矩阵化对比。

**触发：** 用户选中一段对话或一个话题
**输出：**
```
| 假设 | 证据 1 | 证据 2 | 证据 3 |
|------|-------|-------|-------|
| H1: ... | ✓支持 | ✗反驳 | ?中性 |
| H2: ... | ✗反驳 | ✓支持 | ✓支持 |
```
**用例：** "M9 制造成本到底多少" → 列出多个估值假设 + 各方证据

#### 2. Pre-Mortem Skill
假设某个决策已经失败，倒推风险因素。

**触发：** 用户标记某条消息为"潜在决策"
**输出：** 失败场景 + 早期信号 + 缓解措施

#### 3. Devil's Advocate Skill
对每个判断自动生成反方观点。

**触发：** 简报生成后自动追加"另一种解读"段落
**输出：** 同样信息的反向解释 + 哪些证据反驳主流判断

### 优先级 P2（中长期价值）

#### 4. Network Analysis Skill
社交网络分析——谁是社群中的桥接节点 / 信息中转站。

**输入：** 多个群聊的发言人重叠数据
**输出：**
- **桥接节点 (Bridge nodes)**: 跨群活跃的关键人物
- **意见领袖**: 被频繁 @ 或转发的人
- **回声室检测**: 互相印证但与外界孤立的群

**算法：** Betweenness centrality, Eigenvector centrality

#### 5. Pattern of Life Skill
重要联系人的行为模式画像。

**输出（每个高信任度联系人）：**
- 活跃时段分布（早/中/晚/深夜）
- 话题偏好热力图
- 互动频率趋势（上升/稳定/下降）
- 话题切换速度
- 回复延迟模式

**用途：** 识别异常 — "X 一直早睡，今天突然凌晨发消息" → warning indicator

#### 6. Cross-Impact Matrix Skill
多个话题之间的相互影响。

**输入：** 一周/一月的话题集合
**输出：** 矩阵图 — 哪些话题同时上升、哪些此消彼长

#### 7. Indicators & Warnings Dashboard
预定义"什么信号意味着什么"，持续监控。

**配置示例：**
```yaml
indicators:
  - name: "大客户流失风险"
    triggers:
      - keyword: ["不合作", "终止", "再考虑"]
      - source_grade: ">=B"
      - mentions_count: ">=3"
    action: "生成 Warning 简报，置顶"

  - name: "重大行业新闻"
    triggers:
      - link_count: ">=5 across groups"
      - same_url_or_topic: true
```

### 优先级 P3（长期愿景）

#### 8. OSINT Integration Skill
集成 Bellingcat 调查方法论。

- 群里出现的链接 → 自动 OSINT 扩展（域名、注册信息、相似账户）
- 图片 → 反向搜索（如果有图片处理能力）
- 关键事件 → 跨多源验证

#### 9. Estimative Probability Calibration
持续校准用户的预测准确度。

**机制：**
- 简报中的"高度可能"判断 → 跟踪是否成真
- 一周/一月后回顾 → 计算分析员（AI + 用户）的校准曲线
- 调整未来用词的精确度

**目标：** Brier Score 越来越低

#### 10. PESTLE / DIME / SWOT 多框架分析
用户可选择不同分析框架处理同一信息。

**触发：** "用 PESTLE 分析最近的科技讨论"
**输出：** 政治/经济/社会/技术/法律/环境 6 维结构化

#### 11. Multi-Perspective Synthesis (Team A / Team B)
关键议题让 LLM 扮演两个独立分析小组，得出对立结论后辩论。

**用途：** 大决策前，避免单一视角偏见

#### 12. Cognitive Bias Audit Skill
对生成的简报自动审查 18 项偏差。

**输出：** "本简报可能存在以下偏差：
- ⚠️ Confirmation Bias: 3 个判断都倾向同一方向
- ⚠️ Availability Heuristic: 过度引用最近 2 小时消息..."

#### 13. Knowledge Graph Auto-Build
从历史简报自动构建实体关系图谱。

- 人物-人物关系
- 人物-话题关联
- 话题演化时间线

**Obsidian 集成：** 利用 Obsidian 自身的 graph view + [[backlinks]]

#### 14. Tearline-Style Sharing Skill
把简报分级降密，用于不同分享场景。

- **Top Secret 版**: 完整原始引用 + 信源
- **可分享版**: 去除信源，去除直接引用
- **公开版**: 只保留趋势和判断

#### 15. Sentiment & Topic Drift Detection
- 群内整体情绪走势（正面/负面/中性）
- 话题漂移检测（X 群最近从技术讨论变成了八卦）

## 技术债务 / 改进方向

### 数据层
- [ ] 增量解密：只解密自上次以来变化的数据库页
- [ ] 数据库索引：按 wxid 建立反向索引，加速跨群查询
- [ ] 媒体处理：图片 OCR / 语音 ASR 集成（Whisper.cpp）

### AI 层
- [ ] 流式输出：LLM 响应实时写入笔记（不等全部完成）
- [ ] 模型路由：长 prompt 用大模型，短 prompt 用小模型
- [ ] 成本优化：用便宜模型做 entity extraction，贵模型做 synthesis
- [ ] 缓存层：相同对话内容不重复抽取

### UX
- [ ] 历史简报对比视图（今天 vs 昨天）
- [ ] 关键人物档案视图（点击 [[张三]] 看历史动态）
- [ ] 简报模板可定制（不同领导关心不同维度）

## 设计原则（继承 v1.0）

1. **本地优先**：所有 AI 在本地（LM Studio），数据不出 Mac
2. **领导视角**：每个功能问"决策者会问什么"
3. **可追溯**：每个判断必须能下钻到原始消息
4. **可校准**：累积数据 → 改进未来判断质量
5. **不偏见**：内置偏差审查机制
