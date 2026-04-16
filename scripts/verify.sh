#!/usr/bin/env bash
# verify.sh — OWH pipeline state checker
#
# Checks all four phases of the WeChat Obsidian Hub pipeline and prints
# PASS/FAIL for each check, then a summary count.
#
# Usage:
#   bash scripts/verify.sh
#   ssh mac 'bash -s' < scripts/verify.sh
#
# Exit code: 0 if all checks pass, 1 if any fail.

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
DECRYPTED_DIR="${HOME}/.wechat-hub/decrypted"
VAULT_DIR="${HOME}/Documents"
LM_STUDIO="http://localhost:1234/v1"

# Plugin build output — adjust if the repo is somewhere else
PLUGIN_BUILD="${HOME}/wechat-obsidian-plugin/main.js"

# Briefing note written by the plugin
BRIEFING_GLOB="${VAULT_DIR}/**/*briefing*.md"

# ---------------------------------------------------------------------------
# Counters
# ---------------------------------------------------------------------------
PASS=0
FAIL=0
TOTAL=0

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
_pass() {
    local label="$1"
    printf "  [PASS] %s\n" "$label"
    (( PASS++ )) || true
    (( TOTAL++ )) || true
}

_fail() {
    local label="$1"
    local detail="${2:-}"
    if [[ -n "$detail" ]]; then
        printf "  [FAIL] %s — %s\n" "$label" "$detail"
    else
        printf "  [FAIL] %s\n" "$label"
    fi
    (( FAIL++ )) || true
    (( TOTAL++ )) || true
}

_section() {
    printf "\n--- %s ---\n" "$1"
}

# ---------------------------------------------------------------------------
# Phase 1: Decrypted databases
# ---------------------------------------------------------------------------
_section "Phase 1: Decrypted databases"

CONTACT_DB="${DECRYPTED_DIR}/contact/contact.db"

if [[ -f "$CONTACT_DB" ]]; then
    _pass "contact.db exists (${CONTACT_DB})"
else
    _fail "contact.db exists" "${CONTACT_DB} not found"
fi

# Check that contact.db is a readable SQLite file
if [[ -f "$CONTACT_DB" ]]; then
    SQLITE_HDR=$(head -c 16 "$CONTACT_DB" 2>/dev/null | tr -d '\0' || true)
    if [[ "$SQLITE_HDR" == "SQLite format 3" ]]; then
        _pass "contact.db has valid SQLite header"
    else
        _fail "contact.db has valid SQLite header" "file does not appear to be plain SQLite"
    fi
else
    _fail "contact.db has valid SQLite header" "file missing"
fi

# Check for Msg_ tables (message tables) in message_0.db
MESSAGE_DB="${DECRYPTED_DIR}/message/message_0.db"
if [[ -f "$MESSAGE_DB" ]]; then
    _pass "message_0.db exists"
    if command -v sqlite3 &>/dev/null; then
        MSG_TABLES=$(sqlite3 "$MESSAGE_DB" \
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name LIKE 'Msg_%';" \
            2>/dev/null || echo "0")
        if [[ "$MSG_TABLES" -gt 0 ]]; then
            _pass "Msg_ tables found in message_0.db (${MSG_TABLES} table(s))"
        else
            # Broaden: any table with 'msg' case-insensitively
            MSG_TABLES_ALT=$(sqlite3 "$MESSAGE_DB" \
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND LOWER(name) LIKE '%msg%';" \
                2>/dev/null || echo "0")
            if [[ "$MSG_TABLES_ALT" -gt 0 ]]; then
                _pass "Message-like tables found in message_0.db (${MSG_TABLES_ALT} table(s))"
            else
                _fail "Msg_ tables found in message_0.db" "no Msg_ or msg-like tables (decryption may have failed)"
            fi
        fi
    else
        _fail "Msg_ tables found in message_0.db" "sqlite3 CLI not installed — cannot inspect tables"
    fi
else
    _fail "message_0.db exists" "${MESSAGE_DB} not found"
    _fail "Msg_ tables found in message_0.db" "file missing"
fi

# Check media_0.db
MEDIA_DB="${DECRYPTED_DIR}/message/media_0.db"
if [[ -f "$MEDIA_DB" ]]; then
    _pass "media_0.db exists"
else
    _fail "media_0.db exists" "${MEDIA_DB} not found"
fi

# Check decrypt_meta.json
META_FILE="${DECRYPTED_DIR}/decrypt_meta.json"
if [[ -f "$META_FILE" ]]; then
    _pass "decrypt_meta.json exists"
else
    _fail "decrypt_meta.json exists" "${META_FILE} not found (run scripts/decrypt.py first)"
fi

# ---------------------------------------------------------------------------
# Phase 2: Plugin build
# ---------------------------------------------------------------------------
_section "Phase 2: Plugin build"

if [[ -f "$PLUGIN_BUILD" ]]; then
    BUILD_SIZE=$(wc -c < "$PLUGIN_BUILD" 2>/dev/null | tr -d ' ')
    if [[ "$BUILD_SIZE" -gt 1024 ]]; then
        _pass "main.js exists and is non-trivial (${BUILD_SIZE} bytes)"
    else
        _fail "main.js has non-trivial size" "file is only ${BUILD_SIZE} bytes — build may be broken"
    fi
else
    # Try relative to this script's location
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    REPO_BUILD="${SCRIPT_DIR}/../main.js"
    if [[ -f "$REPO_BUILD" ]]; then
        BUILD_SIZE=$(wc -c < "$REPO_BUILD" 2>/dev/null | tr -d ' ')
        _pass "main.js exists in repo root (${BUILD_SIZE} bytes)"
    else
        _fail "main.js exists" "not found at ${PLUGIN_BUILD} or repo root"
    fi
fi

# ---------------------------------------------------------------------------
# Phase 3: LM Studio API reachable
# ---------------------------------------------------------------------------
_section "Phase 3: LM Studio API"

if command -v curl &>/dev/null; then
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
        --max-time 5 \
        "${LM_STUDIO}/models" 2>/dev/null || echo "000")
    if [[ "$HTTP_CODE" == "200" ]]; then
        _pass "LM Studio API reachable (${LM_STUDIO}/models → HTTP ${HTTP_CODE})"
    elif [[ "$HTTP_CODE" == "000" ]]; then
        _fail "LM Studio API reachable" "connection refused or timed out — is LM Studio running?"
    else
        _fail "LM Studio API reachable" "unexpected HTTP ${HTTP_CODE} from ${LM_STUDIO}/models"
    fi
else
    _fail "LM Studio API reachable" "curl not found — cannot check"
fi

# ---------------------------------------------------------------------------
# Phase 4: Obsidian vault and briefing note
# ---------------------------------------------------------------------------
_section "Phase 4: Obsidian vault and briefing note"

if [[ -d "$VAULT_DIR" ]]; then
    _pass "Obsidian vault directory exists (${VAULT_DIR})"
else
    _fail "Obsidian vault directory exists" "${VAULT_DIR} not found"
fi

# Look for any briefing markdown file (glob, using find for portability)
BRIEFING_FOUND=$(find "$VAULT_DIR" -maxdepth 5 -iname "*briefing*.md" 2>/dev/null | head -1 || true)
if [[ -n "$BRIEFING_FOUND" ]]; then
    _pass "Briefing note found (${BRIEFING_FOUND})"
else
    _fail "Briefing note found" "no *briefing*.md found under ${VAULT_DIR}"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
printf "\n%s\n" "$(printf '=%.0s' {1..60})"
printf "OWH pipeline check: %d/%d passed\n" "$PASS" "$TOTAL"
if [[ "$FAIL" -gt 0 ]]; then
    printf "%d check(s) FAILED\n" "$FAIL"
fi
printf "%s\n" "$(printf '=%.0s' {1..60})"

if [[ "$FAIL" -gt 0 ]]; then
    exit 1
fi
exit 0
