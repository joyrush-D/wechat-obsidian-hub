/**
 * VlmClient — multimodal LLM client via OpenAI-compatible /chat/completions.
 *
 * Target backend: LM Studio with a vision-capable model loaded
 * (Qwen2.5-VL-7B recommended for Chinese scenes). The same endpoint that
 * serves text-only LLM calls handles vision via LM Studio's JIT model
 * loading — the plugin just needs to specify the right `model` field.
 *
 * Request shape (per OpenAI vision spec, which LM Studio 0.3.x supports):
 *   POST /chat/completions
 *   {
 *     "model": "qwen2.5-vl-7b",
 *     "messages": [{
 *       "role": "user",
 *       "content": [
 *         {"type": "text", "text": "<prompt>"},
 *         {"type": "image_url", "image_url": {"url": "data:image/png;base64,<b64>"}}
 *       ]
 *     }],
 *     "temperature": 0.3,
 *     "max_tokens": 500
 *   }
 */

import { Buffer } from 'buffer';

export interface VlmOptions {
  /** Prompt text; defaults to analyst-oriented Chinese description prompt. */
  prompt?: string;
  /** MIME type of the image. Defaults to image/png. */
  contentType?: string;
  /** Max tokens cap for the description. Defaults to 500 (plenty for a paragraph). */
  maxTokens?: number;
}

const DEFAULT_PROMPT =
  '请简洁地用中文描述这张图片的内容，重点关注情报价值：' +
  '（1）出现的人物 / 物品 / 场景；' +
  '（2）图中可见的文字 / 数字 / 时间；' +
  '（3）任何异常或值得注意的线索。' +
  '不要虚构，无法判断的写"不可辨识"。';

export class VlmClient {
  readonly endpoint: string;
  private readonly model: string;

  constructor(endpoint: string, model: string) {
    this.endpoint = endpoint.replace(/\/+$/, '');
    this.model = model;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const resp = await fetch(`${this.endpoint}/models`);
      if (!resp.ok) return false;
      const body: { data?: unknown } = await resp.json();
      return Array.isArray(body.data) && body.data.length > 0;
    } catch {
      return false;
    }
  }

  async describe(image: Uint8Array, opts: VlmOptions = {}): Promise<string> {
    const prompt = opts.prompt || DEFAULT_PROMPT;
    const mime = opts.contentType || 'image/png';
    const base64 = Buffer.from(image).toString('base64');
    const dataUrl = `data:${mime};base64,${base64}`;

    const payload: Record<string, unknown> = {
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      }],
      temperature: 0.3,
      max_tokens: opts.maxTokens ?? 500,
    };
    if (this.model) payload.model = this.model;

    const resp = await fetch(`${this.endpoint}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      throw new Error(`VLM API error: ${resp.status} ${detail.slice(0, 200)}`);
    }

    const body: { choices?: Array<{ message?: { content?: string } }> } = await resp.json();
    const text = body.choices?.[0]?.message?.content ?? '';
    return text.trim();
  }
}
