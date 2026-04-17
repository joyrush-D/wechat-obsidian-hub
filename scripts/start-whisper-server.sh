#!/bin/bash
#
# Start a local whisper.cpp server for voice transcription.
# Prerequisites on Mac (Apple Silicon):
#   brew install whisper-cpp ffmpeg
#   curl -L https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin \
#        -o ~/.wechat-hub/models/ggml-large-v3-turbo-q5_0.bin
#
# Usage:
#   bash scripts/start-whisper-server.sh
#
# The OWH plugin talks to http://localhost:8081 by default.
# Override port/model via env:
#   WHISPER_PORT=8081 WHISPER_MODEL=/path/to/ggml-*.bin bash scripts/start-whisper-server.sh
#

set -euo pipefail

MODEL="${WHISPER_MODEL:-$HOME/.wechat-hub/models/ggml-large-v3-turbo-q5_0.bin}"
PORT="${WHISPER_PORT:-8081}"
HOST="${WHISPER_HOST:-127.0.0.1}"
LANG="${WHISPER_LANG:-zh}"
THREADS="${WHISPER_THREADS:-8}"

if [[ ! -f "$MODEL" ]]; then
  echo "ERROR: model not found at $MODEL" >&2
  echo "Download it with:" >&2
  echo "  mkdir -p $(dirname "$MODEL")" >&2
  echo "  curl -L https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin -o $MODEL" >&2
  exit 1
fi

# Prefer the server binary from `brew install whisper-cpp`. Falls back to
# whisper-server if named differently in your install.
SERVER_BIN=""
for candidate in whisper-server whisper-cli-server whisper-cpp-server; do
  if command -v "$candidate" >/dev/null 2>&1; then
    SERVER_BIN="$candidate"
    break
  fi
done

if [[ -z "$SERVER_BIN" ]]; then
  echo "ERROR: no whisper-*-server binary found on PATH" >&2
  echo "Install with: brew install whisper-cpp" >&2
  exit 1
fi

echo "Starting $SERVER_BIN on $HOST:$PORT (model: $MODEL, lang: $LANG)"
exec "$SERVER_BIN" \
  -m "$MODEL" \
  -l "$LANG" \
  --host "$HOST" \
  --port "$PORT" \
  --threads "$THREADS" \
  --flash-attn
