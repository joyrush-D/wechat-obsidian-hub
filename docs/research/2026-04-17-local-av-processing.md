# 微信 OWH 插件 - 语音与图像处理方案调研报告

> 目标平台：MacBook Pro Apple Silicon（M 系列，64GB+ RAM），macOS 14+，Obsidian 插件运行时为 Node.js；现有 LM Studio 托管 `qwen3.5-35b-a3b` 做文本简报。

**调研时间**：2026-04-17

---

## 1. 语音转写（ASR）方案

### 1.1 候选引擎横评（Apple Silicon）

| 引擎 | 后端 | M 系列加速 | 中文效果 | 备注 |
|---|---|---|---|---|
| **mlx-whisper** | Apple MLX | Metal + ANE 优先 | 与 OpenAI 原版对齐 | Apple 官方团队维护，M 芯片最快 |
| **faster-whisper** | CTranslate2 | Metal（有限） | 原版对齐 | 跨平台首选，但在 Apple Silicon 上 GPU 利用率不如 MLX |
| **whisper.cpp** | ggml + Metal | Metal 着色器完备 | 原版对齐 | 极低内存、可量化到 Q5_0；CLI/绑定成熟 |
| **WhisperKit** | Core ML + ANE | ANE 全开 | 原版对齐 | Argmax 出品，Swift 原生；Node 端集成麻烦 |
| **Whisper.cpp (turbo)** | ggml | Metal | **略优于 large-v2** | 速度接近 tiny |

关键 GitHub：
- `ggerganov/whisper.cpp` — https://github.com/ggerganov/whisper.cpp（v1.7.x 起内置 `-m ggml-large-v3-turbo.bin`）
- `ml-explore/mlx-examples/whisper` — https://github.com/ml-explore/mlx-examples/tree/main/whisper
- `SYSTRAN/faster-whisper` — https://github.com/SYSTRAN/faster-whisper
- `argmaxinc/WhisperKit` — https://github.com/argmaxinc/WhisperKit

### 1.2 模型规格对比（M2 Pro/Max 实测量级）

| 模型 | 参数 | 权重（FP16 / Q5） | 速度 (RTF)※ | 中文 WER (AISHELL-1) | 备注 |
|---|---|---|---|---|---|
| `large-v3` | 1.55B | 3.1 GB / ~1.1 GB | 0.15–0.25x | 5–7% | 基线最准 |
| **`large-v3-turbo`** | 0.81B | 1.6 GB / ~600 MB | **0.05–0.08x** | 6–8% | 4 层 decoder，OpenAI 2024.10 发布，**推荐** |
| `distil-large-v3` | 0.76B | 1.5 GB | 0.04–0.07x | 7–9%，**中文偏弱** | 蒸馏主要在英文 |
| `medium` | 769M | 1.5 GB | 0.1x | 8–10% | 不如 turbo |
| `small` | 244M | 488 MB | 0.04x | 12–15% | 不够用 |

※ RTF (Real-Time Factor) = 推理耗时 / 音频时长。

**结论**：中文场景 `distil-large-v3` 不合适（英文蒸馏），`large-v3-turbo` 是速度/精度/内存的最佳平衡点。

### 1.3 短语音 vs 长语音

- **短语音（5–60s，微信主流）**：直接送入模型，不需要 VAD；whisper.cpp 内置的 30s 窗口足够。单条 15s 音频在 M2 Max + turbo 下约 0.8–1.2s。
- **长语音（> 2 分钟，录音/会议）**：建议前置 VAD 切分，避免 Whisper 的"幻觉"和时间戳漂移。
  - VAD 推荐 **Silero VAD**（https://github.com/snakers4/silero-vad）
  - whisper.cpp 自 v1.6 起内置 `--vad` 选项

### 1.4 推荐组合

**`whisper.cpp` (v1.7+) + `ggml-large-v3-turbo-q5_0.bin` + 内置 VAD**

理由：Metal 加速完善、Q5_0 量化后仅 ~600MB、Node.js 可通过子进程或 `whisper-node` 调用、中文 WER 可接受、**无 Python 依赖**。

---

## 2. 图像 OCR / 理解方案

### 2.1 路线 A — 独立 OCR

| 工具 | 中文精度 | 速度 | 集成难度 | 备注 |
|---|---|---|---|---|
| **PaddleOCR PP-OCRv4** | **业界最强中文** | 单图 0.1–0.3s | 中等（Python） | `ch_PP-OCRv4_server_rec` 优于 `_mobile` |
| **macOS Vision Framework** | 良好（iOS17+ 改善） | **极快**（ANE） | **零依赖** | 唯一原生方案 |
| Tesseract 5 + chi_sim | 一般（版面差） | 慢 | 简单 | 不推荐主力 |
| **RapidOCR (ONNX)** | 接近 PP-OCRv4 | 0.1s | **Node 可直接 onnxruntime-node** | PaddleOCR 的 ONNX 移植 |

### 2.2 路线 B — 本地 VLM

| 模型 | 参数 | 中文能力 | LM Studio | Ollama | 内存 (Q4) |
|---|---|---|---|---|---|
| **Qwen2.5-VL-7B** | 7B | **极强**（阿里原生） | 支持 0.3.x+ | 支持 `qwen2.5vl` | ~6 GB |
| **Qwen2.5-VL-32B/72B** | 32/72B | 顶级 | 支持 | 支持 | 20/45 GB |
| **MiniCPM-V 2.6** | 8B | 强（清华面壁） | 支持 | 支持 `minicpm-v` | ~6 GB |
| **InternVL 2.5-8B** | 8B | 强 | 部分 | 第三方 GGUF | ~7 GB |
| Llama 3.2-11B-Vision | 11B | **中文弱** | 支持 | 支持 | ~8 GB |

### 2.3 场景对照

| 微信场景 | 推荐路线 | 理由 |
|---|---|---|
| **纯文字截图** | OCR（RapidOCR） | 快 10–20 倍、准 |
| **带文字的生活照** | OCR + VLM 融合 | OCR 抽字，VLM 描述 |
| **表情包** | VLM | 需要语义理解 |
| **生活照/风景/人物** | VLM | 需要描述 |
| **文档扫描/PDF 页** | OCR（RapidOCR） | 版面分析精准 |
| **二维码** | `zxing` / `zbar` | VLM 不擅长解码 |

### 2.4 推荐组合

**双路由：分类器 → OCR 或 VLM**
- 前置轻量判断（图像尺寸比 + 边缘密度）决定走哪条
- **OCR 主力：RapidOCR (PP-OCRv4 ONNX) via `onnxruntime-node`**（纯 Node，无 Python）
- **VLM 主力：Qwen2.5-VL-7B-Instruct-4bit**，与简报模型同家族
- 二维码：`@zxing/library` 独立处理

---

## 3. 集成架构

### 3.1 LM Studio 多模型能力

- LM Studio 0.3.5+ 支持 **Just-In-Time (JIT) 模型加载**
- 64GB 机器可并存 `qwen3.5-35b-a3b`（~20GB Q4）+ `qwen2.5-vl-7b`（~6GB）
- **不支持 Whisper**：LM Studio 专注 LLM/VLM

### 3.2 替代运行时

| 方案 | 多模型 | 音频 | 推荐度 |
|---|---|---|---|
| **LM Studio** | 是（JIT） | **否** | 文本+VLM 首选 |
| **Ollama** | 是（自动） | **否** | 良好替代 |
| **`whisper.cpp` server** | — | **是** | ASR 独立进程 |

### 3.3 最省事的编排方案

```
┌─ Obsidian 插件 (Node.js)
│   ├── HTTP → LM Studio :1234
│   │          ├─ qwen3.5-35b-a3b   (文本简报)
│   │          └─ qwen2.5-vl-7b     (VLM，JIT 加载)
│   ├── HTTP → whisper.cpp server :8081
│   │          └─ large-v3-turbo-q5_0
│   └── 子进程 → RapidOCR (onnxruntime-node，进程内)
```

---

## 4. 性能预算

**假设**：1000 条消息/天，含 50 条语音（平均 15s）+ 100 张图片（80 截图 + 20 生活照）。硬件 M2 Max / 64GB。

| 任务 | 单次耗时 | 数量 | 合计 |
|---|---|---|---|
| ASR（turbo, RTF 0.07） | ~1.0s/条 | 50 | **~50s** |
| OCR（RapidOCR） | ~0.2s | 80 | **~16s** |
| VLM（Qwen2.5-VL-7B） | ~3s/图 | 20 | **~60s** |
| 文本简报 | — | 1 次 | ~60–120s |
| **总耗时** | | | **约 3.5–4.5 分钟** |

**内存峰值**：约 32 GB（64GB 机器从容）。

---

## 5. 三档推荐方案

### 方案 A — 最简
- ASR：`whisper.cpp` CLI + turbo
- 图像：**全部走 Qwen2.5-VL-7B**，不做路由
- 代价：截图文字抽取慢、偶尔漏字

### 方案 B — 平衡（**推荐**）
- ASR：`whisper.cpp` **server** + turbo + 内置 VAD
- 图像：**RapidOCR** 处理截图/文档 + **Qwen2.5-VL-7B** 处理生活照/表情包
- 优点：速度/精度/内存三者兼顾

### 方案 C — 极致
- ASR：`whisper.cpp` + `large-v3` FP16 + Silero VAD
- 图像：PaddleOCR server + **Qwen2.5-VL-32B**
- 代价：内存 ~50GB、耗时翻倍、需 Python

---

**推荐**：**方案 B**。turbo 中文 WER 够用、RapidOCR 纯 Node 避免 Python 依赖、LM Studio JIT 让 VLM 按需加载。
