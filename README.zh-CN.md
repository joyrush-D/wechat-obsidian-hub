# 微信 Obsidian Hub (OWH)

> 把你的微信聊天记录变成每日情报简报——**完全在你的 Mac 上**运行，用本地 AI 模型。

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-macOS-black.svg)](#)
[![Obsidian](https://img.shields.io/badge/Obsidian-1.0+-purple.svg)](https://obsidian.md/)
[![GitHub](https://img.shields.io/badge/GitHub-joyrush--D%2Fwechat--obsidian--hub-181717.svg)](https://github.com/joyrush-D/wechat-obsidian-hub)

**English**: [README.md](README.md)

## 它是什么？

**OWH** 是一个 Obsidian 插件，**完整读取** Mac 版微信的数据库，用 **LM Studio 本地大模型**生成一份**专业情报级**的每日简报——借鉴了 CIA、NSA、英国 JIC、以色列 Aman 等情报机构的方法论。所有数据都在你的 Mac 上，**不走云端**。

简报一眼就能看到：

- 🎯 **30 秒速读**（NSA Tearline 格式）—— 今日必须知道的 3-5 件事
- 📍 **直接 @ 你**（机械扫描，每次都新鲜）—— 谁需要你回复
- 📰 **今日要闻**（严格主题聚类，不把不相关的硬凑）
- 🧠 **关键判断**（Sherman Kent 7 档置信度：`高度可能` / `可能` / `不太可能`）
- 🤔 **反方观点**（以色列"第十人原则"）
- 👥 **重要联系人今日动态**（跨群汇总）
- 🔍 **明日关注信号**
- 🔗 **资源链接**（按主题分组，自动过滤"版本不支持"假链接）
- ⚠️ **偏差审计**（Heuer 18 项认知偏差检查，可选）
- 🛡️ **操纵风险评估**（Reflexive Control，可选）
- 📤 **脱敏分享版**（可一键发给团队，去除姓名和群名）

另外三个**按需调用**命令：

- 📅 **生成周报**（Weekly Rollup）—— 过去 7 天的持续话题和活跃人物
- 🎯 **专题深挖**（Topic Brief）—— 输入关键词，跨时间拉通分析
- 🧮 **ACH 分析**（Heuer 竞争性假设矩阵）—— 对有争议的话题做矩阵化分析

## 为什么要做？

如果你有 30+ 微信群、每天上千条消息：

- ❌ 全部读完 —— 累死了
- ❌ 用云端 AI 总结 —— 隐私风险
- ❌ 每个群单独总结 —— 看不到跨群联系、@ 你的消息被淹没

OWH 解决所有这些：**本地 AI** + **情报级合成** + **主体识别**。

## 系统架构

```
Mac 微信（SQLCipher 加密）
         │
         ▼  (一次性重签名 + 密钥提取)
  ~/all_keys.json   （一次提取，永久有效，除非换微信号）
         │
         ▼  (每次生成简报时用缓存密钥解密)
  ~/.wechat-hub/decrypted/
         │
         ▼  （Obsidian 插件管道）
  ┌──────────────────────────────────┐
  │ 1. TRIAGE   — 程序化信号分流     │
  │ 2. SPLIT    — 按对话分组         │
  │ 3. SYNTHESIZE — 单次 LLM 调用    │  ← 看全量原文，不做中间压缩
  │ 4. ENRICH   — Tearline +         │
  │              Pattern of Life     │
  │              （可选模块）          │
  └──────────────────────────────────┘
         │
         ▼
  ~/Documents/{vault}/WeChat-Briefings/YYYY-MM-DD-HHMM.md

同时累积到持久化层：
  ~/.wechat-hub/extractions/YYYY-MM-DD.json
         │
         ├──→ 周报（过去 7 天）
         ├──→ 专题简报（关键词 × N 天）
         └──→ ACH 分析（竞争性假设）
```

**为什么选"单次合成"而不是多阶段？**
早期版本做 `抽取 → 聚类 → 合成`（3 次 LLM 调用）。每个阶段都会丢信息、可能编造联系。用 100K+ context 的模型（比如 `qwen3.5-35b-a3b`）时，**把原始消息直接喂给一次 LLM** 出来的简报更准，幻觉更少。

## 系统要求

- **macOS**（测试过 macOS 26+，Apple Silicon）
- **Mac 微信 4.0+**（使用 WCDB + zstd 压缩的新版本）
- **Obsidian 1.0+**
- **LM Studio** + 加载一个大上下文模型
  - **推荐**：`qwen3.5-35b-a3b`，262K 上下文，开启 Flash Attention
- **Python 3.9+**（系统 Python 即可）+ `pycryptodome` 和 `zstandard`
- **Xcode Command Line Tools**（编译密钥提取工具）

## 安装步骤

### 1. 安装插件

```bash
# 进入你的 Obsidian vault 的 plugins 目录
cd ~/Documents/{你的-vault}/.obsidian/plugins/

# 克隆仓库
git clone https://github.com/joyrush-D/wechat-obsidian-hub.git
cd wechat-obsidian-hub

# 安装依赖并构建
npm install
npm run build
```

然后在 Obsidian 里：**设置 → 第三方插件 → 启用 "WeChat Obsidian Hub"**。

### 2. 一次性提取密钥

OWH 需要微信数据库的加密密钥（SQLCipher key）**一次**。脚本会自动备份微信原版签名，提取完后自动恢复，**完全不影响微信的正常使用**：

```bash
cd ~/Documents/{你的-vault}/.obsidian/plugins/wechat-obsidian-hub/scripts
sudo bash owh-extract-key.sh
```

脚本会：

1. 备份 `/Applications/WeChat.app`（保留原版 Tencent 签名）
2. 重签名微信以去除"加固壳"（只为提取内存）
3. 请你启动并登录微信
4. 从微信进程内存提取 SQLCipher 密钥
5. **自动恢复原版微信**（功能完全不受影响）
6. 把密钥缓存到 `~/all_keys.json`

**一次运行后密钥永久有效**（除非你登出微信再重新登录）。

### 3. 配置 LM Studio

- 安装 [LM Studio](https://lmstudio.ai/)
- 下载中文能力强的对话模型（推荐 `qwen3.5-35b-a3b`）
- 上下文长度至少 **64K**，推荐 **262K**
- 硬件设置里开启 **Flash Attention**（加速 1.5-2 倍）
- 点 "Start Server"（默认端口 1234）

### 4. 生成第一份简报

在 Obsidian 里：**Cmd+P → "Generate WeChat Briefing"**

输出路径：`WeChat-Briefings/YYYY-MM-DD-HHMM.md`

## 可用命令

按 `Cmd+P` 访问：

| 命令 | 作用 |
|------|------|
| `Generate WeChat Briefing` | 生成今日情报简报（单次 LLM 调用） |
| `Generate Weekly Rollup` | 周报（过去 7 天，识别持续话题和活跃人物） |
| `Generate Topic Brief` | 专题深挖（输入关键词，自动扩展到同一人的所有别名） |
| `Run ACH Analysis` | 对争议话题做 Heuer 竞争性假设矩阵 |
| `Decrypt WeChat Databases` | 手动刷新解密（生成简报时会自动触发） |
| `Test WeChat DB Connection` | 验证解密数据库可读 |

## 情报学方法论

借鉴公开的情报界专业标准：

| 方法 | 来源 | OWH 里怎么用 |
|-----|------|---------------|
| **PDB 格式** | CIA 总统每日简报 | 整体结构 |
| **ICD 203** | 美国 ODNI 分析标准 | 9 项分析纪律 |
| **Sherman Kent 估测性词汇** | CIA | 置信度标签（`几乎肯定`/`高度可能`/`可能`/`不太可能`） |
| **NATO Admiralty Code** | STANAG 2511 | 信源 × 内容可信度评级（中文化为"核心信源·已确认"等） |
| **Tearline** | NSA SIGINT 报告 | 30 秒速读头部 |
| **第十人（Tenth Man）** | 以色列 Aman（赎罪日战争后） | 强制反方观点 |
| **Pattern of Life** | NSA 目标追踪 | 重要联系人每日动态 |
| **JIC 共识** | 英国联合情报委员会 | 谨慎估测用词 |
| **Heuer 18 偏差** | 《Psychology of Intelligence Analysis》 | 可选的简报自查 |
| **ACH** | Heuer / CIA | 竞争性假设矩阵命令 |
| **Reflexive Control** | 苏联/俄罗斯反制信息操纵原则 | 标注潜在被投放信息（保守模式） |
| **Bellingcat OSINT** | 调查新闻 | 每个判断附"如何独立验证" |
| **Target-Centric** | Mercyhurst（Robert Clark） | Topic Brief 专题深挖命令 |
| **F3EAD / OODA** | 美军特种作战 / Boyd | 行动导向、渐进式生成 |

## 隐私保障

- ✅ 所有数据留在你的 Mac 上
- ✅ LM Studio 本地推理，不访问云端 API
- ✅ 解密数据库存于 `~/.wechat-hub/decrypted/`
- ✅ 抽取缓存存于 `~/.wechat-hub/extractions/`
- ❌ 无云端 API、无 telemetry、无埋点
- ⚠️ 密钥提取过程中会临时改签 `/Applications/WeChat.app`，然后自动恢复

## 配置项

Obsidian 设置 → "WeChat Obsidian Hub"：

| 选项 | 默认值 | 说明 |
|------|--------|------|
| 解密后的数据库目录 | `~/.wechat-hub/decrypted` | 解密后数据库存放路径 |
| AI 服务地址 | `http://localhost:1234/v1` | LM Studio 端点 |
| 模型名称 | （空） | 空 = 使用 LM Studio 当前加载的模型 |
| 简报存放文件夹 | `WeChat-Briefings` | Vault 里的简报文件夹 |
| 时间范围 | 24 小时 | 当 = 24 时，实际是"从今天 00:00 起" |
| 解密模式 | 自动 | 每次生成简报前自动刷新 |

## 当前还没做的

坦白说：

- ❌ **语音转写** —— 语音消息只显示 `[语音 N 秒]`，未转文字（Whisper 集成计划中）
- ❌ **图片 OCR** —— 图片只显示 `[图片]`（多模态模型计划中）
- ❌ **视频处理** —— 仅占位符
- ⚠️ **合并转发的内部消息**（type 49 sub 19）—— 只提取外层标题，没解析嵌套
- ⚠️ **三战多维分析**（舆论/心理/法律）—— 占位符
- ⚠️ **F3EAD 行动跨日跟踪** —— todo 提取但未跨日跟进

完整路线图见 [docs/ROADMAP.md](docs/ROADMAP.md)（共 15+ 个待实现的情报 skill）。

## 许可证

Apache 2.0 —— 见 [LICENSE](LICENSE)

## 致谢

- [LC044/WeChatMsg](https://github.com/LC044/WeChatMsg) —— Windows 参考实现
- [ylytdeng/wechat-decrypt](https://github.com/ylytdeng/wechat-decrypt) —— Mac 密钥提取工具
- [sql.js](https://github.com/sql-js/sql.js) —— WASM SQLite
- [fzstd](https://github.com/101arrowz/fzstd) —— 纯 JS zstd 解压
- Richards Heuer、Sherman Kent、Randolph Pherson —— 情报分析方法论

## 免责声明

本工具**仅用于个人**使用自己的微信数据。请勿用于访问他人微信数据库。密钥提取步骤会临时修改已安装的应用——如果你担心，先备份。作者不对任何数据丢失或账号问题负责。
