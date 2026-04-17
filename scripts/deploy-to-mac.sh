#!/bin/bash
set -e

# NOTE: Escaped \$HOME so the variable expands on the REMOTE Mac side,
# not on the local host (which might be Linux with /home/... vs Mac /Users/...).
MAC_PLUGIN_SUBPATH="Documents/.obsidian/plugins/wechat-obsidian-hub"

echo "Building plugin..."
npm run build

echo "Deploying to MacBook..."
ssh mac "mkdir -p \"\$HOME/$MAC_PLUGIN_SUBPATH\""
scp main.js manifest.json "mac:\$HOME/$MAC_PLUGIN_SUBPATH/"

# Copy styles.css if it exists
[ -f styles.css ] && scp styles.css "mac:\$HOME/$MAC_PLUGIN_SUBPATH/" || true

echo "Verifying deployment..."
ssh mac "ls -la \"\$HOME/$MAC_PLUGIN_SUBPATH/\""

echo ""
echo "Done! In Obsidian on Mac:"
echo "  1. Settings → Community Plugins → Enable 'WeChat Obsidian Hub'"
echo "  2. Configure the decrypted DB path in plugin settings"
echo "  3. Run command: 'Generate WeChat Briefing'"
