export class LlmClient {
  private resolvedModel: string | null = null;

  constructor(private endpoint: string, private model: string) {}

  private failedModels: Set<string> = new Set();
  private candidateModels: string[] = [];

  /**
   * Build candidate model list, sorted by likelihood of being currently loaded.
   * Heuristic: prefer larger qwen models (user typically loads these), then alphabetical.
   */
  async getCandidateModels(): Promise<string[]> {
    if (this.candidateModels.length > 0) return this.candidateModels;
    try {
      const resp = await fetch(`${this.endpoint}/models`);
      if (resp.ok) {
        const data = await resp.json();
        const models: { id: string }[] = data.data || [];
        const filtered = models
          .map(m => m.id)
          .filter(id => !/embed|embedding/i.test(id));

        // Score each model: prefer general-purpose Qwen 3.5 series (most common LM Studio default)
        const scored = filtered.map(id => {
          let score = 0;
          if (/qwen3\.5/i.test(id)) score += 100;       // Qwen 3.5 family preferred
          if (/35b|34b|32b/i.test(id)) score += 50;     // ~35B sweet spot
          if (/a3b/i.test(id)) score += 30;             // active 3B (MoE) — fast
          if (/instruct|chat/i.test(id)) score += 20;
          if (/coder|code/i.test(id)) score -= 10;      // coder models bad for general chat
          if (/122b|70b/i.test(id)) score -= 5;          // very large = slow/may not be loaded
          return { id, score };
        });

        scored.sort((a, b) => b.score - a.score);
        this.candidateModels = scored.map(s => s.id);
        console.log('OWH: Model preference order:', this.candidateModels);
      }
    } catch (e) {
      console.error('OWH: Failed to list models:', e);
    }
    return this.candidateModels;
  }

  /**
   * Pick a usable model: prefer one we've successfully used; otherwise try in order.
   * If user configured a model, use it.
   */
  async resolveModel(): Promise<string> {
    if (this.model) return this.model;
    if (this.resolvedModel && !this.failedModels.has(this.resolvedModel)) {
      return this.resolvedModel;
    }
    const candidates = await this.getCandidateModels();
    for (const c of candidates) {
      if (!this.failedModels.has(c)) {
        this.resolvedModel = c;
        console.log(`OWH: Trying model: ${c}`);
        return c;
      }
    }
    return '';
  }

  /**
   * Mark a model as failed so we skip it next time.
   */
  markFailed(model: string): void {
    if (model) {
      this.failedModels.add(model);
      this.resolvedModel = null;
    }
  }

  async complete(prompt: string, opts: { temperature?: number; maxTokens?: number } = {}): Promise<string> {
    // Sanitize: remove null bytes and other control chars that break JSON/HTTP
    const cleanPrompt = prompt.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ' ');

    // Strategy:
    // 1. If user configured `model`, use it. NO failover.
    // 2. Otherwise, send WITHOUT model field (LM Studio uses currently loaded one).
    // 3. Only failover when explicitly told "No models loaded".
    const model = this.model;

    const body: Record<string, unknown> = {
      messages: [{ role: 'user', content: cleanPrompt }],
      temperature: opts.temperature ?? 0.3,
      max_tokens: opts.maxTokens ?? 8192,
    };
    if (model) body.model = model;

    console.log(`OWH: Sending ${cleanPrompt.length} chars to LM Studio (${model || 'currently loaded'})...`);

    // Note on timeouts:
    //   Obsidian (Electron) uses Chromium's fetch — 5min default, no issue.
    //   Node test harness: undici has 30s headers timeout. Run tests with
    //   NODE_OPTIONS or wrap fetch externally if you hit UND_ERR_HEADERS_TIMEOUT.
    const response = await fetch(`${this.endpoint}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (response.ok) {
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      if (!content && data.choices?.[0]?.message?.reasoning_content) {
        return data.choices[0].message.reasoning_content;
      }
      return content;
    }

    let errorBody = '';
    try {
      if (typeof response.text === 'function') errorBody = await response.text();
    } catch { /* ignore */ }
    console.error(`OWH: LLM API ${response.status}: ${errorBody.slice(0, 300)}`);

    if (errorBody.includes('No models loaded')) {
      throw new Error('LM Studio 没有加载任何模型。请在 LM Studio 里加载一个模型后重试。');
    }
    if (errorBody.includes('context length') || errorBody.includes('token')) {
      throw new Error(`输入过长，超过模型上下文容量。建议减少时间范围或对话数量。原始错误: ${errorBody.slice(0, 100)}`);
    }
    if (errorBody.includes('Failed to load model')) {
      throw new Error(`LM Studio 无法加载指定模型 "${model}"。请检查模型名是否正确，或留空让 LM Studio 用当前加载的模型。`);
    }

    throw new Error(`LLM API error: ${response.status}${errorBody ? ' — ' + errorBody.slice(0, 200) : ''}`);
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.endpoint}/models`);
      if (!response.ok) return false;
      const data = await response.json();
      return Array.isArray(data.data) && data.data.length > 0;
    } catch { return false; }
  }

  async getLoadedModel(): Promise<string | null> {
    try {
      const response = await fetch(`${this.endpoint}/models`);
      if (!response.ok) return null;
      const data = await response.json();
      if (data.data?.length > 0) return data.data[0].id;
    } catch {}
    return null;
  }
}
