export class LlmClient {
  private resolvedModel: string | null = null;

  constructor(private endpoint: string, private model: string) {}

  private failedModels: Set<string> = new Set();
  private candidateModels: string[] = [];

  /**
   * Build candidate model list (non-embedding), excluding ones we've seen fail.
   */
  async getCandidateModels(): Promise<string[]> {
    if (this.candidateModels.length > 0) return this.candidateModels;
    try {
      const resp = await fetch(`${this.endpoint}/models`);
      if (resp.ok) {
        const data = await resp.json();
        const models: { id: string }[] = data.data || [];
        this.candidateModels = models
          .map(m => m.id)
          .filter(id => !/embed|embedding/i.test(id));
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

  async complete(prompt: string): Promise<string> {
    // Sanitize: remove null bytes and other control chars that break JSON/HTTP
    const cleanPrompt = prompt.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ' ');

    // Try with model failover: if a model fails to load, try the next one
    const maxAttempts = 5;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const model = await this.resolveModel();

      const body = {
        model: model || undefined,
        messages: [{ role: 'user', content: cleanPrompt }],
        temperature: 0.3,
        max_tokens: 4096,
      };

      console.log(`OWH: Sending ${cleanPrompt.length} chars to LLM (${model || 'default'}, attempt ${attempt + 1})...`);

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
      console.error(`OWH: LLM API ${response.status}: ${errorBody.slice(0, 200)}`);

      // Determine if this is a per-model failure (worth trying another model)
      const isModelFailure =
        errorBody.includes('Failed to load model') ||
        errorBody.includes('model has crashed') ||
        errorBody.includes('No models loaded');

      if (isModelFailure && model) {
        console.log(`OWH: Model "${model}" failed, trying another...`);
        this.markFailed(model);
        lastError = new Error(`LLM API error: ${response.status} (${model})`);
        continue;  // try next model
      }

      // Other error types (like 5xx, content too long) — don't retry
      throw new Error(`LLM API error: ${response.status}${errorBody ? ' — ' + errorBody.slice(0, 200) : ''}`);
    }

    throw lastError || new Error('All models failed to respond. Please load a model in LM Studio.');
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
