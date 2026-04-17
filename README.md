# WeChat Obsidian Hub (OWH)

> Turn your WeChat chat history into a daily intelligence brief — entirely on your Mac, with local AI.

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-macOS-black.svg)](#)
[![Obsidian](https://img.shields.io/badge/Obsidian-1.0+-purple.svg)](https://obsidian.md/)
[![Repo](https://img.shields.io/badge/GitHub-joyrush--D%2Fwechat--obsidian--hub-181717.svg)](https://github.com/joyrush-D/wechat-obsidian-hub)

## What is this?

**OWH** turns your noisy WeChat chat history into a **professional intelligence-style daily brief** — using methodologies from CIA, NSA, UK JIC, Israeli Aman, and Russian doctrine. Everything runs **on your Mac with a local LLM** (LM Studio). Nothing leaves your machine.

You'll see at a glance:
- 🎯 **30-second BLUF** (NSA Tearline format) — top 3 things you must know
- 📍 **Direct @ mentions** — raw scan of who needs your reply (never cached, always complete)
- 📰 **Today's news** — strict topic clustering (no fake "supply chain" buckets)
- 🧠 **Key judgments** with Sherman Kent confidence levels (`高度可能` / `可能` / `不太可能`)
- 🤔 **Devil's Advocate** — alternative interpretations (Israeli "Tenth Man")
- 👥 **Pattern of Life** — important contacts' daily profile across all groups
- 🔍 **What to Watch** — signals to monitor tomorrow
- 🔗 **Resources** — curated links by topic, broken-link filtering
- ⚠️ **Bias audit** — Heuer's 18-point check (opt-in)
- 🛡️ **Reflexive Control** — flag potentially planted info (opt-in)
- 📤 **Shareable Tearline** — desensitized version for team sharing (opt-in)

Plus three on-demand retrospective commands:
- 📅 **Weekly Rollup** — last 7 days, persistent topics, active people, trend evolution
- 🎯 **Topic Brief** — Target-Centric cross-time deep-dive on a keyword
- 🧮 **ACH Analysis** — Heuer's competing-hypothesis matrix for controversial topics

## Why?

Got 30+ groups and 1000+ daily messages? Traditional options all fail:
- ❌ Reading everything — exhausting
- ❌ Cloud AI summarization — privacy nightmare for personal/business chats
- ❌ Per-group summary — misses cross-conversation patterns + buries @-mentions

OWH fixes all three with **local-only AI** + **intelligence-grade synthesis**.

## Architecture

```
Mac WeChat (encrypted SQLCipher DBs)
         │
         ▼  (one-time codesign trick + key extraction)
  ~/all_keys.json   (cached forever, until WeChat re-login)
         │
         ▼  (daily refresh with cached key)
  ~/.wechat-hub/decrypted/
         │
         ▼  (Obsidian plugin pipeline)
  ┌──────────────────────────────────┐
  │ 1. TRIAGE   — filter noise       │  (mechanical, no LLM)
  │ 2. SPLIT    — group by convo     │  (mechanical, no LLM)
  │ 3. SYNTHESIZE — full PDB brief   │  (1 LLM call on RAW messages)
  │ 4. ENRICH   — Tearline +         │  (parallel LLM calls)
  │              Pattern of Life     │
  │              [optional modules]  │
  └──────────────────────────────────┘
         │
         ▼
  ~/Documents/{vault}/WeChat-Briefings/YYYY-MM-DD-HHMM.md

Plus persistent extraction store enables:
  ~/.wechat-hub/extractions/YYYY-MM-DD.json
         │
         ├──→ Weekly Rollup (last 7 days)
         ├──→ Topic Brief (keyword × N days)
         └──→ ACH Analysis (competing hypotheses)
```

**Why "Direct Synthesis" instead of multi-stage extraction?**
Earlier versions did `extract → cluster → synthesize` (3 LLM calls). Each stage lost information and could fabricate connections. With a 100K+ context model (qwen3.5-35b-a3b on M-series), feeding **raw messages directly to one LLM call** produces more grounded, less hallucinated briefings.

## Requirements

- **macOS** (tested on macOS 26+ with Apple Silicon)
- **Mac WeChat 4.0+** (the version with WCDB+zstd compression)
- **Obsidian 1.0+**
- **LM Studio** with a large-context model loaded
  - **Recommended**: `qwen3.5-35b-a3b` with 262K context + Flash Attention
- **Python 3.9+** (system Python works) with `pycryptodome` and `zstandard`
- **Xcode Command Line Tools** (for compiling key extractor)

## Installation

### 1. Install the plugin

```bash
# Clone into your Obsidian vault's plugins folder
cd ~/Documents/{your-vault}/.obsidian/plugins/
git clone https://github.com/joyrush-D/wechat-obsidian-hub.git
cd wechat-obsidian-hub
npm install
npm run build
```

Then in Obsidian: **Settings → Community Plugins → enable "WeChat Obsidian Hub"**.

### 2. One-time key extraction

OWH needs your WeChat database encryption key **once**. The script automatically backs up & restores WeChat's original signature, so the app keeps full functionality:

```bash
cd ~/Documents/{your-vault}/.obsidian/plugins/wechat-obsidian-hub/scripts
sudo bash owh-extract-key.sh
```

The script:
1. Backs up `/Applications/WeChat.app` (preserves Tencent signature)
2. Re-signs WeChat to remove Hardened Runtime (so we can read its memory)
3. Asks you to launch & log in to WeChat
4. Extracts the SQLCipher key from process memory
5. **Restores the original WeChat app** (full functionality back)
6. Caches keys to `~/all_keys.json`

After this runs once, you have the keys forever (re-run only if you log out and back in to WeChat).

### 3. Configure LM Studio

- Install [LM Studio](https://lmstudio.ai/)
- Download `qwen3.5-35b-a3b` or any Chinese-capable chat model
- Set context length to **at least 64K**, ideally **262K**
- Enable **Flash Attention** in Hardware Settings (1.5-2× speedup)
- Click "Start Server" (default port 1234)

### 4. Generate your first brief

In Obsidian: **Cmd+P → "Generate WeChat Briefing"**

Output: `WeChat-Briefings/YYYY-MM-DD-HHMM.md`

## Available Commands

All accessible via `Cmd+P`:

| Command | What it does |
|---------|-------------|
| `Generate WeChat Briefing` | Today's full intelligence brief (single LLM pass) |
| `Generate Weekly Rollup` | Last 7 days of accumulated extractions, trend analysis |
| `Generate Topic Brief` | Cross-time deep-dive on a keyword (Target-Centric) |
| `Run ACH Analysis` | Competing hypothesis matrix for a controversy |
| `Decrypt WeChat Databases` | Manual refresh (auto-runs on briefing generation) |
| `Test WeChat DB Connection` | Verify decrypted DBs are readable |

## Intelligence Methodology

This plugin draws from public IC tradecraft standards:

| Method | Source | Use in OWH |
|--------|--------|-----------|
| **PDB format** | CIA President's Daily Brief | Output structure |
| **ICD 203** | US ODNI Analytic Standards | 9-point analytic discipline |
| **Sherman Kent estimative language** | CIA | Confidence labels (`几乎肯定`/`高度可能`/`可能`/`不太可能`) |
| **NATO Admiralty Code** | STANAG 2511 | Source × info credibility (rendered as plain Chinese) |
| **Tearline** | NSA SIGINT reports | 30-second TL;DR header |
| **Tenth Man** | Israeli Aman (post-Yom Kippur) | Forced devil's advocate |
| **Pattern of Life** | NSA target tracking | Per-important-person daily profile |
| **JIC consensus** | UK Joint Intelligence Committee | Conservative estimative wording |
| **Heuer 18-bias check** | Psychology of Intelligence Analysis | Optional post-brief audit |
| **ACH** | Heuer / CIA | Competing hypotheses matrix command |
| **Reflexive Control** | Soviet/Russian doctrine | Flag potentially planted info (conservative) |
| **Bellingcat OSINT** | Investigative journalism | Each judgment has "how to verify" |
| **Target-Centric** | Mercyhurst (Robert Clark) | Topic Brief command |
| **F3EAD / OODA** | US SOF / Boyd | Action-orientation, progressive generation |

## Privacy

- ✅ All data stays on your Mac
- ✅ LM Studio runs locally — no data leaves your machine
- ✅ Decrypted databases stored at `~/.wechat-hub/decrypted/` (your home only)
- ✅ Extraction cache at `~/.wechat-hub/extractions/`
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
| 时间范围 | 24 小时 | When = 24, treats as "since today midnight" |
| 解密模式 | 自动 | Auto-refresh DBs before each brief |

## What's NOT yet implemented

Honest current status:

- ❌ **Voice transcription** — voice messages show as `[voice Ns]`, not transcribed (Whisper integration planned)
- ❌ **Image OCR** — images show as `[image]` placeholder (multimodal LLM planned)
- ❌ **Video processing** — placeholder only
- ⚠️ **Forwarded chat history (type 49 sub 19)** — only title extracted, internal nesting not parsed
- ⚠️ **Three Warfares (multi-dimensional analysis)** — placeholder
- ⚠️ **F3EAD action tracking (cross-day TODO state)** — todos extracted but not tracked

See `docs/superpowers/specs/2026-04-17-intel-roadmap.md` for full roadmap (15+ planned skills).

## License

Apache 2.0 — see [LICENSE](LICENSE)

## Acknowledgments

- [LC044/WeChatMsg](https://github.com/LC044/WeChatMsg) — Windows reference implementation
- [ylytdeng/wechat-decrypt](https://github.com/ylytdeng/wechat-decrypt) — Mac key extractor
- [sql.js](https://github.com/sql-js/sql.js) — SQLite in WASM
- [fzstd](https://github.com/101arrowz/fzstd) — Pure-JS zstd decompression
- Richards Heuer, Sherman Kent, Randolph Pherson — for IC analytic tradecraft

## Disclaimer

This tool is for **personal use** with **your own** WeChat data. Do not use it to access other people's WeChat databases. The codesign step modifies an installed application — back up if you're concerned. The author is not responsible for any data loss or account issues.
