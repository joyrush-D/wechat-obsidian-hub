#!/bin/bash
set -e

VAULT_DIR="/Users/joyrush/Documents"
PLUGIN_DIR="$VAULT_DIR/.obsidian/plugins/wechat-obsidian-hub"

echo "Building plugin..."
npm run build

echo "Deploying to MacBook..."
ssh mac "mkdir -p '$PLUGIN_DIR'"
scp main.js manifest.json mac:"$PLUGIN_DIR/"

# Copy styles.css if it exists
[ -f styles.css ] && scp styles.css mac:"$PLUGIN_DIR/" || true

echo "Verifying deployment..."
ssh mac "ls -la '$PLUGIN_DIR/'"

echo ""
echo "Done! In Obsidian on Mac:"
echo "  1. Settings → Community Plugins → Enable 'WeChat Obsidian Hub'"
echo "  2. Configure the decrypted DB path in plugin settings"
echo "  3. Run command: 'Generate WeChat Briefing'"
