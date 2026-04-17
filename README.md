# WeChat Obsidian Hub (OWH)

> Turn your WeChat chat history into a daily intelligence brief — entirely on your Mac, with local AI.

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-macOS-black.svg)](#)
[![Obsidian](https://img.shields.io/badge/Obsidian-1.0+-purple.svg)](https://obsidian.md/)

## What is this?

**OWH** is an Obsidian plugin that reads your Mac WeChat databases and uses a **local LLM** (via LM Studio) to generate a **professional intelligence-style daily briefing** of your conversations — using methodologies from CIA, NSA, UK JIC, and Israeli Aman.

You'll see at a glance:
- 🎯 **30-second summary** (NSA Tearline format) — top 3 things you must know
- ⚡ **Direct asks** — who @-mentioned you, what needs your reply
- 📰 **Today's news** — cross-conversation topics, not just per-group dumps
- 🧠 **Key judgments** with confidence levels (Sherman Kent estimative language)
- 🤔 **Devil's Advocate** — alternative interpretations (Israeli "Tenth Man")
- 🔍 **What to Watch** — signals to monitor tomorrow
- ⚠️ **Bias audit** — Heuer's 18-point cognitive bias check
- 🔗 **Resources** — curated links by topic, broken-link filtering

## Why?

If you have many WeChat groups and contacts, you can easily miss critical information buried in noise. Traditional approaches:
- ❌ Reading 1000+ messages daily — exhausting
- ❌ Cloud AI summarization — privacy concerns
- ❌ Per-group summary — misses cross-conversation patterns

This plugin solves all three: **local AI**, **intelligence-grade synthesis**, **per-topic clustering**.

## Architecture

```
Mac WeChat (encrypted SQLCipher DBs)
         │
         ▼  (one-time codesign trick + key extraction)
  ~/all_keys.json (cached forever)
         │
         ▼  (daily decryption with cached key)
  ~/.wechat-hub/decrypted/
         │
         ▼  (Obsidian plugin: 5-stage intel pipeline)
  ┌──────────────────────────────┐
  │ 1. TRIAGE  — filter noise     │
  │ 2. EXTRACT — per-conv intel   │
  │ 3. CLUSTER — cross-conv themes│
  │ 4. SYNTHESIZE — PDB brief     │
  │ 5. ENRICH  — Tearline + Audit │
  └──────────────────────────────┘
         │
         ▼
  ~/Documents/{vault}/WeChat-Briefings/2026-04-17.md
```

## Requirements

- **macOS** (tested on macOS 26+ with Apple Silicon)
- **Mac WeChat 4.0+** (the new version with WCDB compression)
- **Obsidian 1.0+**
- **LM Studio** with a chat model loaded (Qwen 3.5 35B recommended)
- **Python 3.9+** (system Python works) with `pycryptodome` and `zstandard`
- **Xcode Command Line Tools** (for compiling key extractor)

## Installation

### 1. Install the plugin

```bash
# Clone into your Obsidian vault's plugins folder
cd ~/Documents/{your-vault}/.obsidian/plugins/
git clone https://github.com/{your-username}/wechat-obsidian-hub.git
cd wechat-obsidian-hub
npm install
npm run build
```

Then in Obsidian: **Settings → Community Plugins → enable "WeChat Obsidian Hub"**.

### 2. One-time key extraction

OWH needs to extract your WeChat database encryption key **once**. This involves a temporary code-signing trick that's automatically reversed:

```bash
cd ~/Documents/{your-vault}/.obsidian/plugins/wechat-obsidian-hub/scripts
sudo bash owh-extract-key.sh
```

The script will:
1. Backup `/Applications/WeChat.app` (with original Tencent signature)
2. Re-sign WeChat to remove "hardened runtime" (so key extraction works)
3. Ask you to launch & login to WeChat
4. Extract the SQLCipher key from process memory
5. **Restore the original WeChat app** (full functionality back)
6. Cache key to `~/all_keys.json`

After this runs once, you have the key forever (unless you re-login to WeChat).

### 3. Configure LM Studio

- Install [LM Studio](https://lmstudio.ai/)
- Download a Chinese-capable model (Qwen 3.5 35B A3B or similar)
- Start the local server on default port 1234

### 4. Generate your first brief

In Obsidian: **Cmd+P → "Generate WeChat Briefing"**

Your daily intelligence brief appears in `WeChat-Briefings/YYYY-MM-DD-HHMM.md`.

## Intelligence Methodology Inspirations

This plugin draws from public intelligence community standards:

| Method | Source | Use in OWH |
|--------|--------|-----------|
| **PDB format** | CIA President's Daily Brief | Output structure |
| **ICD 203** | US ODNI Analytic Standards | 9-point analytic discipline |
| **Sherman Kent estimative language** | CIA | Confidence labels (高度可能/可能/不太可能) |
| **NATO Admiralty Code** | STANAG 2511 | Source × info credibility (rendered as plain Chinese) |
| **Tearline** | NSA SIGINT reports | 30-second TL;DR header |
| **Tenth Man** | Israeli Aman (post-Yom Kippur) | Forced devil's advocate |
| **JIC consensus** | UK Joint Intelligence Committee | Conservative estimative wording |
| **Heuer 18-bias check** | Psychology of Intelligence Analysis | Post-brief audit section |
| **F3EAD loop** | US SOF | Action-orientation |

## Privacy

- ✅ All data stays on your Mac
- ✅ LM Studio runs locally, no data leaves your machine
- ✅ Decrypted databases stored locally at `~/.wechat-hub/decrypted/`
- ❌ NO cloud APIs, NO telemetry, NO analytics
- ⚠️ The codesign step temporarily modifies `/Applications/WeChat.app` then restores it

## Configuration

In Obsidian Settings → "WeChat Obsidian Hub":

| Setting | Default | Description |
|---------|---------|-------------|
| 解密后的数据库目录 | `~/.wechat-hub/decrypted` | Where decrypted DBs live |
| AI 服务地址 | `http://localhost:1234/v1` | LM Studio endpoint |
| 模型名称 | (empty) | Empty = use whichever model is loaded |
| 简报存放文件夹 | `WeChat-Briefings` | Vault folder for briefs |
| 时间范围 | 24 小时 | How many hours of messages to include |
| 解密模式 | 自动 | Auto-refresh DB before each brief |

## Roadmap

### Implemented (v1.0)
- ✅ 5-stage intel pipeline
- ✅ PDB-format brief with BLUF
- ✅ Source trust accumulation
- ✅ Tearline (30-sec TL;DR)
- ✅ Tenth Man (devil's advocate)
- ✅ Bias audit
- ✅ Extraction persistence (skip re-extracting unchanged convos)
- ✅ Auto key extraction with signature restore

### Planned (see [docs/intel-roadmap.md](docs/superpowers/specs/2026-04-17-intel-roadmap.md))
- 📅 Weekly rollup (cross-day patterns)
- 👥 Pattern of Life (per-person daily profile)
- 🌉 Network analysis (bridge nodes across groups)
- 📊 Delta analysis (yesterday vs today)
- 🎯 Multi-LLM voting (JIC consensus)
- 🔍 ACH (Analysis of Competing Hypotheses)
- ⚠️ Indicators & Warnings dashboard

## License

MIT

## Acknowledgments

- [LC044/WeChatMsg](https://github.com/LC044/WeChatMsg) — Windows reference implementation
- [ylytdeng/wechat-decrypt](https://github.com/ylytdeng/wechat-decrypt) — Mac key extractor
- [sql.js](https://github.com/sql-js/sql.js) — SQLite in WASM
- [fzstd](https://github.com/101arrowz/fzstd) — Pure-JS zstd decompression
- Richards Heuer, Sherman Kent, Randolph Pherson — for IC analytic tradecraft

## Disclaimer

This tool is for **personal use** with **your own** WeChat data. Do not use it to access other people's WeChat databases. The codesign step modifies an installed application — back up if you're concerned. The author is not responsible for any data loss or account issues.
