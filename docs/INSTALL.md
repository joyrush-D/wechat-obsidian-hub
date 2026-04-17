# Installation Guide

## Prerequisites

1. **macOS** (Apple Silicon or Intel)
2. **Mac WeChat** (version 4.0+, latest official release)
3. **Obsidian** (1.0+)
4. **LM Studio** — [download here](https://lmstudio.ai/)
5. **Xcode Command Line Tools**:
   ```bash
   xcode-select --install
   ```
6. **Python 3.9+** (system Python works) with these packages:
   ```bash
   pip3 install --user pycryptodome zstandard
   ```

## Step 1: Install the plugin

### Option A: Manual install

```bash
# Go to your Obsidian vault's plugins folder
cd ~/Documents/{YOUR_VAULT}/.obsidian/plugins/

# Clone the plugin
git clone https://github.com/{USER}/wechat-obsidian-hub.git
cd wechat-obsidian-hub

# Install dependencies and build
npm install
npm run build
```

### Option B: Download release

Download the latest release from GitHub, unzip into `.obsidian/plugins/wechat-obsidian-hub/`.

### Enable in Obsidian

1. Open Obsidian
2. Settings → Community Plugins
3. Enable "WeChat Obsidian Hub"

## Step 2: One-time key extraction

This is the **most sensitive step**. It temporarily modifies WeChat to extract the database key, then **automatically restores the original**.

```bash
cd ~/Documents/{YOUR_VAULT}/.obsidian/plugins/wechat-obsidian-hub/scripts
sudo bash owh-extract-key.sh
```

The script walks you through:

1. **Backup**: copies `/Applications/WeChat.app` → `/Applications/.WeChat.app.owh-backup`
2. **Re-sign**: removes hardened runtime so process memory can be read
3. **Launch**: you launch WeChat and log in (normal UI)
4. **Extract**: reads 32-byte SQLCipher key from WeChat's memory
5. **Restore**: deletes modified app, puts original back
6. **Cache**: saves key to `~/all_keys.json` for future use

**After this runs once**, daily decryption uses the cached key — no sudo needed, no app modification.

### When do I need to re-run key extraction?

- ✅ First install
- ✅ After you log out and log back in to WeChat
- ❌ NOT after WeChat version updates (key persists across updates)
- ❌ NOT every day (key is stable until re-login)

## Step 3: Setup LM Studio

1. Download & install [LM Studio](https://lmstudio.ai/)
2. Download a capable model:
   - **Recommended**: `qwen3.5-35b-a3b` (fast MoE, great Chinese)
   - **Alternative**: `qwen2.5-32b-instruct`, `llama3-70b`, or similar
3. In LM Studio's **Developer** tab:
   - Load the model
   - Enable **Flash Attention** (Hardware settings) for 1.5-2× speedup
   - Set context length to at least **32K** (262K recommended)
   - Click "Start Server"
   - Confirm port 1234 is active

## Step 4: First briefing

1. In Obsidian: **Cmd+P** → type "WeChat Briefing" → Enter
2. Wait 2-5 minutes while the pipeline runs (depends on message volume and model speed)
3. Find your brief at `{vault}/WeChat-Briefings/YYYY-MM-DD-HHMM.md`

### Progress indicators

You'll see Notices at the top of Obsidian:
- `📡 读取消息中...` — decrypting latest DBs
- `🔍 阶段 1/5: 信号分流完成` — filtering noise
- `📊 抽取活跃对话 3/16: 投资讨论群` — extracting per-conversation intel
- `💾 缓存命中 5/16: ...` — skipping already-extracted conversations
- `🧩 跨对话主题聚类中...` — finding cross-group themes
- `🧠 阶段 4/5: 按 PDB 标准合成简报` — final synthesis
- `⚡ 阶段 5/5: 生成 30 秒速读版` — Tearline
- `🔍 阶段 5/5: 偏差审计` — bias check
- `OWH: 简报已生成 → WeChat-Briefings/...`

## Troubleshooting

### "OWH: 未找到解密数据库"
Run `sudo bash owh-extract-key.sh` (Step 2).

### "LM Studio 没有加载模型"
Open LM Studio, load a model, ensure server is running on port 1234.

### "输入过长，超过模型上下文容量"
Your model's context is too small. Options:
1. Load a larger-context model (262K recommended)
2. Enable Flash Attention
3. Reduce `briefingTimeRangeHours` in plugin settings (e.g. 12h instead of 24h)

### Key extraction fails with "task_for_pid failed: 5"
- Ensure WeChat is fully launched and logged in
- Re-run the codesign step inside the script (it's automated)
- Check SIP status: `csrutil status` (should say "enabled" — that's fine)

### WeChat has lost some functionality after setup
The `owh-extract-key.sh` script should have **restored** the original signature. Verify:
```bash
codesign -dvv /Applications/WeChat.app 2>&1 | grep "Authority"
# Should show: Authority=Developer ID Application: Tencent Mobile International Limited
```

If it shows `adhoc`, restore from backup:
```bash
sudo rm -rf /Applications/WeChat.app
sudo mv /Applications/.WeChat.app.owh-backup /Applications/WeChat.app
```

Or re-install WeChat from https://mac.weixin.qq.com/.

## Privacy Check

After install, verify nothing leaves your Mac:
- `~/all_keys.json` — your database keys (never transmitted)
- `~/.wechat-hub/decrypted/` — decrypted messages (local only)
- LM Studio — local inference only, no cloud API calls
- Obsidian plugin — no analytics, no telemetry

You can inspect the plugin's network activity in Obsidian's developer console (`Cmd+Option+I`).
