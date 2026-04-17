export class LlmClient {
  private resolvedModel: string | null = null;

  constructor(private endpoint: string, private model: string) {}

  /**
   * Pick a usable model: configured > first non-embedding model from /v1/models.
   */
  async resolveModel(): Promise<string> {
    if (this.model) return this.model;
    if (this.resolvedModel) return this.resolvedModel;

    try {
      const resp = await fetch(`${this.endpoint}/models`);
      if (resp.ok) {
        const data = await resp.json();
        const models: { id: string }[] = data.data || [];
        // Prefer non-embedding models
        const nonEmbedding = models.find(m => !/embed|embedding/i.test(m.id));
        const picked = nonEmbedding?.id || models[0]?.id || '';
        if (picked) {
          this.resolvedModel = picked;
          console.log(`OWH: Auto-selected model: ${picked}`);
          return picked;
        }
      }
    } catch (e) {
      console.error('OWH: Failed to list models:', e);
    }
    return '';
  }

  async complete(prompt: string): Promise<string> {
    // Sanitize: remove null bytes and other control chars that break JSON/HTTP
    const cleanPrompt = prompt.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ' ');

    const model = await this.resolveModel();

    const body = {
      model: model || undefined,
      messages: [{ role: 'user', content: cleanPrompt }],
      temperature: 0.3,
      max_tokens: 4096,
    };

    console.log(`OWH: Sending ${cleanPrompt.length} chars to LLM (${model || 'default'})...`);

    const response = await fetch(`${this.endpoint}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      let errorBody = '';
      try {
        if (typeof response.text === 'function') {
          errorBody = await response.text();
        }
      } catch { /* ignore */ }
      console.error(`OWH: LLM API ${response.status}: ${errorBody}`);

      // Common case: "No models loaded"
      if (errorBody.includes('No models loaded') || errorBody.includes('Please load a model')) {
        throw new Error('LM Studio 没有加载模型。请在 LM Studio 里加载一个模型后重试。');
      }

      throw new Error(`LLM API error: ${response.status}${errorBody ? ' — ' + errorBody.slice(0, 200) : ''}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    // Some thinking models put content in reasoning_content
    if (!content && data.choices?.[0]?.message?.reasoning_content) {
      return data.choices[0].message.reasoning_content;
    }
    return content;
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
