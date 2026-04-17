# Phase B (v0.3.0) — Voice Transcription

## Status

### B1 — Core plumbing (DONE, this commit)

- `src/media/whisper-client.ts` — HTTP client to a local whisper.cpp server
- `src/media/voice-cache.ts` — content-hashed persistent cache
- `src/media/voice-processor.ts` — orchestrator combining the two
- `scripts/start-whisper-server.sh` — one-line server launcher for Mac
- 34 unit + integration tests with mocked fetch and temp-dir cache

No integration with the live message pipeline yet. Proof-of-plumbing only.

### B2 — Live integration (NEXT, deferred)

What's missing before a user can actually see transcripts in their briefings:

1. **Voice file location resolver**
   - WeChat 4.x stores voice files under
     `~/Library/Containers/com.tencent.xinWeChat/Data/Library/Application Support/com.tencent.xinWeChat/<wxid_hash>/Message/MessageTemp/<voice_id>/`
   - Each voice message row references a file ID; need to resolve ID → path
   - Possibly scan `MessageTemp/` by date range as a safety net

2. **.silk → .wav conversion**
   - WeChat voice is `.silk` (Skype SILK codec, variant)
   - whisper.cpp (via ffmpeg) does not decode .silk natively
   - Options:
     - `silk_v3_decoder` CLI (https://github.com/kn007/silk-v3-decoder) — requires external binary
     - `ffmpeg` with libsilk — not in default Homebrew
     - A pure-JS decoder (`silkdecoder` npm) — unproven, may be slow
   - **Recommendation**: shell out to `silk_v3_decoder` via child process, document as a brew tap or manual install

3. **Pipeline wiring** in `src/main.ts` or `src/db/message-reader.ts`:
   - After parsing messages, for every `type === 'voice'` entry:
     - Resolve file path from voice ID
     - Decode .silk → .wav (spawn child process)
     - Pass buffer to `voiceProcessor.transcribe(buf, { language: 'zh' })`
     - Replace `msg.text` from `[voice]` to `[语音转写] <transcript>`
     - On error, preserve original `[语音 N 秒]` placeholder and log
   - Concurrency: fire in parallel (say 4 at a time) to use M-series NEON

4. **Settings UI** in `src/settings.ts`:
   - `enableVoiceTranscription: boolean` (default false — opt-in)
   - `whisperEndpoint: string` (default `http://localhost:8081`)
   - `whisperLanguage: string` (default `zh`)
   - `whisperCacheDir: string` (default `~/.wechat-hub/voice-cache`)
   - Add a "Test whisper connection" button calling `voiceProcessor.isAvailable()`

5. **E2E test on Mac**:
   - Start real whisper server: `bash scripts/start-whisper-server.sh`
   - Manually pick a voice message from a group you know
   - Run `Generate WeChat Briefing` with voice transcription enabled
   - Verify transcript appears in place of `[语音]` placeholder
   - Verify cache persists across runs (second run should be instant)

## Design notes

### Why cache by content hash, not message ID

Same voice can be forwarded between groups with different message IDs.
Hashing the bytes gives us natural dedup.

### Why JSON single-file cache

Expected scale: 100-500 voice messages/day × 1 year = ~150k entries.
Each entry: ~40 bytes hex key + ~100 bytes transcript = ~150 bytes.
Total: ~20MB/year. Well within comfortable JSON read/write limits.
If it ever grows past 50MB, shard by first 2 hex chars.

### Why shell out to a server vs. embedding whisper

- Whisper model weights are ~600MB; embedding into Obsidian plugin bundle is unworkable
- `whisper.cpp` needs Metal / CoreML backend on M-series; hard to run inside Electron
- Separate server is standard practice (LM Studio, Ollama)

### Error policy

- Network down → skip voice, keep `[语音 N 秒]` placeholder, log once per run
- HTTP 4xx → likely format issue; log with first 200 chars of error, skip
- HTTP 5xx → model crashed or out-of-memory; log, skip, DO NOT retry (would cascade)
- Silent audio → whisper returns empty string → cache as `''` so we don't retry

### Multi-modal unification principle

Per VISION.md §3.2 — all modalities go through `text` field of ParsedMessage
before analyst touches them. After transcription:
```ts
msg.text = `[语音转写] ${transcript}`
msg.type = 'text'     // NO — keep 'voice' so filters still work
msg.extra.transcript = transcript    // also preserve for audit
```

Actually keep `type: 'voice'` so Pattern of Life can still count voice vs text
per speaker; just populate `text` with the transcript. The briefing formatter
already handles `[voice]` placeholder — it'll naturally show transcript now.
