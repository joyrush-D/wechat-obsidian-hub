#!/bin/bash
# E2E verification: build plugin → deploy → restart Obsidian → trigger → measure
# Outputs a single number: briefing file size in bytes (0 = failure)
set -e

cd /home/joyrush/wechat-obsidian-plugin

# 1. Build
node esbuild.config.mjs production 2>/dev/null

# 2. Deploy to Mac
scp -q main.js mac:/Users/joyrush/Documents/.obsidian/plugins/wechat-obsidian-hub/

# 3. Restart Obsidian, trigger command, wait, measure
ssh mac bash <<'REMOTE'
TODAY=$(date +%Y-%m-%d)
BRIEFING="$HOME/Documents/WeChat-Briefings/${TODAY}.md"

# Remove old briefing
rm -f "$BRIEFING"

# Restart Obsidian
killall Obsidian 2>/dev/null
sleep 3
open -a Obsidian
sleep 8

# Trigger generate-briefing command
open "obsidian://run-command?id=wechat-obsidian-hub%3Agenerate-briefing"

# Wait for LM Studio to process (check every 5s, max 90s)
for i in $(seq 1 18); do
  sleep 5
  if [ -f "$BRIEFING" ]; then
    SIZE=$(wc -c < "$BRIEFING" | tr -d ' ')
    if [ "$SIZE" -gt 100 ]; then
      echo "$SIZE"
      exit 0
    fi
  fi
done

# Final check
if [ -f "$BRIEFING" ]; then
  wc -c < "$BRIEFING" | tr -d ' '
else
  echo "0"
fi
REMOTE
