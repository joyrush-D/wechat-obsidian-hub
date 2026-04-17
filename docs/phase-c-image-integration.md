# Phase C (v0.3.0) — Image Analysis (OCR + VLM)

## Status

### C1 — Core plumbing (DONE, this commit)

- `src/media/image-router.ts` — heuristic OCR-vs-VLM classifier (pure function)
- `src/media/ocr-client.ts` — HTTP client for a local OCR server
- `src/media/vlm-client.ts` — multimodal LLM client via OpenAI-compatible API
- `src/media/image-processor.ts` — orchestrator with (route, content-hash) caching
- 52 unit + integration tests (router 17, ocr 13, vlm 14, processor 8)

No integration with the live message pipeline yet. Proof-of-plumbing only.

### C2 — Live integration (NEXT, deferred)

What's missing before a user can actually see image analysis in briefings:

1. **Image file location resolver**
   - WeChat 4.x stores images under
     `~/Library/Containers/com.tencent.xinWeChat/.../Message/MessageTemp/<image_id>/Image/`
   - Database row `type=3` messages contain an XML `<msg><img>` with file ID or md5
   - Need to join msg metadata → disk path

2. **Image dimension extraction**
   - `image-router` needs `width`/`height` for aspect-ratio heuristic
   - Options:
     - Read first few bytes of file (PNG/JPEG headers) — small pure-JS lib `image-size` (~5KB)
     - Trust DB's stored dimensions if present (in `extra`?)
   - Even without dims, the router falls back to VLM (conservative default), so
     dimension extraction is an optimization, not a blocker

3. **OCR server choice**
   - Recommended: `RapidOCR-json` (https://github.com/hiroi-sora/RapidOCR-json)
   - Runs standalone, accepts POST /ocr with multipart, returns `{text, paragraphs}`
   - Alternative: embed onnxruntime-node + `rapidocr-onnxruntime` (pulls in ~50MB binaries)
   - macOS alternative: Vision framework via `node-vision-ocr` (native binding)
   - Start with RapidOCR-json for zero-dep plugin bundle

4. **VLM setup**
   - LM Studio 0.3.x with `qwen2.5-vl-7b` loaded (6GB in Q4, JIT-loaded on request)
   - Same endpoint as text model (1234), just different `model` field in payload
   - Settings need to distinguish text model vs VLM model; default `model: ''` lets
     LM Studio auto-select based on whether image is in the request

5. **Pipeline wiring** in `src/main.ts`:
   - After parsing, for every `type === 'image'` entry:
     - Read image file from path
     - Extract dimensions (optional)
     - Call `imageProcessor.analyze(buf, { width, height, filename })`
     - On OCR: `msg.text = '[图片文字] ' + result.text` (or keep empty if nothing readable)
     - On VLM: `msg.text = '[图片描述] ' + result.text`
     - On error: preserve `[图片]` placeholder
   - Concurrency: 4 in parallel is safe; VLM needs LM Studio to swap model which
     serializes, so don't go too wide

6. **Settings UI** in `src/settings.ts`:
   - `enableImageAnalysis: boolean` (default false — opt-in)
   - `ocrEndpoint: string` (default `http://localhost:8090`)
   - `ocrLanguage: string` (default `ch`)
   - `vlmEndpoint: string` (default `http://localhost:1234/v1` — same as text LLM)
   - `vlmModel: string` (default `''` — auto-select)
   - `imageCacheDir: string` (default `~/.wechat-hub/image-cache`)
   - "Test OCR" / "Test VLM" buttons

7. **Mac E2E test**:
   - Start RapidOCR-json: `./RapidOCR-json.exe` (port 8090)
   - LM Studio: load `qwen2.5-vl-7b`, keep qwen3.5-35b loaded, JIT will swap
   - Run Generate WeChat Briefing with image analysis enabled
   - Verify screenshots get OCR text, photos get VLM descriptions
   - Verify cache hits on re-run

## Design notes

### Why per-route cache keys (`ocr:hash`, `vlm:hash`)

The same image can be analyzed both ways — e.g., a poster with text: OCR gets
the text, VLM describes the scene. Caching them separately lets users opt-in
to dual analysis without re-running the expensive first pass.

### Why VLM via the same LM Studio endpoint as text

LM Studio's JIT auto-loads the right model based on the `model` field and the
presence of image content parts. This lets a single server host both text (35B)
and vision (7B) models, swapping as needed. 64GB Mac can hold both resident.

### Why HTTP OCR, not in-process ONNX

- Plugin bundle stays pure JS (~150KB) vs +50MB for onnxruntime-node platform binaries
- OCR server choice stays flexible (RapidOCR / PaddleOCR / macOS Vision)
- No native compilation headaches across macOS / Linux / Windows

### Performance budget (per VISION.md)

Per research report B (docs/research/2026-04-17-local-av-processing.md):
- 80 screenshots × 0.2s (OCR) = 16s
- 20 photos × 3s (VLM) = 60s
- Total ~76s added to briefing generation
- VLM dominates; batch in parallel 4-way to reduce wall clock to ~20s

### Error policy (same as Phase B)

- Network down → skip, keep `[图片]` placeholder, log once
- HTTP 4xx → log first 200 chars, skip (likely format issue)
- HTTP 5xx → skip, DO NOT retry
- Timeout (VLM >15s) → skip with warning

### Multimodal unification

Per VISION.md §3.2 — all modalities flow through `text` field of ParsedMessage:
```ts
if (result.route === 'ocr') {
  msg.text = result.text ? `[图片文字] ${result.text}` : '[图片：无可识别文字]';
} else {
  msg.text = result.text ? `[图片描述] ${result.text}` : '[图片：描述失败]';
}
msg.extra.image_analysis = result.text;
msg.extra.image_analysis_route = result.route;
```

Type stays `'image'` so Pattern of Life can still count image-sharing activity.
