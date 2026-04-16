# WeChat Obsidian Hub (OWH) - Design Spec v1.0

## Overview

Obsidian plugin that reads encrypted WeChat databases on Mac, extracts and parses all message types, and generates AI-powered daily briefings as Markdown notes in the user's vault.

**Core value**: "Open Obsidian, get a smart briefing of all your WeChat messages — text, voice, links, everything."

## System Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Mac WeChat 4.1.8                    │
│  ~/Library/Containers/com.tencent.xinWeChat/...      │
│  ├── key_info.db          (plaintext, has key blobs) │
│  ├── contact.db           (SQLCipher encrypted, 21MB)│
│  ├── message_0.db         (SQLCipher encrypted, 44MB)│
│  └── media_0.db           (SQLCipher encrypted)      │
└──────────────┬──────────────────────────────────────┘
               │
    Step 1: Key Extraction + Decryption
               │
               ▼
┌─────────────────────────────────────────────────────┐
│            Decrypted Working Copy                    │
│  ~/.wechat-hub/decrypted/                            │
│  ├── contact.db           (plain SQLite)             │
│  ├── message_0.db         (plain SQLite)             │
│  └── media_0.db           (plain SQLite)             │
└──────────────┬──────────────────────────────────────┘
               │
    Step 2: Obsidian Plugin reads decrypted DBs
               │
               ▼
┌─────────────────────────────────────────────────────┐
│           Obsidian Plugin (TypeScript)                │
│                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │ DB Connector  │  │ Msg Extractor│  │ AI Briefing│ │
│  │ (sql.js WASM) │→│ (type parser)│→│ (LM Studio)│ │
│  └──────────────┘  └──────────────┘  └────────────┘ │
│                                          │           │
│                                          ▼           │
│                              Markdown briefing note  │
│                              in Obsidian vault       │
└─────────────────────────────────────────────────────┘
```

## Phase 1: Decryption Pipeline (Python helper script)

### Why a separate script?

Obsidian plugins run in Electron (Node.js). SQLCipher decryption requires native crypto (PBKDF2 with 256K iterations, AES-256-CBC). This is best done as a Python helper script that runs before the plugin, reusing the proven logic from `pc-wechat-pim`.

### Key extraction on Mac

WeChat 4.1.8 on macOS stores encrypted databases at:
```
~/Library/Containers/com.tencent.xinWeChat/Data/Documents/
  xwechat_files/joyrush_2ffc/db_storage/
    contact/contact.db
    message/message_0.db
    message/media_0.db
    message/message_fts.db
    message/message_resource.db
```

Key info stored in (plaintext):
```
~/Library/Containers/com.tencent.xinWeChat/Data/Documents/
  xwechat_files/all_users/login/joyrush/key_info.db
  → LoginKeyInfoTable(user_name_md5, key_md5, key_info_md5, key_info_data BLOB)
```

Key extraction approaches (try in order):
1. **key_info.db parsing** — decode the BLOB to derive the SQLCipher key
2. **Process memory scan** — attach to running WeChat (PID from `pgrep WeChat`), search for key pattern (like pc-wechat-pim's `wechat_key_extractor.py` but adapted for macOS/arm64 using `lldb` or `vmmap`)
3. **Manual key input** — user provides the 32-byte hex key if auto-extraction fails

### Decryption output

Script copies encrypted DBs to `~/.wechat-hub/decrypted/`, decrypts in place using SQLCipher PRAGMA:
```sql
PRAGMA key = x'<64-char-hex-key>';
PRAGMA cipher_compatibility = 4;
PRAGMA cipher_page_size = 4096;
PRAGMA kdf_iter = 256000;
```

Then exports to plain SQLite via `SELECT sqlcipher_export('plaintext')`.

### Verification (automated)

```bash
# Test: can we read the decrypted contact.db?
sqlite3 ~/.wechat-hub/decrypted/contact.db "SELECT count(*) FROM contact"
# Expected: a number > 0

# Test: can we read messages?
sqlite3 ~/.wechat-hub/decrypted/message_0.db ".tables"
# Expected: Msg_<hash> tables listed
```

## Phase 2: Obsidian Plugin — DB Connector + Message Extractor

### Tech stack

- **Language**: TypeScript
- **Bundler**: esbuild
- **SQLite**: sql.js (WASM, zero native dependencies)
- **Compression**: fflate (zlib in JS) + zstd-codec (zstd WASM)
- **Obsidian API**: Plugin, SettingTab, ItemView, Notice

### Database schema (WeChat 4.0+ decrypted)

**contact.db**:
```sql
-- Contact table
SELECT username, nick_name, remark FROM contact;
-- username: wxid_xxx or xxx@chatroom
-- nick_name: display name
-- remark: user-set alias (higher priority)

-- Chat room table
SELECT username, ext_buffer FROM chat_room;
-- ext_buffer: protobuf binary → {wxid → group_nickname}
```

**message_0.db** (may have message_1.db, message_2.db...):
```sql
-- Message table name: Msg_{MD5(conversation_id)}
-- Find tables: SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'Msg_%'

SELECT local_id, local_type, create_time, real_sender_id,
       message_content, compress_content, packed_info_data
FROM [Msg_{hash}]
WHERE create_time >= ?
ORDER BY create_time ASC;
```

### Message type parser

Maps `local_type` to parsed output. The `local_type` field uses base type extraction:
```typescript
const baseType = localType & 0xFFFF;
```

**Type 1 — Text**:
```
Format in group: "wxid_xxx:\ncontent"
Extraction: regex /^([a-zA-Z0-9_-]+):\s*(.*)$/s
Output: { sender: wxid, text: content }
```

**Type 3 — Image**:
```
message_content: XML with aeskey, md5, cdnbigimgurl/cdnmidimgurl
packed_info_data: binary → regex /(Image\/\d{4}-\d{2}\/[^\x00\s]+)/
Output: { text: "[image]", localPath?: "Image/2025-02/xxx.jpg" }
```

**Type 34 — Voice**:
```
message_content: XML with voicelength="<ms>"
Output: { text: "[voice Ns]", duration: N }
Note: SILK audio data may be in raw_content; needs Whisper ASR for transcription
```

**Type 43 — Video**:
```
message_content: XML with playlength, cdnvideourl
Output: { text: "[video Ns]", duration: N }
```

**Type 47 — Emoji/Sticker**:
```
Output: { text: "[emoji]" } — skip for briefing
```

**Type 49 — App Message** (the complex one):
```
Source: compress_content (zstd or zlib compressed) → XML
Sub-type from <type>N</type>:

  5  → Link:      { text: "[link] <title>", description, url, source }
  6  → File:      { text: "[file] <filename>", fileSize }
  33/36 → Mini-program: { text: "[miniapp] <name>" }
  57 → Quote/Reply: { text: "[reply] <title>", replyTo, replyContent }
  19 → Merged forward: { text: "[chat-history] <title>" }
  87 → Group announcement: { text: "[announcement] <title>" }
  4/51/63/88 → Video channel: { text: "[video-channel] <title>" }
```

**Type 10000 — System message**:
```
Strip XML tags → plain text
Output: "XXX joined the group" etc.
```

**Type 10002 — Revoked message**:
```
Output: "XXX retracted a message"
```

### Decompression logic (TypeScript port)

```typescript
function decompressContent(data: Uint8Array): string | null {
  // Check zstd magic: 28 b5 2f fd
  if (data[0] === 0x28 && data[1] === 0xb5 && data[2] === 0x2f && data[3] === 0xfd) {
    return zstdDecompress(data);  // via zstd-codec WASM
  }
  // Check zlib: 78 9c or 78 01
  if (data[0] === 0x78 && (data[1] === 0x9c || data[1] === 0x01)) {
    return zlibDecompress(data);  // via fflate
  }
  // Try raw deflate
  return rawDeflate(data);
}
```

### Group nickname resolution

```typescript
// Parse ext_buffer protobuf (manual varint decoding)
// Wire format: field 4 → repeated { field 1: wxid, field 2: nickname }
function parseExtBuffer(buffer: Uint8Array): Map<string, string> { ... }

// Priority: remark > group_nickname (ext_buffer) > nick_name (contact table)
```

### Verification (automated)

```bash
# After plugin loads, check via Obsidian developer console:
# 1. Contact count > 0
# 2. At least one conversation has messages
# 3. Text messages parse correctly (no garbled output)
# 4. Type 49 link messages have title extracted
# 5. Decompression works (zstd and zlib)
```

## Phase 3: AI Briefing Engine

### Data flow

```
1. User clicks "Generate Briefing" (or scheduled trigger)
2. Plugin queries all conversations for messages since last briefing
3. Message Extractor parses each message to structured text
4. Messages grouped by conversation, sorted by time
5. Structured text sent to LM Studio local API
6. AI returns briefing markdown
7. Plugin creates note: vault/WeChat-Briefings/YYYY-MM-DD.md
```

### Message-to-text pipeline for AI

```typescript
interface ExtractedMessage {
  time: string;        // "2026-04-16 09:17"
  conversation: string; // "Tech Discussion Group" or "Zhang San"
  sender: string;      // resolved display name
  text: string;        // parsed content (see type parser above)
  type: 'text' | 'voice' | 'link' | 'image' | 'file' | 'system' | 'other';
  extra?: {
    url?: string;         // for links
    description?: string; // for links
    duration?: number;    // for voice/video
    localPath?: string;   // for images
  };
}
```

### AI prompt template

```markdown
You are a personal assistant summarizing WeChat messages.
Generate a daily briefing in Chinese markdown format.

Rules:
- Group by conversation, highlight important discussions
- For links/articles shared, include the title and brief description
- Flag action items or questions directed at the user
- Skip emoji-only messages and trivial greetings
- Keep it concise but don't miss important information

Messages from today:
---
{structured_messages}
---

Output format:
# WeChat Daily Briefing - {date}
## Key Highlights
## By Conversation
### {conversation_name}
...
## Action Items
## Shared Links & Articles
```

### LM Studio integration

```typescript
// LM Studio exposes OpenAI-compatible API at localhost:1234
const response = await fetch('http://localhost:1234/v1/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'loaded-model',  // whatever model is loaded
    messages: [{ role: 'user', content: briefingPrompt }],
    temperature: 0.3,
    max_tokens: 4096,
  }),
});
```

Note: LM Studio must be running on the MacBook with a model loaded. The plugin settings allow configuring the endpoint URL.

### Voice message handling (future enhancement)

For MVP: voice messages show as `[voice Ns]` in the briefing.

Future: integrate local Whisper (via `whisper.cpp` or a Node.js binding) to transcribe voice to text before sending to AI. Requires:
- Converting SILK audio format to WAV
- Running Whisper model locally on M-series chip

### Verification (automated)

```bash
# 1. Briefing note exists in vault after generation
test -f ~/Documents/WeChat-Briefings/$(date +%Y-%m-%d).md && echo "PASS" || echo "FAIL"

# 2. Briefing contains expected sections
grep -c "Key Highlights\|By Conversation\|Action Items" ~/Documents/WeChat-Briefings/$(date +%Y-%m-%d).md
# Expected: >= 3

# 3. LM Studio API is reachable
curl -s http://localhost:1234/v1/models | python3 -c "import sys,json; print('PASS' if json.load(sys.stdin).get('data') else 'FAIL')"
```

## Plugin Settings

```typescript
interface OWHSettings {
  // Database paths
  decryptedDbDir: string;       // default: ~/.wechat-hub/decrypted/
  wechatDataDir: string;        // auto-detected on Mac

  // AI
  aiEndpoint: string;           // default: http://localhost:1234/v1
  aiModel: string;              // default: auto-detect from LM Studio
  briefingPrompt: string;       // customizable

  // Briefing
  briefingFolder: string;       // default: WeChat-Briefings
  briefingTimeRange: number;    // hours to look back, default: 24
  autoGenerate: boolean;        // auto-generate on Obsidian open
  
  // Display
  maxMessagesPerConversation: number; // default: 500
  skipEmoji: boolean;           // default: true
  skipSystemMessages: boolean;  // default: true
}
```

## File Structure

```
wechat-obsidian-plugin/
├── manifest.json
├── package.json
├── tsconfig.json
├── esbuild.config.mjs
├── styles.css
├── src/
│   ├── main.ts                  # Plugin entry point
│   ├── settings.ts              # Settings tab
│   ├── db/
│   │   ├── connector.ts         # sql.js wrapper, DB loading
│   │   ├── contact-reader.ts    # Contact/chatroom queries
│   │   ├── message-reader.ts    # Message queries, table discovery
│   │   └── ext-buffer-parser.ts # Protobuf ext_buffer decoder
│   ├── parser/
│   │   ├── message-parser.ts    # Type dispatcher
│   │   ├── text-parser.ts       # Type 1: text + sender extraction
│   │   ├── media-parser.ts      # Type 3/34/43/47: image/voice/video/emoji
│   │   ├── app-parser.ts        # Type 49: links/files/quotes/miniprogram
│   │   ├── system-parser.ts     # Type 10000/10002
│   │   └── decompressor.ts      # zstd + zlib decompression
│   ├── ai/
│   │   ├── briefing-generator.ts # Orchestrates extraction → AI → note
│   │   ├── llm-client.ts        # LM Studio / OpenAI-compatible API
│   │   └── prompt-templates.ts  # Briefing prompt
│   └── types.ts                 # Shared interfaces
├── scripts/
│   └── decrypt.py               # Mac WeChat decryption helper
└── docs/
```

## Implementation Order

1. **Scaffold** — Obsidian plugin boilerplate, build toolchain
2. **DB Connector** — sql.js loading, read decrypted contact.db
3. **Message Reader** — discover Msg_ tables, read raw rows
4. **Message Parser** — type 1 (text) first, then 49 (links), then rest
5. **Decompressor** — zstd + zlib for compress_content
6. **AI Client** — LM Studio API integration
7. **Briefing Generator** — orchestrate everything, output markdown note
8. **Settings UI** — configuration panel in Obsidian
9. **Decrypt Script** — Python helper for Mac decryption

## Verification Strategy (for autoresearch)

Each phase has automated checks that return PASS/FAIL:

| Phase | Test | Command | Expected |
|-------|------|---------|----------|
| Decrypt | DB readable | `sqlite3 decrypted/contact.db "SELECT count(*) FROM contact"` | number > 0 |
| Connector | sql.js loads | Plugin console: `dbConnector.isReady()` | true |
| Contacts | Contacts loaded | Plugin console: `contactReader.count()` | > 0 |
| Messages | Messages found | Plugin console: `messageReader.getConversations().length` | > 0 |
| Parser | Text parsed | Run parser on type-1 message, check sender+content | non-empty |
| Parser | Links parsed | Run parser on type-49/sub-5, check title | non-empty |
| Decompress | zstd works | Decompress a known compress_content blob | valid XML |
| AI | LM Studio reachable | `curl localhost:1234/v1/models` | 200 OK |
| Briefing | Note generated | Check file exists in vault | file exists |
| Briefing | Sections present | Grep for expected headings | >= 3 matches |
| E2E | Full pipeline | Generate briefing, verify it mentions real contacts | PASS |
