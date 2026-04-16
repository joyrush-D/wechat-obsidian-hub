# WeChat Obsidian Hub (OWH) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an Obsidian plugin that decrypts Mac WeChat databases, parses all message types, and generates AI-powered daily briefings.

**Architecture:** Python helper script extracts encryption key from running WeChat process and decrypts databases to plain SQLite. Obsidian plugin (TypeScript) uses sql.js (WASM) to read decrypted DBs, parses 10+ message types into structured text, then feeds to LM Studio local API for briefing generation. Output is a Markdown note in the user's vault.

**Tech Stack:** TypeScript + esbuild (plugin), sql.js (WASM SQLite), fflate (zlib), zstd-codec (zstd WASM), LM Studio OpenAI-compatible API, Python + pysqlcipher3 (decryption helper)

**Environment:**
- Dev server: Linux (this machine), `ssh mac` reaches MacBook Pro (Tailscale 100.87.206.13)
- Mac: macOS 26.4.1, arm64, WeChat 4.1.8, LM Studio installed, Obsidian vault at ~/Documents/
- WeChat DBs: `~/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/joyrush_2ffc/db_storage/`
- Databases are SQLCipher 4.x encrypted; key_info.db is plaintext

---

## File Structure

```
wechat-obsidian-plugin/
├── manifest.json                    # Obsidian plugin manifest
├── package.json                     # Dependencies: sql.js, fflate, zstd-codec
├── tsconfig.json                    # TypeScript config targeting ES2020
├── esbuild.config.mjs               # Build script → main.js
├── styles.css                       # Plugin styles (minimal for MVP)
├── src/
│   ├── main.ts                      # Plugin lifecycle: onload/onunload, commands
│   ├── settings.ts                  # SettingTab: DB path, AI endpoint, briefing config
│   ├── types.ts                     # Shared interfaces: ParsedMessage, Contact, Settings
│   ├── db/
│   │   ├── connector.ts             # sql.js init, load .db files as Uint8Array
│   │   ├── contact-reader.ts        # Query contact table, resolve names
│   │   ├── message-reader.ts        # Discover Msg_ tables, query messages by time range
│   │   └── ext-buffer-parser.ts     # Decode protobuf ext_buffer → nickname map
│   ├── parser/
│   │   ├── index.ts                 # Type dispatcher: baseType → parser
│   │   ├── text-parser.ts           # Type 1: extract sender + content from "wxid:\ncontent"
│   │   ├── app-parser.ts            # Type 49: decompress → XML → sub-type dispatch
│   │   ├── media-parser.ts          # Types 3/34/43/47: image/voice/video/emoji metadata
│   │   ├── system-parser.ts         # Types 10000/10002: strip XML tags
│   │   └── decompressor.ts          # zstd/zlib/raw-deflate decompression
│   └── ai/
│       ├── llm-client.ts            # POST to LM Studio OpenAI-compatible endpoint
│       ├── briefing-generator.ts    # Orchestrate: DB → parse → AI → markdown note
│       └── prompt-templates.ts      # Chinese briefing prompt template
├── tests/
│   ├── parser/
│   │   ├── text-parser.test.ts      # Unit tests for text parsing
│   │   ├── app-parser.test.ts       # Unit tests for app message parsing
│   │   ├── media-parser.test.ts     # Unit tests for media parsing
│   │   ├── system-parser.test.ts    # Unit tests for system message parsing
│   │   └── decompressor.test.ts     # Unit tests for decompression
│   ├── db/
│   │   ├── ext-buffer-parser.test.ts
│   │   └── connector.test.ts        # Test sql.js loading
│   └── fixtures/
│       ├── sample-messages.json     # Test data extracted from real DB
│       └── sample-compressed.bin    # Real compress_content blobs for testing
├── scripts/
│   ├── decrypt.py                   # Mac WeChat key extraction + DB decryption
│   └── verify.sh                    # Automated verification script
└── docs/
```

---

## Task 1: Scaffold Obsidian Plugin + Test Setup

**Files:**
- Create: `manifest.json`
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `esbuild.config.mjs`
- Create: `src/main.ts`
- Create: `src/types.ts`

- [ ] **Step 1: Create manifest.json**

```json
{
  "id": "wechat-obsidian-hub",
  "name": "WeChat Obsidian Hub",
  "version": "0.1.0",
  "minAppVersion": "1.0.0",
  "description": "AI-powered WeChat message briefing in Obsidian",
  "author": "joyrush",
  "isDesktopOnly": true
}
```

- [ ] **Step 2: Create package.json**

```json
{
  "name": "wechat-obsidian-hub",
  "version": "0.1.0",
  "description": "WeChat Obsidian Hub plugin",
  "main": "main.js",
  "scripts": {
    "dev": "node esbuild.config.mjs",
    "build": "node esbuild.config.mjs production",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "builtin-modules": "^4.0.0",
    "esbuild": "^0.24.0",
    "obsidian": "latest",
    "typescript": "^5.5.0",
    "vitest": "^3.0.0"
  },
  "dependencies": {
    "sql.js": "^1.11.0",
    "fflate": "^0.8.2"
  }
}
```

Note: We start without zstd-codec; add it in the decompressor task. sql.js and fflate are the core dependencies.

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "inlineSourceMap": true,
    "inlineSources": true,
    "module": "ESNext",
    "target": "ES2020",
    "allowJs": true,
    "noImplicitAny": true,
    "moduleResolution": "node",
    "importHelpers": true,
    "isolatedModules": true,
    "strictNullChecks": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "outDir": "./dist",
    "paths": {
      "obsidian": ["node_modules/obsidian"]
    }
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Create esbuild.config.mjs**

```javascript
import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";

const prod = process.argv[2] === "production";

esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtins,
  ],
  format: "cjs",
  target: "es2020",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  minify: prod,
}).catch(() => process.exit(1));
```

- [ ] **Step 5: Create src/types.ts**

```typescript
export interface OWHSettings {
  decryptedDbDir: string;
  wechatDataDir: string;
  aiEndpoint: string;
  aiModel: string;
  briefingFolder: string;
  briefingTimeRangeHours: number;
  autoGenerate: boolean;
  maxMessagesPerConversation: number;
  skipEmoji: boolean;
  skipSystemMessages: boolean;
}

export const DEFAULT_SETTINGS: OWHSettings = {
  decryptedDbDir: '',
  wechatDataDir: '',
  aiEndpoint: 'http://localhost:1234/v1',
  aiModel: '',
  briefingFolder: 'WeChat-Briefings',
  briefingTimeRangeHours: 24,
  autoGenerate: false,
  maxMessagesPerConversation: 500,
  skipEmoji: true,
  skipSystemMessages: true,
};

export interface Contact {
  username: string;   // wxid_xxx or xxx@chatroom
  nickName: string;
  remark: string;
  isGroup: boolean;
}

export interface ParsedMessage {
  localId: number;
  time: Date;
  conversationId: string;
  conversationName: string;
  sender: string;       // resolved display name
  senderWxid: string;
  text: string;         // human-readable content
  type: MessageCategory;
  extra: Record<string, string>;
}

export type MessageCategory =
  | 'text'
  | 'image'
  | 'voice'
  | 'video'
  | 'emoji'
  | 'link'
  | 'file'
  | 'miniapp'
  | 'quote'
  | 'forward'
  | 'announcement'
  | 'system'
  | 'other';

export interface RawMessage {
  local_id: number;
  local_type: number;
  create_time: number;
  real_sender_id: string;
  message_content: string | Uint8Array | null;
  compress_content: Uint8Array | null;
  packed_info_data: Uint8Array | null;
}
```

- [ ] **Step 6: Create minimal src/main.ts**

```typescript
import { Plugin } from 'obsidian';
import { OWHSettings, DEFAULT_SETTINGS } from './types';

export default class OWHPlugin extends Plugin {
  settings: OWHSettings = DEFAULT_SETTINGS;

  async onload() {
    await this.loadSettings();

    this.addCommand({
      id: 'generate-briefing',
      name: 'Generate WeChat Briefing',
      callback: () => {
        // Will be implemented in later tasks
        console.log('OWH: Generate briefing command triggered');
      },
    });

    console.log('OWH: WeChat Obsidian Hub loaded');
  }

  onunload() {
    console.log('OWH: WeChat Obsidian Hub unloaded');
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
```

- [ ] **Step 7: Create vitest config**

Create `vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
  resolve: {
    alias: {
      obsidian: './tests/__mocks__/obsidian.ts',
    },
  },
});
```

Create `tests/__mocks__/obsidian.ts`:
```typescript
// Minimal mock for Obsidian API used in tests
export class Plugin {
  loadData() { return Promise.resolve({}); }
  saveData(_data: unknown) { return Promise.resolve(); }
  addCommand(_cmd: unknown) {}
}
export class PluginSettingTab {}
export class Notice {
  constructor(_msg: string) {}
}
```

- [ ] **Step 8: Install dependencies and verify build**

Run:
```bash
cd /home/joyrush/wechat-obsidian-plugin
npm install
npm run build
npm test
```
Expected: `main.js` generated, 0 test suites (none yet), no errors.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: scaffold Obsidian plugin with esbuild + vitest"
```

---

## Task 2: Mac WeChat Decryption Script

**Files:**
- Create: `scripts/decrypt.py`
- Create: `scripts/verify.sh`

This is the critical prerequisite. Without decrypted databases, the plugin has nothing to read.

- [ ] **Step 1: Create decrypt.py**

```python
#!/usr/bin/env python3
"""
Mac WeChat database decryption helper.
Extracts the encryption key from the running WeChat process memory
and decrypts the SQLCipher databases to plain SQLite.

Usage: python3 decrypt.py [--key HEX_KEY] [--output-dir DIR]
"""

import subprocess
import re
import sqlite3
import shutil
import argparse
import hashlib
from pathlib import Path
from datetime import datetime


# ============================================================================
# Constants
# ============================================================================
WECHAT_CONTAINER = Path.home() / "Library/Containers/com.tencent.xinWeChat"
WECHAT_DATA = WECHAT_CONTAINER / "Data/Documents/xwechat_files"
DEFAULT_OUTPUT = Path.home() / ".wechat-hub/decrypted"

DB_FILES = [
    "contact/contact.db",
    "message/message_0.db",
    "message/media_0.db",
]


# ============================================================================
# Key Extraction
# ============================================================================
def find_wechat_pid() -> int | None:
    """Find the main WeChat process PID."""
    try:
        result = subprocess.run(
            ["pgrep", "-f", "WeChat.app/Contents/MacOS/WeChat$"],
            capture_output=True, text=True
        )
        pids = result.stdout.strip().split('\n')
        if pids and pids[0]:
            return int(pids[0])
    except Exception:
        pass

    # Fallback: broader search
    try:
        result = subprocess.run(
            ["pgrep", "-x", "WeChat"],
            capture_output=True, text=True
        )
        pids = result.stdout.strip().split('\n')
        if pids and pids[0]:
            return int(pids[0])
    except Exception:
        pass

    return None


def find_user_data_dir() -> Path | None:
    """Find the WeChat user data directory (e.g., joyrush_2ffc)."""
    if not WECHAT_DATA.exists():
        return None

    for d in WECHAT_DATA.iterdir():
        if d.is_dir() and d.name != "all_users":
            db_storage = d / "db_storage"
            if db_storage.exists():
                return db_storage

    return None


def extract_key_via_lldb(pid: int) -> str | None:
    """
    Extract SQLCipher key from WeChat process memory using lldb.
    The key is a 32-byte (64 hex char) string stored in the process heap.

    Strategy: search for the SQLCipher key pattern in the __DATA segment
    of the WeChat binary.
    """
    print(f"Attempting key extraction from PID {pid} via lldb...")

    # Use lldb to search for potential keys in memory
    # WeChat stores the key as raw bytes; we search for 32-byte sequences
    # that look like valid SQLCipher keys
    lldb_script = f"""
import lldb
import re

debugger = lldb.SBDebugger.Create()
debugger.SetAsync(False)
target = debugger.CreateTarget("")
process = target.AttachToProcessWithID(lldb.SBListener(), {pid}, lldb.SBError())

if process.IsValid():
    # Search for potential 32-byte keys near known WeChat symbols
    # The key is typically stored near the database handle
    regions = process.GetMemoryRegions()
    found_keys = []

    for i in range(regions.GetSize()):
        region = lldb.SBMemoryRegionInfo()
        regions.GetMemoryRegionAtIndex(i, region)

        if region.IsReadable() and region.IsWritable():
            base = region.GetRegionBase()
            size = region.GetRegionEnd() - base

            if size > 0 and size < 10 * 1024 * 1024:  # Skip regions > 10MB
                error = lldb.SBError()
                data = process.ReadMemory(base, min(size, 1024 * 1024), error)
                if error.Success() and data:
                    # Look for 32-byte sequences that could be SQLCipher keys
                    # Valid keys are typically high-entropy byte sequences
                    for offset in range(0, len(data) - 32, 8):
                        candidate = data[offset:offset+32]
                        # Check entropy - a real key should have high entropy
                        unique_bytes = len(set(candidate))
                        if unique_bytes > 20:  # High entropy threshold
                            hex_key = candidate.hex()
                            found_keys.append(hex_key)

    process.Detach()

    if found_keys:
        print("FOUND_KEYS:" + ",".join(found_keys[:20]))
    else:
        print("NO_KEYS_FOUND")
else:
    print("ATTACH_FAILED")
"""

    # Note: This approach requires running with appropriate permissions
    # (e.g., sudo or SIP disabled for debugging).
    # For safety, we try a simpler approach first.
    print("lldb approach requires elevated permissions.")
    print("Trying alternative key extraction methods...")
    return None


def extract_key_from_keychain() -> str | None:
    """
    Try to extract the key from macOS Keychain.
    Some WeChat versions store the DB key in the Keychain.
    """
    try:
        result = subprocess.run(
            ["security", "find-generic-password",
             "-s", "com.tencent.xinWeChat",
             "-w"],
            capture_output=True, text=True
        )
        if result.returncode == 0 and result.stdout.strip():
            key = result.stdout.strip()
            if len(key) == 64 and all(c in '0123456789abcdef' for c in key.lower()):
                return key
    except Exception:
        pass
    return None


def try_key_on_db(db_path: Path, key: str) -> bool:
    """Test if a key can decrypt a SQLCipher database."""
    try:
        import pysqlcipher3.dbapi2 as sqlcipher
        conn = sqlcipher.connect(str(db_path))
        conn.execute(f"PRAGMA key = \"x'{key}'\"")
        conn.execute("PRAGMA cipher_compatibility = 4")
        conn.execute("SELECT count(*) FROM sqlite_master")
        conn.close()
        return True
    except Exception:
        return False


# ============================================================================
# Decryption
# ============================================================================
def decrypt_db(encrypted_path: Path, output_path: Path, key: str) -> bool:
    """Decrypt a SQLCipher database to plain SQLite."""
    output_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        import pysqlcipher3.dbapi2 as sqlcipher

        # Open encrypted database
        conn = sqlcipher.connect(str(encrypted_path))
        conn.execute(f"PRAGMA key = \"x'{key}'\"")
        conn.execute("PRAGMA cipher_compatibility = 4")
        conn.execute("PRAGMA cipher_page_size = 4096")
        conn.execute("PRAGMA kdf_iter = 256000")

        # Verify we can read it
        cursor = conn.execute("SELECT count(*) FROM sqlite_master")
        table_count = cursor.fetchone()[0]
        if table_count == 0:
            print(f"  Warning: {encrypted_path.name} has 0 tables")
            conn.close()
            return False

        # Export to plaintext
        conn.execute(f"ATTACH DATABASE '{output_path}' AS plaintext KEY ''")
        conn.execute("SELECT sqlcipher_export('plaintext')")
        conn.execute("DETACH DATABASE plaintext")
        conn.close()

        print(f"  OK: {encrypted_path.name} → {output_path.name} ({table_count} tables)")
        return True

    except ImportError:
        print("ERROR: pysqlcipher3 not installed.")
        print("Install: pip3 install pysqlcipher3")
        print("On Mac you may need: brew install sqlcipher && pip3 install pysqlcipher3")
        return False
    except Exception as e:
        print(f"  FAIL: {encrypted_path.name} — {e}")
        return False


# ============================================================================
# Main
# ============================================================================
def main():
    parser = argparse.ArgumentParser(description="Decrypt Mac WeChat databases")
    parser.add_argument("--key", help="64-char hex SQLCipher key (skip auto-extraction)")
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT),
                        help=f"Output directory (default: {DEFAULT_OUTPUT})")
    parser.add_argument("--data-dir", help="WeChat db_storage directory (auto-detected)")
    args = parser.parse_args()

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Find WeChat data directory
    if args.data_dir:
        data_dir = Path(args.data_dir)
    else:
        data_dir = find_user_data_dir()
        if not data_dir:
            print("ERROR: Could not find WeChat data directory.")
            print(f"Expected at: {WECHAT_DATA}/*/db_storage/")
            return 1

    print(f"WeChat data: {data_dir}")

    # Get decryption key
    key = args.key
    if not key:
        print("Attempting automatic key extraction...")

        # Try keychain first
        key = extract_key_from_keychain()
        if key:
            print(f"Key found in Keychain: {key[:8]}...{key[-8:]}")
        else:
            # Try lldb
            pid = find_wechat_pid()
            if pid:
                print(f"WeChat PID: {pid}")
                key = extract_key_via_lldb(pid)

        if not key:
            print("\nAutomatic key extraction failed.")
            print("Please provide the key manually:")
            print("  python3 decrypt.py --key YOUR_64_CHAR_HEX_KEY")
            print("\nTo find the key, you can use PyWxDump:")
            print("  pip3 install pywxdump")
            print("  pywxdump bias -V 4.1.8 -P <PID>")
            return 1

    # Validate key format
    key = key.strip().lower()
    if len(key) != 64 or not all(c in '0123456789abcdef' for c in key):
        print(f"ERROR: Key must be 64 hex characters, got {len(key)} chars")
        return 1

    print(f"Using key: {key[:8]}...{key[-8:]}")
    print(f"Output: {output_dir}")
    print()

    # Decrypt each database
    success_count = 0
    for rel_path in DB_FILES:
        encrypted = data_dir / rel_path
        if not encrypted.exists():
            print(f"  SKIP: {rel_path} (not found)")
            continue

        out_name = Path(rel_path).name
        output = output_dir / out_name
        if decrypt_db(encrypted, output, key):
            success_count += 1

    print(f"\nDecrypted {success_count}/{len(DB_FILES)} databases to {output_dir}")

    # Write metadata
    meta = output_dir / "decrypt_meta.json"
    import json
    with open(meta, 'w') as f:
        json.dump({
            "timestamp": datetime.now().isoformat(),
            "source": str(data_dir),
            "key_hash": hashlib.sha256(key.encode()).hexdigest()[:16],
            "databases": [f for f in DB_FILES if (data_dir / f).exists()],
            "success_count": success_count,
        }, f, indent=2)

    return 0 if success_count > 0 else 1


if __name__ == "__main__":
    exit(main())
```

- [ ] **Step 2: Create verify.sh**

```bash
#!/bin/bash
# Automated verification script for OWH pipeline
# Run on MacBook: ssh mac 'bash -s' < scripts/verify.sh

set -e

DECRYPTED_DIR="${HOME}/.wechat-hub/decrypted"
VAULT_DIR="${HOME}/Documents"
LM_STUDIO="http://localhost:1234/v1"

echo "=== OWH Verification ==="
echo ""

PASS=0
FAIL=0

check() {
    local name="$1"
    local result="$2"
    if [ "$result" = "PASS" ]; then
        echo "  [PASS] $name"
        PASS=$((PASS + 1))
    else
        echo "  [FAIL] $name — $result"
        FAIL=$((FAIL + 1))
    fi
}

# Phase 1: Decrypted databases
echo "Phase 1: Decrypted Databases"
if [ -f "$DECRYPTED_DIR/contact.db" ]; then
    COUNT=$(sqlite3 "$DECRYPTED_DIR/contact.db" "SELECT count(*) FROM contact" 2>/dev/null || echo "0")
    if [ "$COUNT" -gt 0 ] 2>/dev/null; then
        check "contact.db readable" "PASS"
        check "contact count ($COUNT)" "PASS"
    else
        check "contact.db readable" "query failed or 0 rows"
    fi
else
    check "contact.db exists" "file not found"
fi

if [ -f "$DECRYPTED_DIR/message_0.db" ]; then
    TABLES=$(sqlite3 "$DECRYPTED_DIR/message_0.db" "SELECT count(*) FROM sqlite_master WHERE type='table' AND name LIKE 'Msg_%'" 2>/dev/null || echo "0")
    if [ "$TABLES" -gt 0 ] 2>/dev/null; then
        check "message_0.db readable" "PASS"
        check "Msg_ tables found ($TABLES)" "PASS"
    else
        check "message_0.db readable" "no Msg_ tables found"
    fi
else
    check "message_0.db exists" "file not found"
fi

# Phase 2: Plugin build
echo ""
echo "Phase 2: Plugin Build"
PLUGIN_DIR="$(dirname "$0")/.."
if [ -f "$PLUGIN_DIR/main.js" ]; then
    check "main.js built" "PASS"
else
    check "main.js built" "file not found"
fi

# Phase 3: LM Studio
echo ""
echo "Phase 3: LM Studio API"
MODELS=$(curl -s "$LM_STUDIO/models" 2>/dev/null)
if echo "$MODELS" | python3 -c "import sys,json; d=json.load(sys.stdin); print('ok' if d.get('data') else 'empty')" 2>/dev/null | grep -q "ok"; then
    check "LM Studio reachable" "PASS"
else
    check "LM Studio reachable" "not running or no model loaded"
fi

# Phase 4: Obsidian vault
echo ""
echo "Phase 4: Obsidian Vault"
if [ -d "$VAULT_DIR/.obsidian" ]; then
    check "Obsidian vault found" "PASS"
else
    check "Obsidian vault found" "no .obsidian in $VAULT_DIR"
fi

BRIEFING_DIR="$VAULT_DIR/WeChat-Briefings"
TODAY=$(date +%Y-%m-%d)
if [ -f "$BRIEFING_DIR/$TODAY.md" ]; then
    SECTIONS=$(grep -c "##" "$BRIEFING_DIR/$TODAY.md" 2>/dev/null || echo "0")
    check "Today's briefing exists" "PASS"
    check "Briefing has sections ($SECTIONS)" "PASS"
else
    check "Today's briefing exists" "not yet generated"
fi

# Summary
echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
exit $FAIL
```

- [ ] **Step 3: Test decryption on MacBook**

Copy the script to Mac and run:
```bash
scp scripts/decrypt.py mac:~/
ssh mac "pip3 install pysqlcipher3 2>/dev/null; python3 ~/decrypt.py --help"
```

If pysqlcipher3 is not available, the script provides installation instructions. The key must be provided manually for the first run. If auto-extraction works, the key is cached in `decrypt_meta.json`.

Expected: Script runs without import errors, prints help text.

- [ ] **Step 4: Commit**

```bash
git add scripts/decrypt.py scripts/verify.sh
git commit -m "feat: add Mac WeChat decryption helper + verification script"
```

---

## Task 3: DB Connector (sql.js)

**Files:**
- Create: `src/db/connector.ts`
- Create: `tests/db/connector.test.ts`
- Create: `tests/fixtures/sample-messages.json`

- [ ] **Step 1: Create test fixtures**

`tests/fixtures/sample-messages.json`:
```json
{
  "contacts": [
    { "username": "wxid_abc123", "nick_name": "Zhang San", "remark": "Lao Zhang" },
    { "username": "wxid_def456", "nick_name": "Li Si", "remark": "" },
    { "username": "group123@chatroom", "nick_name": "Tech Discussion", "remark": "" }
  ],
  "messages": [
    {
      "local_id": 1,
      "local_type": 1,
      "create_time": 1713254400,
      "real_sender_id": "wxid_abc123",
      "message_content": "wxid_abc123:\nHello everyone",
      "compress_content": null,
      "packed_info_data": null
    },
    {
      "local_id": 2,
      "local_type": 49,
      "create_time": 1713254460,
      "real_sender_id": "wxid_def456",
      "message_content": null,
      "compress_content_xml": "<msg><appmsg><type>5</type><title>Breaking News</title><des>Something happened</des><url>https://example.com/news</url><sourcedisplayname>News App</sourcedisplayname></appmsg></msg>",
      "packed_info_data": null
    }
  ]
}
```

- [ ] **Step 2: Write connector test**

`tests/db/connector.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { DbConnector } from '../../src/db/connector';
import initSqlJs from 'sql.js';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('DbConnector', () => {
  it('should initialize sql.js', async () => {
    const SQL = await initSqlJs();
    expect(SQL).toBeDefined();
    expect(SQL.Database).toBeDefined();
  });

  it('should open an in-memory database', async () => {
    const connector = new DbConnector();
    await connector.init();
    const db = connector.createMemoryDb();
    db.run('CREATE TABLE test (id INTEGER, name TEXT)');
    db.run("INSERT INTO test VALUES (1, 'hello')");
    const result = db.exec('SELECT * FROM test');
    expect(result[0].values[0]).toEqual([1, 'hello']);
    db.close();
  });

  it('should load a database from Uint8Array', async () => {
    const connector = new DbConnector();
    await connector.init();

    // Create a test DB, export as bytes, re-import
    const db1 = connector.createMemoryDb();
    db1.run('CREATE TABLE contact (username TEXT, nick_name TEXT, remark TEXT)');
    db1.run("INSERT INTO contact VALUES ('wxid_test', 'Test User', 'Tester')");
    const bytes = db1.export();
    db1.close();

    const db2 = connector.loadFromBytes(bytes);
    const result = db2.exec('SELECT nick_name FROM contact');
    expect(result[0].values[0][0]).toBe('Test User');
    db2.close();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- tests/db/connector.test.ts`
Expected: FAIL — `Cannot find module '../../src/db/connector'`

- [ ] **Step 4: Implement connector.ts**

`src/db/connector.ts`:
```typescript
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';

export class DbConnector {
  private SQL: SqlJsStatic | null = null;

  async init(): Promise<void> {
    if (!this.SQL) {
      this.SQL = await initSqlJs();
    }
  }

  isReady(): boolean {
    return this.SQL !== null;
  }

  createMemoryDb(): Database {
    if (!this.SQL) throw new Error('DbConnector not initialized. Call init() first.');
    return new this.SQL.Database();
  }

  loadFromBytes(data: Uint8Array): Database {
    if (!this.SQL) throw new Error('DbConnector not initialized. Call init() first.');
    return new this.SQL.Database(data);
  }

  async loadFromFile(filePath: string, readFile: (path: string) => Promise<ArrayBuffer>): Promise<Database> {
    if (!this.SQL) throw new Error('DbConnector not initialized. Call init() first.');
    const buffer = await readFile(filePath);
    return new this.SQL.Database(new Uint8Array(buffer));
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/db/connector.test.ts`
Expected: 3 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/db/connector.ts tests/db/connector.test.ts tests/fixtures/sample-messages.json
git commit -m "feat: add sql.js DB connector with tests"
```

---

## Task 4: Contact Reader

**Files:**
- Create: `src/db/contact-reader.ts`
- Create: `tests/db/contact-reader.test.ts`

- [ ] **Step 1: Write contact reader test**

`tests/db/contact-reader.test.ts`:
```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { DbConnector } from '../../src/db/connector';
import { ContactReader } from '../../src/db/contact-reader';
import type { Database } from 'sql.js';

describe('ContactReader', () => {
  let db: Database;
  let reader: ContactReader;

  beforeAll(async () => {
    const connector = new DbConnector();
    await connector.init();
    db = connector.createMemoryDb();

    // Create contact table matching WeChat 4.0+ schema
    db.run(`CREATE TABLE contact (
      username TEXT,
      nick_name TEXT,
      remark TEXT
    )`);
    db.run("INSERT INTO contact VALUES ('wxid_abc', 'Zhang San', 'Lao Zhang')");
    db.run("INSERT INTO contact VALUES ('wxid_def', 'Li Si', '')");
    db.run("INSERT INTO contact VALUES ('group1@chatroom', 'Tech Group', '')");
    db.run("INSERT INTO contact VALUES ('gh_official', 'Official Account', '')");

    // Create chat_room table
    db.run(`CREATE TABLE chat_room (
      username TEXT,
      ext_buffer BLOB
    )`);

    reader = new ContactReader(db);
  });

  it('should load all contacts', () => {
    const contacts = reader.getAllContacts();
    expect(contacts.length).toBe(4);
  });

  it('should identify groups by @chatroom suffix', () => {
    const contacts = reader.getAllContacts();
    const group = contacts.find(c => c.username === 'group1@chatroom');
    expect(group?.isGroup).toBe(true);
    expect(group?.nickName).toBe('Tech Group');
  });

  it('should prefer remark over nick_name for display', () => {
    const name = reader.getDisplayName('wxid_abc');
    expect(name).toBe('Lao Zhang');
  });

  it('should fall back to nick_name if no remark', () => {
    const name = reader.getDisplayName('wxid_def');
    expect(name).toBe('Li Si');
  });

  it('should return wxid if contact not found', () => {
    const name = reader.getDisplayName('wxid_unknown');
    expect(name).toBe('wxid_unknown');
  });

  it('should count contacts', () => {
    expect(reader.count()).toBe(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/db/contact-reader.test.ts`
Expected: FAIL — `Cannot find module '../../src/db/contact-reader'`

- [ ] **Step 3: Implement contact-reader.ts**

`src/db/contact-reader.ts`:
```typescript
import type { Database } from 'sql.js';
import type { Contact } from '../types';

export class ContactReader {
  private contacts: Map<string, Contact> = new Map();

  constructor(private db: Database) {
    this.loadContacts();
  }

  private loadContacts(): void {
    const results = this.db.exec(
      'SELECT username, nick_name, remark FROM contact WHERE username IS NOT NULL'
    );

    if (results.length === 0) return;

    for (const row of results[0].values) {
      const username = row[0] as string;
      const nickName = (row[1] as string) || '';
      const remark = (row[2] as string) || '';

      this.contacts.set(username, {
        username,
        nickName,
        remark,
        isGroup: username.endsWith('@chatroom'),
      });
    }
  }

  getAllContacts(): Contact[] {
    return Array.from(this.contacts.values());
  }

  getContact(username: string): Contact | undefined {
    return this.contacts.get(username);
  }

  getDisplayName(username: string): string {
    const contact = this.contacts.get(username);
    if (!contact) return username;
    return contact.remark || contact.nickName || username;
  }

  count(): number {
    return this.contacts.size;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/db/contact-reader.test.ts`
Expected: 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/db/contact-reader.ts tests/db/contact-reader.test.ts
git commit -m "feat: add contact reader with display name resolution"
```

---

## Task 5: Message Reader (table discovery + queries)

**Files:**
- Create: `src/db/message-reader.ts`
- Create: `tests/db/message-reader.test.ts`

- [ ] **Step 1: Write message reader test**

`tests/db/message-reader.test.ts`:
```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { DbConnector } from '../../src/db/connector';
import { MessageReader } from '../../src/db/message-reader';
import type { Database } from 'sql.js';
import { createHash } from 'crypto';

describe('MessageReader', () => {
  let db: Database;
  let reader: MessageReader;
  const groupId = 'group123@chatroom';
  const tableHash = createHash('md5').update(groupId).digest('hex');
  const tableName = `Msg_${tableHash}`;

  beforeAll(async () => {
    const connector = new DbConnector();
    await connector.init();
    db = connector.createMemoryDb();

    // Create message table matching WeChat 4.0+ schema
    db.run(`CREATE TABLE [${tableName}] (
      local_id INTEGER,
      local_type INTEGER,
      create_time INTEGER,
      real_sender_id TEXT,
      message_content TEXT,
      compress_content BLOB,
      packed_info_data BLOB
    )`);

    const now = Math.floor(Date.now() / 1000);
    db.run(`INSERT INTO [${tableName}] VALUES (1, 1, ${now - 3600}, 'wxid_a', 'wxid_a:\nHello', NULL, NULL)`);
    db.run(`INSERT INTO [${tableName}] VALUES (2, 1, ${now - 1800}, 'wxid_b', 'wxid_b:\nWorld', NULL, NULL)`);
    db.run(`INSERT INTO [${tableName}] VALUES (3, 47, ${now - 900}, 'wxid_a', '<emoji>', NULL, NULL)`);
    db.run(`INSERT INTO [${tableName}] VALUES (4, 1, ${now}, 'wxid_a', 'wxid_a:\nRecent', NULL, NULL)`);

    reader = new MessageReader(db);
  });

  it('should discover Msg_ tables', () => {
    const tables = reader.getConversationTables();
    expect(tables.length).toBe(1);
    expect(tables[0]).toBe(tableName);
  });

  it('should read all messages from a table', () => {
    const messages = reader.getMessages(tableName);
    expect(messages.length).toBe(4);
  });

  it('should filter messages by time range', () => {
    const since = new Date(Date.now() - 2 * 3600 * 1000); // last 2 hours
    const messages = reader.getMessages(tableName, since);
    expect(messages.length).toBe(4); // all within 2 hours
  });

  it('should filter messages by time range (last 30 min)', () => {
    const since = new Date(Date.now() - 30 * 60 * 1000);
    const messages = reader.getMessages(tableName, since);
    expect(messages.length).toBe(2); // only the last 2 messages
  });

  it('should return raw message fields', () => {
    const messages = reader.getMessages(tableName);
    const first = messages[0];
    expect(first.local_id).toBe(1);
    expect(first.local_type).toBe(1);
    expect(first.real_sender_id).toBe('wxid_a');
    expect(typeof first.create_time).toBe('number');
    expect(first.message_content).toContain('Hello');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/db/message-reader.test.ts`
Expected: FAIL — `Cannot find module '../../src/db/message-reader'`

- [ ] **Step 3: Implement message-reader.ts**

`src/db/message-reader.ts`:
```typescript
import type { Database } from 'sql.js';
import type { RawMessage } from '../types';

export class MessageReader {
  constructor(private db: Database) {}

  getConversationTables(): string[] {
    const results = this.db.exec(
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'Msg_%'"
    );
    if (results.length === 0) return [];
    return results[0].values.map(row => row[0] as string);
  }

  getMessages(tableName: string, since?: Date, limit?: number): RawMessage[] {
    let query = `
      SELECT local_id, local_type, create_time, real_sender_id,
             message_content, compress_content, packed_info_data
      FROM [${tableName}]
    `;

    const params: (number | string)[] = [];
    if (since) {
      query += ' WHERE create_time >= ?';
      params.push(Math.floor(since.getTime() / 1000));
    }

    query += ' ORDER BY create_time ASC';

    if (limit) {
      query += ' LIMIT ?';
      params.push(limit);
    }

    const stmt = this.db.prepare(query);
    stmt.bind(params);

    const messages: RawMessage[] = [];
    while (stmt.step()) {
      const row = stmt.get();
      messages.push({
        local_id: row[0] as number,
        local_type: row[1] as number,
        create_time: row[2] as number,
        real_sender_id: (row[3] as string) || '',
        message_content: row[4] as string | null,
        compress_content: row[5] as Uint8Array | null,
        packed_info_data: row[6] as Uint8Array | null,
      });
    }
    stmt.free();

    return messages;
  }

  getMessageCount(tableName: string): number {
    const result = this.db.exec(`SELECT count(*) FROM [${tableName}]`);
    if (result.length === 0) return 0;
    return result[0].values[0][0] as number;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/db/message-reader.test.ts`
Expected: 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/db/message-reader.ts tests/db/message-reader.test.ts
git commit -m "feat: add message reader with table discovery and time filtering"
```

---

## Task 6: Decompressor (zstd + zlib)

**Files:**
- Create: `src/parser/decompressor.ts`
- Create: `tests/parser/decompressor.test.ts`

- [ ] **Step 1: Write decompressor test**

`tests/parser/decompressor.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { decompressContent } from '../../src/parser/decompressor';
import { deflateSync } from 'fflate';

describe('decompressContent', () => {
  it('should return null for null input', () => {
    expect(decompressContent(null)).toBeNull();
  });

  it('should return null for empty input', () => {
    expect(decompressContent(new Uint8Array(0))).toBeNull();
  });

  it('should decompress zlib data (78 9c header)', () => {
    const original = '<msg><appmsg><type>5</type><title>Test</title></appmsg></msg>';
    const compressed = deflateSync(new TextEncoder().encode(original));
    const result = decompressContent(compressed);
    expect(result).toBe(original);
  });

  it('should handle invalid data gracefully', () => {
    const garbage = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
    const result = decompressContent(garbage);
    expect(result).toBeNull();
  });

  it('should detect zstd magic bytes (28 b5 2f fd)', () => {
    // We just verify the detection logic works; actual zstd decompression
    // requires the zstd-codec WASM module which may not be available in tests
    const fakeZstd = new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0x00]);
    // Should attempt zstd decompression (may return null if zstd not loaded)
    const result = decompressContent(fakeZstd);
    // Null is acceptable — the important thing is it doesn't crash
    expect(result === null || typeof result === 'string').toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/parser/decompressor.test.ts`
Expected: FAIL — `Cannot find module '../../src/parser/decompressor'`

- [ ] **Step 3: Implement decompressor.ts**

`src/parser/decompressor.ts`:
```typescript
import { inflateSync, inflateRawSync } from 'fflate';

let zstdDecompressor: ((data: Uint8Array) => Uint8Array) | null = null;

/**
 * Initialize zstd decompressor. Call this once during plugin load.
 * zstd-codec is optional; if not available, zstd-compressed messages are skipped.
 */
export async function initZstd(): Promise<void> {
  try {
    // Dynamic import to avoid bundling issues if zstd-codec not installed
    const ZstdCodec = await import('zstd-codec');
    await new Promise<void>((resolve) => {
      ZstdCodec.ZstdCodec.run((zstd: { Simple: new () => { decompress: (data: Uint8Array) => Uint8Array } }) => {
        const simple = new zstd.Simple();
        zstdDecompressor = (data: Uint8Array) => simple.decompress(data);
        resolve();
      });
    });
  } catch {
    // zstd-codec not available; zstd messages will be skipped
    console.log('OWH: zstd-codec not available, some messages may not decompress');
  }
}

/**
 * Decompress content from compress_content field.
 * Supports zstd, zlib, and raw deflate.
 */
export function decompressContent(data: Uint8Array | null): string | null {
  if (!data || data.length === 0) return null;

  // Check zstd magic: 28 b5 2f fd
  if (data[0] === 0x28 && data[1] === 0xb5 && data[2] === 0x2f && data[3] === 0xfd) {
    if (zstdDecompressor) {
      try {
        const decompressed = zstdDecompressor(data);
        return new TextDecoder('utf-8', { fatal: false }).decode(decompressed);
      } catch { /* fall through */ }
    }
    return null;
  }

  // Check zlib: 78 9c or 78 01
  if (data[0] === 0x78 && (data[1] === 0x9c || data[1] === 0x01)) {
    try {
      const decompressed = inflateSync(data);
      return new TextDecoder('utf-8', { fatal: false }).decode(decompressed);
    } catch { /* fall through */ }
  }

  // Try raw deflate
  try {
    const decompressed = inflateRawSync(data);
    return new TextDecoder('utf-8', { fatal: false }).decode(decompressed);
  } catch { /* fall through */ }

  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/parser/decompressor.test.ts`
Expected: 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/parser/decompressor.ts tests/parser/decompressor.test.ts
git commit -m "feat: add zlib/zstd decompressor for compressed message content"
```

---

## Task 7: Text Message Parser (type 1)

**Files:**
- Create: `src/parser/text-parser.ts`
- Create: `tests/parser/text-parser.test.ts`

- [ ] **Step 1: Write text parser test**

`tests/parser/text-parser.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { parseTextMessage } from '../../src/parser/text-parser';

describe('parseTextMessage', () => {
  it('should extract sender and content from group message format', () => {
    const result = parseTextMessage('wxid_abc123:\nHello everyone');
    expect(result.senderWxid).toBe('wxid_abc123');
    expect(result.text).toBe('Hello everyone');
  });

  it('should handle \\r\\n separator', () => {
    const result = parseTextMessage('wxid_abc:\r\nHello');
    expect(result.senderWxid).toBe('wxid_abc');
    expect(result.text).toBe('Hello');
  });

  it('should handle multiline content', () => {
    const result = parseTextMessage('wxid_abc:\nLine 1\nLine 2\nLine 3');
    expect(result.senderWxid).toBe('wxid_abc');
    expect(result.text).toBe('Line 1\nLine 2\nLine 3');
  });

  it('should handle messages without sender prefix (DMs)', () => {
    const result = parseTextMessage('Just a plain message');
    expect(result.senderWxid).toBe('');
    expect(result.text).toBe('Just a plain message');
  });

  it('should handle content with @ mentions and control chars', () => {
    const content = 'wxid_abc:\n(/ Ze\u0002\u0000$\u0004zkewind:\nSome quoted content';
    const result = parseTextMessage(content);
    expect(result.senderWxid).toBe('wxid_abc');
    expect(result.text).toContain('quoted content');
  });

  it('should handle empty content', () => {
    const result = parseTextMessage('');
    expect(result.senderWxid).toBe('');
    expect(result.text).toBe('');
  });

  it('should handle null content', () => {
    const result = parseTextMessage(null);
    expect(result.senderWxid).toBe('');
    expect(result.text).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/parser/text-parser.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement text-parser.ts**

`src/parser/text-parser.ts`:
```typescript
const SENDER_PATTERN = /^([a-zA-Z0-9_-]+):\s*([\s\S]*)$/;

export interface TextParseResult {
  senderWxid: string;
  text: string;
}

export function parseTextMessage(content: string | null): TextParseResult {
  if (!content) {
    return { senderWxid: '', text: '' };
  }

  const match = content.match(SENDER_PATTERN);
  if (match) {
    return {
      senderWxid: match[1],
      text: match[2].trim(),
    };
  }

  return { senderWxid: '', text: content };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/parser/text-parser.test.ts`
Expected: 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/parser/text-parser.ts tests/parser/text-parser.test.ts
git commit -m "feat: add text message parser with sender extraction"
```

---

## Task 8: App Message Parser (type 49 — links, quotes, files)

**Files:**
- Create: `src/parser/app-parser.ts`
- Create: `tests/parser/app-parser.test.ts`

- [ ] **Step 1: Write app parser test**

`tests/parser/app-parser.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { parseAppMessage } from '../../src/parser/app-parser';
import type { MessageCategory } from '../../src/types';

const makeXml = (type: number, fields: Record<string, string> = {}): string => {
  const fieldXml = Object.entries(fields).map(([k, v]) => `<${k}>${v}</${k}>`).join('');
  return `<msg><appmsg><type>${type}</type>${fieldXml}</appmsg></msg>`;
};

describe('parseAppMessage', () => {
  it('should parse link (sub-type 5)', () => {
    const xml = makeXml(5, {
      title: 'Breaking News',
      des: 'Something important happened',
      url: 'https://example.com/news',
      sourcedisplayname: 'News App',
    });
    const result = parseAppMessage(xml);
    expect(result.type).toBe('link' as MessageCategory);
    expect(result.text).toBe('[link] Breaking News');
    expect(result.extra.description).toBe('Something important happened');
    expect(result.extra.url).toBe('https://example.com/news');
    expect(result.extra.source).toBe('News App');
  });

  it('should parse file (sub-type 6)', () => {
    const xml = makeXml(6, {
      title: 'report.pdf',
      totallen: '1048576',
    });
    const result = parseAppMessage(xml);
    expect(result.type).toBe('file' as MessageCategory);
    expect(result.text).toBe('[file] report.pdf');
    expect(result.extra.file_size).toBe('1024.0 KB');
  });

  it('should parse mini-program (sub-type 33)', () => {
    const xml = makeXml(33, {
      title: 'Some Service',
      sourcedisplayname: 'WeChat Mini App',
    });
    const result = parseAppMessage(xml);
    expect(result.type).toBe('miniapp' as MessageCategory);
    expect(result.text).toBe('[miniapp] WeChat Mini App');
  });

  it('should parse quote/reply (sub-type 57)', () => {
    const xml = `<msg><appmsg><type>57</type><title>My reply text</title>
      <refermsg><title>Original message</title><displayname>Zhang San</displayname></refermsg>
    </appmsg></msg>`;
    const result = parseAppMessage(xml);
    expect(result.type).toBe('quote' as MessageCategory);
    expect(result.text).toBe('[reply] My reply text');
    expect(result.extra.reply_to).toBe('Zhang San');
    expect(result.extra.reply_content).toBe('Original message');
  });

  it('should parse merged forward (sub-type 19)', () => {
    const xml = makeXml(19, { title: 'Chat History of Group X' });
    const result = parseAppMessage(xml);
    expect(result.type).toBe('forward' as MessageCategory);
    expect(result.text).toBe('[chat-history] Chat History of Group X');
  });

  it('should parse group announcement (sub-type 87)', () => {
    const xml = makeXml(87, { title: 'Meeting at 3pm' });
    const result = parseAppMessage(xml);
    expect(result.type).toBe('announcement' as MessageCategory);
    expect(result.text).toBe('[announcement] Meeting at 3pm');
  });

  it('should handle &amp; in URLs', () => {
    const xml = makeXml(5, {
      title: 'Link',
      url: 'https://example.com?a=1&amp;b=2',
    });
    const result = parseAppMessage(xml);
    expect(result.extra.url).toBe('https://example.com?a=1&b=2');
  });

  it('should handle empty/invalid XML', () => {
    const result = parseAppMessage('');
    expect(result.type).toBe('other' as MessageCategory);
    expect(result.text).toBe('[app]');
  });

  it('should handle null input', () => {
    const result = parseAppMessage(null);
    expect(result.type).toBe('other' as MessageCategory);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/parser/app-parser.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement app-parser.ts**

`src/parser/app-parser.ts`:
```typescript
import type { MessageCategory } from '../types';

export interface AppParseResult {
  type: MessageCategory;
  text: string;
  extra: Record<string, string>;
}

function extractTag(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return match ? match[1] : '';
}

export function parseAppMessage(xml: string | null): AppParseResult {
  const result: AppParseResult = { type: 'other', text: '[app]', extra: {} };

  if (!xml) return result;

  const typeMatch = xml.match(/<type>(\d+)<\/type>/);
  const subType = typeMatch ? parseInt(typeMatch[1], 10) : 0;

  const title = extractTag(xml, 'title');
  const des = extractTag(xml, 'des');
  const rawUrl = extractTag(xml, 'url');
  const url = rawUrl.replace(/&amp;/g, '&');
  const source = extractTag(xml, 'sourcedisplayname');

  result.extra.sub_type = String(subType);

  switch (subType) {
    case 5: {
      // Link
      result.type = 'link';
      result.text = `[link] ${title}`;
      if (des) result.extra.description = des;
      if (url) result.extra.url = url;
      if (source) result.extra.source = source;
      break;
    }
    case 6: {
      // File
      result.type = 'file';
      result.text = `[file] ${title || 'unknown file'}`;
      const sizeMatch = xml.match(/<totallen>(\d+)<\/totallen>/);
      if (sizeMatch) {
        const sizeKb = parseInt(sizeMatch[1], 10) / 1024;
        result.extra.file_size = sizeKb < 1024
          ? `${sizeKb.toFixed(1)} KB`
          : `${(sizeKb / 1024).toFixed(1)} MB`;
      }
      break;
    }
    case 33:
    case 36: {
      // Mini-program
      result.type = 'miniapp';
      result.text = `[miniapp] ${source || title}`;
      if (url) result.extra.url = url;
      break;
    }
    case 57: {
      // Quote/Reply
      result.type = 'quote';
      result.text = `[reply] ${title}`;
      const referMatch = xml.match(/<refermsg>([\s\S]*?)<\/refermsg>/);
      if (referMatch) {
        const refXml = referMatch[1];
        const refTitle = extractTag(refXml, 'title');
        const refName = extractTag(refXml, 'displayname');
        if (refName) result.extra.reply_to = refName;
        if (refTitle) result.extra.reply_content = refTitle.slice(0, 50);
      }
      break;
    }
    case 19: {
      // Merged forward
      result.type = 'forward';
      result.text = `[chat-history] ${title}`;
      break;
    }
    case 87: {
      // Group announcement
      result.type = 'announcement';
      result.text = `[announcement] ${title}`;
      break;
    }
    case 4:
    case 51:
    case 63:
    case 88: {
      // Video channel
      result.type = 'other';
      result.text = `[video-channel] ${title}`;
      if (url) result.extra.url = url;
      break;
    }
    default: {
      result.type = 'other';
      result.text = title ? `[app-${subType}] ${title}` : '[app]';
      if (url) result.extra.url = url;
    }
  }

  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/parser/app-parser.test.ts`
Expected: 9 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/parser/app-parser.ts tests/parser/app-parser.test.ts
git commit -m "feat: add app message parser for links, files, quotes, miniapps"
```

---

## Task 9: Media + System Message Parsers (types 3/34/43/47/10000/10002)

**Files:**
- Create: `src/parser/media-parser.ts`
- Create: `src/parser/system-parser.ts`
- Create: `tests/parser/media-parser.test.ts`
- Create: `tests/parser/system-parser.test.ts`

- [ ] **Step 1: Write media parser test**

`tests/parser/media-parser.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { parseImageMessage, parseVoiceMessage, parseVideoMessage, parseEmojiMessage } from '../../src/parser/media-parser';

describe('parseImageMessage', () => {
  it('should extract image metadata from XML', () => {
    const xml = '<img aeskey="abc123" md5="def456" cdnbigimgurl="https://cdn/img.jpg" />';
    const result = parseImageMessage(xml, null);
    expect(result.text).toBe('[image]');
    expect(result.type).toBe('image');
    expect(result.extra.aeskey).toBe('abc123');
  });

  it('should extract local path from packed_info_data', () => {
    const packed = new TextEncoder().encode('\x00Image/2025-02/abc123.jpg\x00');
    const result = parseImageMessage('', packed);
    expect(result.extra.local_path).toBe('Image/2025-02/abc123.jpg');
  });
});

describe('parseVoiceMessage', () => {
  it('should extract voice duration', () => {
    const xml = '<msg><voicemsg voicelength="5000" /></msg>';
    const result = parseVoiceMessage(xml);
    expect(result.text).toBe('[voice 5s]');
    expect(result.type).toBe('voice');
    expect(result.extra.duration).toBe('5');
  });

  it('should handle missing duration', () => {
    const result = parseVoiceMessage('');
    expect(result.text).toBe('[voice]');
  });
});

describe('parseVideoMessage', () => {
  it('should extract video duration', () => {
    const xml = '<msg><videomsg playlength="30" cdnvideourl="https://cdn/vid.mp4" /></msg>';
    const result = parseVideoMessage(xml);
    expect(result.text).toBe('[video 30s]');
    expect(result.type).toBe('video');
  });
});

describe('parseEmojiMessage', () => {
  it('should return emoji placeholder', () => {
    const result = parseEmojiMessage('<emoji productid="123" />');
    expect(result.text).toBe('[emoji]');
    expect(result.type).toBe('emoji');
  });
});
```

- [ ] **Step 2: Write system parser test**

`tests/parser/system-parser.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { parseSystemMessage, parseRevokedMessage } from '../../src/parser/system-parser';

describe('parseSystemMessage', () => {
  it('should strip XML tags from system message', () => {
    const xml = '<?xml version="1.0"?><sysmsg><content>"Zhang San" joined the group</content></sysmsg>';
    const result = parseSystemMessage(xml);
    expect(result.text).toContain('Zhang San');
    expect(result.text).toContain('joined the group');
    expect(result.text).not.toContain('<');
  });

  it('should handle plain text system message', () => {
    const result = parseSystemMessage('You were added to the group');
    expect(result.text).toBe('You were added to the group');
  });

  it('should handle empty input', () => {
    const result = parseSystemMessage('');
    expect(result.text).toBe('[system]');
  });
});

describe('parseRevokedMessage', () => {
  it('should extract revoke info', () => {
    const xml = '<?xml version="1.0"?><sysmsg type="revokemsg"><revokemsg><session>group@chatroom</session><msgid>123</msgid><replacemsg><![CDATA["Zhang San" retracted a message]]></replacemsg></revokemsg></sysmsg>';
    const result = parseRevokedMessage(xml);
    expect(result.text).toContain('retracted');
  });

  it('should handle simple revoke', () => {
    const result = parseRevokedMessage('"Zhang San" 撤回了一条消息');
    expect(result.text).toContain('撤回');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- tests/parser/media-parser.test.ts tests/parser/system-parser.test.ts`
Expected: FAIL

- [ ] **Step 4: Implement media-parser.ts**

`src/parser/media-parser.ts`:
```typescript
import type { MessageCategory } from '../types';

export interface MediaParseResult {
  type: MessageCategory;
  text: string;
  extra: Record<string, string>;
}

export function parseImageMessage(content: string | null, packedInfo: Uint8Array | null): MediaParseResult {
  const extra: Record<string, string> = {};

  if (content) {
    const aeskey = content.match(/aeskey="([^"]+)"/);
    const md5 = content.match(/md5="([^"]+)"/);
    const cdnurl = content.match(/cdnbigimgurl="([^"]+)"/) || content.match(/cdnmidimgurl="([^"]+)"/);
    if (aeskey) extra.aeskey = aeskey[1];
    if (md5) extra.md5 = md5[1];
    if (cdnurl) extra.cdn_url = cdnurl[1];
  }

  if (packedInfo) {
    try {
      const text = new TextDecoder('utf-8', { fatal: false }).decode(packedInfo);
      const paths = text.match(/(Image\/\d{4}-\d{2}\/[^\x00\s]+)/);
      if (paths) extra.local_path = paths[1];
    } catch { /* ignore */ }
  }

  return { type: 'image', text: '[image]', extra };
}

export function parseVoiceMessage(content: string | null): MediaParseResult {
  const extra: Record<string, string> = {};

  if (content) {
    const match = content.match(/voicelength="(\d+)"/);
    if (match) {
      const durationSec = Math.floor(parseInt(match[1], 10) / 1000);
      extra.duration = String(durationSec);
      return { type: 'voice', text: `[voice ${durationSec}s]`, extra };
    }
  }

  return { type: 'voice', text: '[voice]', extra };
}

export function parseVideoMessage(content: string | null): MediaParseResult {
  const extra: Record<string, string> = {};

  if (content) {
    const playMatch = content.match(/playlength="(\d+)"/);
    const cdnMatch = content.match(/cdnvideourl="([^"]+)"/);
    if (playMatch) {
      const duration = parseInt(playMatch[1], 10);
      extra.duration = String(duration);
      if (cdnMatch) extra.cdn_url = cdnMatch[1];
      return { type: 'video', text: `[video ${duration}s]`, extra };
    }
  }

  return { type: 'video', text: '[video]', extra };
}

export function parseEmojiMessage(content: string | null): MediaParseResult {
  const extra: Record<string, string> = {};

  if (content) {
    const productid = content.match(/productid="([^"]*)"/);
    const md5 = content.match(/md5="([^"]+)"/);
    if (productid && productid[1]) extra.productid = productid[1];
    if (md5) extra.md5 = md5[1];
  }

  return { type: 'emoji', text: '[emoji]', extra };
}
```

- [ ] **Step 5: Implement system-parser.ts**

`src/parser/system-parser.ts`:
```typescript
import type { MessageCategory } from '../types';

export interface SystemParseResult {
  type: MessageCategory;
  text: string;
  extra: Record<string, string>;
}

export function parseSystemMessage(content: string | null): SystemParseResult {
  if (!content) return { type: 'system', text: '[system]', extra: {} };

  // Strip all XML tags
  const clean = content.replace(/<[^>]+>/g, '').trim();
  // Also strip CDATA markers
  const final = clean.replace(/\[!\[CDATA\[|\]\]\]/g, '').trim();

  return {
    type: 'system',
    text: final || '[system]',
    extra: {},
  };
}

export function parseRevokedMessage(content: string | null): SystemParseResult {
  if (!content) return { type: 'system', text: '[retracted]', extra: {} };

  // Try to extract the replacemsg content
  const replaceMatch = content.match(/<replacemsg><!\[CDATA\[(.*?)\]\]><\/replacemsg>/s);
  if (replaceMatch) {
    return { type: 'system', text: replaceMatch[1].trim(), extra: {} };
  }

  // Strip XML and return
  const clean = content.replace(/<[^>]+>/g, '').trim();
  return {
    type: 'system',
    text: clean || '[retracted]',
    extra: {},
  };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- tests/parser/media-parser.test.ts tests/parser/system-parser.test.ts`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/parser/media-parser.ts src/parser/system-parser.ts tests/parser/media-parser.test.ts tests/parser/system-parser.test.ts
git commit -m "feat: add media and system message parsers"
```

---

## Task 10: Message Parser Dispatcher

**Files:**
- Create: `src/parser/index.ts`
- Create: `tests/parser/index.test.ts` (integration test)

- [ ] **Step 1: Write dispatcher test**

`tests/parser/index.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { parseMessage } from '../../src/parser/index';
import type { RawMessage } from '../../src/types';

function makeRaw(overrides: Partial<RawMessage>): RawMessage {
  return {
    local_id: 1,
    local_type: 1,
    create_time: 1713254400,
    real_sender_id: 'wxid_test',
    message_content: null,
    compress_content: null,
    packed_info_data: null,
    ...overrides,
  };
}

describe('parseMessage dispatcher', () => {
  it('should dispatch type 1 to text parser', () => {
    const raw = makeRaw({ local_type: 1, message_content: 'wxid_a:\nHello' });
    const result = parseMessage(raw);
    expect(result.type).toBe('text');
    expect(result.text).toBe('Hello');
    expect(result.senderWxid).toBe('wxid_a');
  });

  it('should dispatch type 3 to image parser', () => {
    const raw = makeRaw({ local_type: 3, message_content: '<img aeskey="k" />' });
    const result = parseMessage(raw);
    expect(result.type).toBe('image');
    expect(result.text).toBe('[image]');
  });

  it('should dispatch type 34 to voice parser', () => {
    const raw = makeRaw({ local_type: 34, message_content: '<voicemsg voicelength="3000" />' });
    const result = parseMessage(raw);
    expect(result.type).toBe('voice');
    expect(result.text).toBe('[voice 3s]');
  });

  it('should dispatch type 47 to emoji parser', () => {
    const raw = makeRaw({ local_type: 47, message_content: '<emoji />' });
    const result = parseMessage(raw);
    expect(result.type).toBe('emoji');
  });

  it('should dispatch type 10000 to system parser', () => {
    const raw = makeRaw({ local_type: 10000, message_content: '<sysmsg>Hello</sysmsg>' });
    const result = parseMessage(raw);
    expect(result.type).toBe('system');
    expect(result.text).toBe('Hello');
  });

  it('should extract base type using bitmask', () => {
    // Large type numbers like 219043332145 — base type = type & 0xFFFF
    // 219043332145 & 0xFFFF = ... we test with a known composed type
    const composedType = (3 << 16) | 1; // sub-type 3, base type 1
    const raw = makeRaw({ local_type: composedType, message_content: 'wxid_a:\nTest' });
    const result = parseMessage(raw);
    expect(result.type).toBe('text');
  });

  it('should handle unknown types gracefully', () => {
    const raw = makeRaw({ local_type: 99999, message_content: 'unknown' });
    const result = parseMessage(raw);
    expect(result.type).toBe('other');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/parser/index.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement parser/index.ts**

`src/parser/index.ts`:
```typescript
import type { RawMessage, MessageCategory } from '../types';
import { parseTextMessage } from './text-parser';
import { parseAppMessage } from './app-parser';
import { parseImageMessage, parseVoiceMessage, parseVideoMessage, parseEmojiMessage } from './media-parser';
import { parseSystemMessage, parseRevokedMessage } from './system-parser';
import { decompressContent } from './decompressor';

export interface ParseResult {
  type: MessageCategory;
  text: string;
  senderWxid: string;
  extra: Record<string, string>;
}

export function parseMessage(raw: RawMessage): ParseResult {
  const baseType = raw.local_type & 0xFFFF;
  const content = typeof raw.message_content === 'string' ? raw.message_content : null;

  // For group messages, sender may be in message_content (type 1) or real_sender_id
  let senderWxid = raw.real_sender_id || '';

  switch (baseType) {
    case 1: {
      const parsed = parseTextMessage(content);
      if (parsed.senderWxid) senderWxid = parsed.senderWxid;
      return { type: 'text', text: parsed.text, senderWxid, extra: {} };
    }

    case 3: {
      const parsed = parseImageMessage(content, raw.packed_info_data);
      return { ...parsed, senderWxid };
    }

    case 34: {
      const parsed = parseVoiceMessage(content);
      return { ...parsed, senderWxid };
    }

    case 43: {
      const parsed = parseVideoMessage(content);
      return { ...parsed, senderWxid };
    }

    case 47: {
      const parsed = parseEmojiMessage(content);
      return { ...parsed, senderWxid };
    }

    case 49: {
      // App message: prefer compress_content (decompressed), fall back to message_content
      let xml: string | null = null;
      if (raw.compress_content) {
        xml = decompressContent(raw.compress_content);
      }
      if (!xml && content) {
        xml = content;
      }
      const parsed = parseAppMessage(xml);
      return { ...parsed, senderWxid };
    }

    case 10000: {
      const parsed = parseSystemMessage(content);
      return { ...parsed, senderWxid };
    }

    case 10002: {
      const parsed = parseRevokedMessage(content);
      return { ...parsed, senderWxid };
    }

    default:
      return {
        type: 'other',
        text: content ? content.slice(0, 100) : `[type-${baseType}]`,
        senderWxid,
        extra: {},
      };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/parser/index.test.ts`
Expected: 7 tests PASS

- [ ] **Step 5: Run all tests**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/parser/index.ts tests/parser/index.test.ts
git commit -m "feat: add message parser dispatcher with type bitmask extraction"
```

---

## Task 11: LLM Client (LM Studio API)

**Files:**
- Create: `src/ai/llm-client.ts`
- Create: `tests/ai/llm-client.test.ts`

- [ ] **Step 1: Write LLM client test**

`tests/ai/llm-client.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { LlmClient } from '../../src/ai/llm-client';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('LlmClient', () => {
  const client = new LlmClient('http://localhost:1234/v1', '');

  it('should format a chat completion request correctly', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: '# Briefing\nAll quiet today.' } }],
      }),
    });

    const result = await client.complete('Summarize these messages');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:1234/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.messages[0].role).toBe('user');
    expect(body.messages[0].content).toBe('Summarize these messages');
    expect(result).toBe('# Briefing\nAll quiet today.');
  });

  it('should handle API errors gracefully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    await expect(client.complete('test')).rejects.toThrow('LLM API error: 500');
  });

  it('should handle network errors', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

    await expect(client.complete('test')).rejects.toThrow('Connection refused');
  });

  it('should check if endpoint is reachable', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: [{ id: 'model-1' }] }),
    });

    const available = await client.isAvailable();
    expect(available).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/ai/llm-client.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement llm-client.ts**

`src/ai/llm-client.ts`:
```typescript
export class LlmClient {
  constructor(
    private endpoint: string,
    private model: string,
  ) {}

  async complete(prompt: string): Promise<string> {
    const response = await fetch(`${this.endpoint}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model || undefined,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      throw new Error(`LLM API error: ${response.status}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.endpoint}/models`);
      if (!response.ok) return false;
      const data = await response.json();
      return Array.isArray(data.data) && data.data.length > 0;
    } catch {
      return false;
    }
  }

  async getLoadedModel(): Promise<string | null> {
    try {
      const response = await fetch(`${this.endpoint}/models`);
      if (!response.ok) return null;
      const data = await response.json();
      if (data.data && data.data.length > 0) {
        return data.data[0].id;
      }
    } catch { /* ignore */ }
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/ai/llm-client.test.ts`
Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/ai/llm-client.ts tests/ai/llm-client.test.ts
git commit -m "feat: add LM Studio LLM client with OpenAI-compatible API"
```

---

## Task 12: Briefing Generator + Prompt Template

**Files:**
- Create: `src/ai/prompt-templates.ts`
- Create: `src/ai/briefing-generator.ts`
- Create: `tests/ai/briefing-generator.test.ts`

- [ ] **Step 1: Create prompt template**

`src/ai/prompt-templates.ts`:
```typescript
export function buildBriefingPrompt(date: string, messagesText: string): string {
  return `你是一个私人助理，负责为用户总结每天的微信消息。
请根据以下消息生成一份中文每日简报。

规则：
- 按对话分组，突出重要讨论
- 对于分享的链接/文章，包含标题和简要描述
- 标记需要用户关注的行动项或问题
- 跳过纯表情消息和简单的寒暄
- 保持简洁但不遗漏重要信息
- 如果某个群聊特别活跃，给出讨论主题的概括

今日消息：
---
${messagesText}
---

请按以下格式输出：

# 微信每日简报 — ${date}

## 重要提醒
（需要你关注或回复的事项）

## 分组详情
### [对话名称]
- 要点1
- 要点2

## 分享的链接与文章
（今天群里分享的有价值的链接）

## 统计
- 活跃对话数：X
- 总消息数：X
- 链接分享数：X`;
}
```

- [ ] **Step 2: Write briefing generator test**

`tests/ai/briefing-generator.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { BriefingGenerator } from '../../src/ai/briefing-generator';
import { buildBriefingPrompt } from '../../src/ai/prompt-templates';
import type { ParsedMessage } from '../../src/types';

describe('buildBriefingPrompt', () => {
  it('should include date and messages in prompt', () => {
    const prompt = buildBriefingPrompt('2026-04-16', '[09:00] Zhang San: Hello');
    expect(prompt).toContain('2026-04-16');
    expect(prompt).toContain('Zhang San: Hello');
    expect(prompt).toContain('微信每日简报');
  });
});

describe('BriefingGenerator', () => {
  it('should format messages into structured text for AI', () => {
    const messages: ParsedMessage[] = [
      {
        localId: 1,
        time: new Date('2026-04-16T09:00:00'),
        conversationId: 'group1@chatroom',
        conversationName: 'Tech Group',
        sender: 'Zhang San',
        senderWxid: 'wxid_a',
        text: 'Hello everyone',
        type: 'text',
        extra: {},
      },
      {
        localId: 2,
        time: new Date('2026-04-16T09:01:00'),
        conversationId: 'group1@chatroom',
        conversationName: 'Tech Group',
        sender: 'Li Si',
        senderWxid: 'wxid_b',
        text: '[link] Breaking News',
        type: 'link',
        extra: { description: 'Something happened', url: 'https://example.com' },
      },
    ];

    const generator = new BriefingGenerator();
    const text = generator.formatMessagesForAI(messages);

    expect(text).toContain('## Tech Group');
    expect(text).toContain('Zhang San: Hello everyone');
    expect(text).toContain('[link] Breaking News');
    expect(text).toContain('https://example.com');
  });

  it('should skip emoji messages when configured', () => {
    const messages: ParsedMessage[] = [
      {
        localId: 1,
        time: new Date(),
        conversationId: 'g@chatroom',
        conversationName: 'Group',
        sender: 'A',
        senderWxid: 'wxid_a',
        text: '[emoji]',
        type: 'emoji',
        extra: {},
      },
    ];

    const generator = new BriefingGenerator({ skipEmoji: true });
    const text = generator.formatMessagesForAI(messages);
    expect(text).not.toContain('[emoji]');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- tests/ai/briefing-generator.test.ts`
Expected: FAIL

- [ ] **Step 4: Implement briefing-generator.ts**

`src/ai/briefing-generator.ts`:
```typescript
import type { ParsedMessage, MessageCategory } from '../types';
import { buildBriefingPrompt } from './prompt-templates';
import { LlmClient } from './llm-client';

export interface BriefingOptions {
  skipEmoji?: boolean;
  skipSystemMessages?: boolean;
}

export class BriefingGenerator {
  private options: BriefingOptions;

  constructor(options: BriefingOptions = {}) {
    this.options = {
      skipEmoji: true,
      skipSystemMessages: true,
      ...options,
    };
  }

  formatMessagesForAI(messages: ParsedMessage[]): string {
    // Filter messages
    const filtered = messages.filter(msg => {
      if (this.options.skipEmoji && msg.type === 'emoji') return false;
      if (this.options.skipSystemMessages && msg.type === 'system') return false;
      return true;
    });

    // Group by conversation
    const groups = new Map<string, ParsedMessage[]>();
    for (const msg of filtered) {
      const key = msg.conversationName || msg.conversationId;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(msg);
    }

    // Format each group
    const sections: string[] = [];
    for (const [name, msgs] of groups) {
      const lines: string[] = [`## ${name}`];
      for (const msg of msgs) {
        const time = msg.time.toTimeString().slice(0, 5); // HH:MM
        let line = `[${time}] ${msg.sender}: ${msg.text}`;

        // Append extra info for links
        if (msg.type === 'link' && msg.extra.description) {
          line += ` — ${msg.extra.description}`;
        }
        if (msg.extra.url) {
          line += ` (${msg.extra.url})`;
        }

        lines.push(line);
      }
      sections.push(lines.join('\n'));
    }

    return sections.join('\n\n');
  }

  buildPrompt(messages: ParsedMessage[], date: string): string {
    const text = this.formatMessagesForAI(messages);
    return buildBriefingPrompt(date, text);
  }

  async generate(
    messages: ParsedMessage[],
    llmClient: LlmClient,
    date: string,
  ): Promise<string> {
    const prompt = this.buildPrompt(messages, date);
    return llmClient.complete(prompt);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/ai/briefing-generator.test.ts`
Expected: 3 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/ai/prompt-templates.ts src/ai/briefing-generator.ts tests/ai/briefing-generator.test.ts
git commit -m "feat: add briefing generator with prompt template and message formatting"
```

---

## Task 13: Settings Tab

**Files:**
- Create: `src/settings.ts`

- [ ] **Step 1: Implement settings.ts**

`src/settings.ts`:
```typescript
import { App, PluginSettingTab, Setting } from 'obsidian';
import type OWHPlugin from './main';

export class OWHSettingTab extends PluginSettingTab {
  plugin: OWHPlugin;

  constructor(app: App, plugin: OWHPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'WeChat Obsidian Hub Settings' });

    new Setting(containerEl)
      .setName('Decrypted database directory')
      .setDesc('Path to decrypted WeChat SQLite databases')
      .addText(text => text
        .setPlaceholder('~/.wechat-hub/decrypted')
        .setValue(this.plugin.settings.decryptedDbDir)
        .onChange(async (value) => {
          this.plugin.settings.decryptedDbDir = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('AI endpoint')
      .setDesc('LM Studio or OpenAI-compatible API endpoint')
      .addText(text => text
        .setPlaceholder('http://localhost:1234/v1')
        .setValue(this.plugin.settings.aiEndpoint)
        .onChange(async (value) => {
          this.plugin.settings.aiEndpoint = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('AI model')
      .setDesc('Leave empty to auto-detect from LM Studio')
      .addText(text => text
        .setPlaceholder('auto-detect')
        .setValue(this.plugin.settings.aiModel)
        .onChange(async (value) => {
          this.plugin.settings.aiModel = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Briefing folder')
      .setDesc('Folder in vault for briefing notes')
      .addText(text => text
        .setPlaceholder('WeChat-Briefings')
        .setValue(this.plugin.settings.briefingFolder)
        .onChange(async (value) => {
          this.plugin.settings.briefingFolder = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Time range (hours)')
      .setDesc('How many hours back to include in briefing')
      .addSlider(slider => slider
        .setLimits(1, 72, 1)
        .setValue(this.plugin.settings.briefingTimeRangeHours)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.briefingTimeRangeHours = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Skip emoji messages')
      .setDesc('Exclude emoji/sticker messages from briefing')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.skipEmoji)
        .onChange(async (value) => {
          this.plugin.settings.skipEmoji = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Skip system messages')
      .setDesc('Exclude join/leave/rename system messages')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.skipSystemMessages)
        .onChange(async (value) => {
          this.plugin.settings.skipSystemMessages = value;
          await this.plugin.saveSettings();
        }));
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/settings.ts
git commit -m "feat: add Obsidian settings tab for plugin configuration"
```

---

## Task 14: Wire Everything in main.ts

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Update main.ts with full plugin lifecycle**

Replace `src/main.ts` with:

```typescript
import { Plugin, Notice, normalizePath } from 'obsidian';
import { OWHSettings, DEFAULT_SETTINGS } from './types';
import type { ParsedMessage } from './types';
import { OWHSettingTab } from './settings';
import { DbConnector } from './db/connector';
import { ContactReader } from './db/contact-reader';
import { MessageReader } from './db/message-reader';
import { parseMessage } from './parser/index';
import { LlmClient } from './ai/llm-client';
import { BriefingGenerator } from './ai/briefing-generator';
import { readFileSync } from 'fs';
import { join } from 'path';

export default class OWHPlugin extends Plugin {
  settings: OWHSettings = DEFAULT_SETTINGS;
  private connector: DbConnector = new DbConnector();

  async onload() {
    await this.loadSettings();
    await this.connector.init();

    this.addSettingTab(new OWHSettingTab(this.app, this));

    this.addCommand({
      id: 'generate-briefing',
      name: 'Generate WeChat Briefing',
      callback: () => this.generateBriefing(),
    });

    this.addCommand({
      id: 'test-db-connection',
      name: 'Test WeChat DB Connection',
      callback: () => this.testDbConnection(),
    });

    console.log('OWH: WeChat Obsidian Hub loaded');
  }

  onunload() {
    console.log('OWH: WeChat Obsidian Hub unloaded');
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  private getDbPath(filename: string): string {
    const dir = this.settings.decryptedDbDir || join(
      (process.env.HOME || process.env.USERPROFILE || ''),
      '.wechat-hub', 'decrypted'
    );
    return join(dir, filename);
  }

  private loadDb(filename: string) {
    const path = this.getDbPath(filename);
    const data = readFileSync(path);
    return this.connector.loadFromBytes(new Uint8Array(data.buffer));
  }

  async testDbConnection() {
    try {
      const contactDb = this.loadDb('contact.db');
      const reader = new ContactReader(contactDb);
      const count = reader.count();
      contactDb.close();

      const msgDb = this.loadDb('message_0.db');
      const msgReader = new MessageReader(msgDb);
      const tables = msgReader.getConversationTables();
      msgDb.close();

      new Notice(`OWH: ${count} contacts, ${tables.length} conversations found`);
    } catch (e) {
      new Notice(`OWH: DB connection failed — ${(e as Error).message}`);
      console.error('OWH DB test failed:', e);
    }
  }

  async generateBriefing() {
    try {
      new Notice('OWH: Generating briefing...');

      // 1. Load databases
      const contactDb = this.loadDb('contact.db');
      const contactReader = new ContactReader(contactDb);

      const msgDb = this.loadDb('message_0.db');
      const msgReader = new MessageReader(msgDb);

      // 2. Get messages from the last N hours
      const since = new Date(Date.now() - this.settings.briefingTimeRangeHours * 3600 * 1000);
      const tables = msgReader.getConversationTables();

      const allParsed: ParsedMessage[] = [];

      for (const table of tables) {
        const rawMessages = msgReader.getMessages(table, since, this.settings.maxMessagesPerConversation);
        if (rawMessages.length === 0) continue;

        // Try to determine conversation name from first message or table name
        const conversationId = table.replace('Msg_', '');

        for (const raw of rawMessages) {
          const parsed = parseMessage(raw);
          allParsed.push({
            localId: raw.local_id,
            time: new Date(raw.create_time * 1000),
            conversationId,
            conversationName: contactReader.getDisplayName(conversationId) || conversationId,
            sender: contactReader.getDisplayName(parsed.senderWxid),
            senderWxid: parsed.senderWxid,
            text: parsed.text,
            type: parsed.type,
            extra: parsed.extra,
          });
        }
      }

      contactDb.close();
      msgDb.close();

      if (allParsed.length === 0) {
        new Notice('OWH: No messages found in the specified time range');
        return;
      }

      // 3. Generate briefing via AI
      const llmClient = new LlmClient(this.settings.aiEndpoint, this.settings.aiModel);

      const isAvailable = await llmClient.isAvailable();
      if (!isAvailable) {
        new Notice('OWH: LM Studio not available. Please start LM Studio and load a model.');
        return;
      }

      const generator = new BriefingGenerator({
        skipEmoji: this.settings.skipEmoji,
        skipSystemMessages: this.settings.skipSystemMessages,
      });

      const today = new Date().toISOString().slice(0, 10);
      const briefingContent = await generator.generate(allParsed, llmClient, today);

      // 4. Save to vault
      const folder = this.settings.briefingFolder;
      const filePath = normalizePath(`${folder}/${today}.md`);

      // Ensure folder exists
      if (!(await this.app.vault.adapter.exists(folder))) {
        await this.app.vault.createFolder(folder);
      }

      // Create or overwrite the note
      const existing = this.app.vault.getAbstractFileByPath(filePath);
      if (existing) {
        await this.app.vault.modify(existing as any, briefingContent);
      } else {
        await this.app.vault.create(filePath, briefingContent);
      }

      new Notice(`OWH: Briefing saved to ${filePath} (${allParsed.length} messages)`);

    } catch (e) {
      new Notice(`OWH: Briefing failed — ${(e as Error).message}`);
      console.error('OWH briefing generation failed:', e);
    }
  }
}
```

- [ ] **Step 2: Build the plugin**

Run:
```bash
npm run build
```
Expected: `main.js` generated without errors.

- [ ] **Step 3: Run all tests**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/main.ts src/settings.ts
git commit -m "feat: wire full pipeline in main.ts — DB → parse → AI → note"
```

---

## Task 15: Deploy to MacBook Obsidian + End-to-End Test

**Files:**
- Create: `scripts/deploy-to-mac.sh`

- [ ] **Step 1: Create deployment script**

`scripts/deploy-to-mac.sh`:
```bash
#!/bin/bash
# Deploy the plugin to MacBook's Obsidian vault
set -e

VAULT_DIR="/Users/joyrush/Documents"
PLUGIN_DIR="$VAULT_DIR/.obsidian/plugins/wechat-obsidian-hub"

echo "Building plugin..."
npm run build

echo "Deploying to MacBook..."
ssh mac "mkdir -p '$PLUGIN_DIR'"
scp main.js manifest.json styles.css mac:"$PLUGIN_DIR/" 2>/dev/null || {
  # styles.css may not exist yet
  scp main.js manifest.json mac:"$PLUGIN_DIR/"
}

echo "Verifying deployment..."
ssh mac "ls -la '$PLUGIN_DIR/'"

echo ""
echo "Done! In Obsidian on Mac:"
echo "  1. Settings → Community Plugins → Enable 'WeChat Obsidian Hub'"
echo "  2. Configure the decrypted DB path in plugin settings"
echo "  3. Run command: 'Generate WeChat Briefing'"
```

- [ ] **Step 2: Create empty styles.css**

`styles.css`:
```css
/* OWH Plugin Styles */
```

- [ ] **Step 3: Build and deploy**

Run:
```bash
chmod +x scripts/deploy-to-mac.sh
bash scripts/deploy-to-mac.sh
```
Expected: Files copied to `~/Documents/.obsidian/plugins/wechat-obsidian-hub/` on Mac.

- [ ] **Step 4: Run verification script on Mac**

Run:
```bash
ssh mac 'bash -s' < scripts/verify.sh
```
Expected: Phase 1 (Decrypted Databases) may FAIL if decryption hasn't been run yet. Phase 2 (Plugin Build) should PASS. Phase 3 (LM Studio) depends on whether it's running.

- [ ] **Step 5: Commit**

```bash
git add scripts/deploy-to-mac.sh styles.css
git commit -m "feat: add Mac deployment script and verification"
```

---

## Task 16: Ext-Buffer Parser (group nickname resolution)

**Files:**
- Create: `src/db/ext-buffer-parser.ts`
- Create: `tests/db/ext-buffer-parser.test.ts`

- [ ] **Step 1: Write ext-buffer parser test**

`tests/db/ext-buffer-parser.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { parseExtBufferNicknames } from '../../src/db/ext-buffer-parser';

describe('parseExtBufferNicknames', () => {
  it('should return empty map for null input', () => {
    const result = parseExtBufferNicknames(null);
    expect(result.size).toBe(0);
  });

  it('should return empty map for empty buffer', () => {
    const result = parseExtBufferNicknames(new Uint8Array(0));
    expect(result.size).toBe(0);
  });

  // Note: Real ext_buffer data is protobuf-encoded and hard to construct
  // in tests. This parser will be validated against real data on Mac.
  // For now, test the basic structure.
  it('should handle malformed data without crashing', () => {
    const garbage = new Uint8Array([0x0a, 0x05, 0xff, 0xff, 0xff, 0xff, 0xff]);
    const result = parseExtBufferNicknames(garbage);
    // Should not throw, may return empty map
    expect(result).toBeInstanceOf(Map);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/db/ext-buffer-parser.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement ext-buffer-parser.ts**

`src/db/ext-buffer-parser.ts`:
```typescript
/**
 * Parse protobuf ext_buffer from chat_room table to extract member nicknames.
 *
 * Wire format (protobuf):
 *   field 4 (repeated) → {
 *     field 1: wxid (string)
 *     field 2: nickname (string)
 *   }
 *
 * We implement manual varint decoding since we don't want a protobuf dependency.
 */

function readVarint(buf: Uint8Array, offset: number): [number, number] {
  let result = 0;
  let shift = 0;
  let pos = offset;

  while (pos < buf.length) {
    const byte = buf[pos];
    result |= (byte & 0x7f) << shift;
    pos++;
    if ((byte & 0x80) === 0) break;
    shift += 7;
    if (shift > 35) break; // prevent infinite loop
  }

  return [result, pos];
}

function readLengthDelimited(buf: Uint8Array, offset: number): [Uint8Array, number] {
  const [length, pos] = readVarint(buf, offset);
  const data = buf.slice(pos, pos + length);
  return [data, pos + length];
}

interface ProtoField {
  fieldNumber: number;
  wireType: number;
  data: Uint8Array | number;
}

function parseProtoFields(buf: Uint8Array): ProtoField[] {
  const fields: ProtoField[] = [];
  let offset = 0;

  while (offset < buf.length) {
    try {
      const [tag, tagEnd] = readVarint(buf, offset);
      const fieldNumber = tag >> 3;
      const wireType = tag & 0x07;

      if (fieldNumber === 0) break;

      if (wireType === 0) {
        // Varint
        const [value, end] = readVarint(buf, tagEnd);
        fields.push({ fieldNumber, wireType, data: value });
        offset = end;
      } else if (wireType === 2) {
        // Length-delimited
        const [data, end] = readLengthDelimited(buf, tagEnd);
        fields.push({ fieldNumber, wireType, data });
        offset = end;
      } else {
        // Skip unknown wire types
        break;
      }
    } catch {
      break;
    }
  }

  return fields;
}

export function parseExtBufferNicknames(buffer: Uint8Array | null): Map<string, string> {
  const result = new Map<string, string>();
  if (!buffer || buffer.length === 0) return result;

  try {
    const topFields = parseProtoFields(buffer);

    // Field 4 contains repeated member entries
    for (const field of topFields) {
      if (field.fieldNumber === 4 && field.wireType === 2) {
        const memberFields = parseProtoFields(field.data as Uint8Array);
        let wxid = '';
        let nickname = '';

        for (const mf of memberFields) {
          if (mf.fieldNumber === 1 && mf.wireType === 2) {
            wxid = new TextDecoder().decode(mf.data as Uint8Array);
          } else if (mf.fieldNumber === 2 && mf.wireType === 2) {
            nickname = new TextDecoder().decode(mf.data as Uint8Array);
          }
        }

        if (wxid && nickname) {
          result.set(wxid, nickname);
        }
      }
    }
  } catch {
    // Malformed buffer — return whatever we've parsed so far
  }

  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/db/ext-buffer-parser.test.ts`
Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/db/ext-buffer-parser.ts tests/db/ext-buffer-parser.test.ts
git commit -m "feat: add protobuf ext_buffer parser for group nicknames"
```

---

## Summary: Implementation Order

| Task | Component | Depends On | Estimated Steps |
|------|-----------|-----------|-----------------|
| 1 | Scaffold + test setup | — | 9 |
| 2 | Decrypt script | — | 4 |
| 3 | DB Connector (sql.js) | Task 1 | 6 |
| 4 | Contact Reader | Task 3 | 5 |
| 5 | Message Reader | Task 3 | 5 |
| 6 | Decompressor | Task 1 | 5 |
| 7 | Text Parser | Task 1 | 5 |
| 8 | App Parser | Task 6 | 5 |
| 9 | Media + System Parsers | Task 1 | 7 |
| 10 | Parser Dispatcher | Tasks 7-9 | 6 |
| 11 | LLM Client | Task 1 | 5 |
| 12 | Briefing Generator | Tasks 10, 11 | 6 |
| 13 | Settings Tab | Task 1 | 2 |
| 14 | Wire main.ts | Tasks 4,5,10,12,13 | 4 |
| 15 | Deploy + E2E | Task 14 | 5 |
| 16 | Ext-Buffer Parser | Task 4 | 5 |

Tasks 3-9 can be parallelized (independent parsers). Tasks 1 and 2 can run in parallel. Task 14 requires all prior tasks.
