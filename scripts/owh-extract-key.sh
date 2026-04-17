#!/bin/bash
# OWH One-Time Key Extraction (with auto-restore)
#
# Workflow:
#   1. Backup original WeChat.app (with Tencent signature)
#   2. Re-sign WeChat (remove hardened runtime so we can read its memory)
#   3. Tell user to launch WeChat & login
#   4. Wait for WeChat to be running
#   5. Extract SQLCipher key from process memory
#   6. Restore original WeChat from backup (full functionality back)
#   7. Cache extracted key for future use
#
# After this runs once, the user has the key forever (unless they re-login).
# Daily decryption uses the cached key — no sudo or codesign needed.
#
# Usage: sudo bash owh-extract-key.sh

set -e

WECHAT_APP="/Applications/WeChat.app"
BACKUP="/Applications/.WeChat.app.owh-backup"
KEYS_OUT="$HOME/all_keys.json"
EXTRACTOR="$HOME/wechat-decrypt/find_all_keys_macos"
EXTRACTOR_SRC="$HOME/wechat-decrypt/find_all_keys_macos.c"

# Color helpers
red()   { printf "\033[31m%s\033[0m\n" "$1"; }
green() { printf "\033[32m%s\033[0m\n" "$1"; }
yellow(){ printf "\033[33m%s\033[0m\n" "$1"; }
blue()  { printf "\033[34m%s\033[0m\n" "$1"; }

abort() {
    red "❌ $1"
    exit 1
}

# Sudo check
if [ "$EUID" -ne 0 ]; then
    abort "需要 root 权限。请用：sudo bash $0"
fi

# Real user (when run with sudo)
REAL_USER="${SUDO_USER:-$USER}"
REAL_HOME=$(eval echo ~"$REAL_USER")

blue "============================================================"
blue "  OWH 微信密钥一次性提取（自动备份+恢复签名）"
blue "============================================================"
echo ""

# Sanity checks
[ -d "$WECHAT_APP" ] || abort "未找到 $WECHAT_APP"

# Compile extractor if missing
if [ ! -x "$EXTRACTOR" ]; then
    yellow "📦 密钥提取工具未编译，正在准备..."
    if [ ! -d "$REAL_HOME/wechat-decrypt" ]; then
        sudo -u "$REAL_USER" git clone https://github.com/ylytdeng/wechat-decrypt "$REAL_HOME/wechat-decrypt" || \
            abort "克隆 wechat-decrypt 失败。请检查网络。"
    fi
    EXTRACTOR_SRC="$REAL_HOME/wechat-decrypt/find_all_keys_macos.c"
    EXTRACTOR="$REAL_HOME/wechat-decrypt/find_all_keys_macos"
    [ -f "$EXTRACTOR_SRC" ] || abort "未找到 $EXTRACTOR_SRC"
    cc -O2 -o "$EXTRACTOR" "$EXTRACTOR_SRC" -framework Foundation || \
        abort "编译失败。请确认已安装 Xcode Command Line Tools。"
    chown "$REAL_USER" "$EXTRACTOR"
    green "✅ 工具已编译"
fi

# Step 1: Backup
if [ -d "$BACKUP" ]; then
    yellow "⚠️  备份已存在：$BACKUP"
    yellow "   （可能上次提取未完成；如果你信任此备份，将使用它恢复）"
    read -p "   重新备份？[y/N] " REBACKUP
    if [[ "$REBACKUP" =~ ^[yY]$ ]]; then
        rm -rf "$BACKUP"
    fi
fi

if [ ! -d "$BACKUP" ]; then
    blue "📦 步骤 1/6: 备份原版 WeChat.app（保留 Tencent 签名）..."
    cp -R "$WECHAT_APP" "$BACKUP" || abort "备份失败"
    green "✅ 已备份到 $BACKUP"
fi
echo ""

# Step 2: Quit WeChat
blue "🛑 步骤 2/6: 退出微信..."
killall WeChat 2>/dev/null || true
sleep 2
green "✅ 微信已退出"
echo ""

# Step 3: Re-sign (remove hardened runtime)
blue "✍️  步骤 3/6: 重签名（去掉加固壳，仅为提取密钥）..."
codesign --force --deep --sign - --options 0x0 "$WECHAT_APP/Contents/MacOS/WeChat" 2>&1 | grep -v "^$" || true
codesign --force --deep --sign - "$WECHAT_APP" 2>&1 | grep -v "^$" || true
SIG=$(codesign -dvv "$WECHAT_APP/Contents/MacOS/WeChat" 2>&1 | grep "Signature" || echo "Signature=adhoc")
echo "   $SIG"
green "✅ 已重签名为 ad-hoc"
echo ""

# Step 4: Launch and wait for user login
blue "🚀 步骤 4/6: 启动微信，等待你登录..."
sudo -u "$REAL_USER" open -a "$WECHAT_APP"
echo ""
yellow "⏳ 请在微信窗口完成登录（如果已登录，等待 5 秒钟即可）"
echo "   登录完成后回到这里按 Enter 继续..."
read -p "" ENTER_KEY
echo ""

# Verify WeChat is running
if ! pgrep -x WeChat > /dev/null; then
    yellow "⚠️  未检测到微信进程。再等 5 秒..."
    sleep 5
    pgrep -x WeChat > /dev/null || abort "微信未运行，请手动启动后重新运行此脚本"
fi
green "✅ 微信已运行"
echo ""

# Step 5: Extract key
blue "🔑 步骤 5/6: 从微信进程内存提取密钥..."
cd "$(dirname "$EXTRACTOR")"
"$EXTRACTOR" 2>&1 | tail -30 || abort "密钥提取失败"

# all_keys.json is saved to CWD by the tool
GENERATED_KEYS="$(dirname "$EXTRACTOR")/all_keys.json"
if [ -f "$GENERATED_KEYS" ]; then
    cp "$GENERATED_KEYS" "$REAL_HOME/all_keys.json"
    chown "$REAL_USER" "$REAL_HOME/all_keys.json"
    KEY_COUNT=$(python3 -c "import json; print(len(json.load(open('$REAL_HOME/all_keys.json'))))" 2>/dev/null || echo "0")
    green "✅ 已提取 $KEY_COUNT 个数据库密钥 → $REAL_HOME/all_keys.json"
else
    abort "未生成 all_keys.json"
fi
echo ""

# Step 6: Restore original
blue "♻️  步骤 6/6: 恢复原版微信（恢复 Tencent 签名 + 完整功能）..."
killall WeChat 2>/dev/null || true
sleep 2
rm -rf "$WECHAT_APP" || abort "无法删除当前微信"
mv "$BACKUP" "$WECHAT_APP" || abort "无法恢复备份"

NEW_SIG=$(codesign -dvv "$WECHAT_APP/Contents/MacOS/WeChat" 2>&1 | grep "Authority=Developer" | head -1 || echo "")
if [[ "$NEW_SIG" == *"Tencent"* ]]; then
    green "✅ 已恢复 Tencent 原版签名"
else
    yellow "⚠️  签名验证可疑：$NEW_SIG"
fi
echo ""

blue "============================================================"
green "🎉 全部完成！"
blue "============================================================"
echo ""
echo "下一步："
echo "  1. 启动微信（已恢复完整功能）："
echo "       open -a WeChat"
echo "  2. 在 Obsidian 里运行命令: 'Generate WeChat Briefing'"
echo "     插件会自动用密钥解密最新数据"
echo ""
echo "📌 重要提示："
echo "  - 密钥已缓存在 $REAL_HOME/all_keys.json"
echo "  - 微信升级后无需重新提取（密钥不变）"
echo "  - 仅当你重新登录微信账号时才需重新跑此脚本"
echo ""
