export class LlmClient {
  constructor(private endpoint: string, private model: string) {}

  async complete(prompt: string): Promise<string> {
    // Sanitize: remove null bytes and other control chars that break JSON/HTTP
    const cleanPrompt = prompt.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ' ');

    const body = {
      model: this.model || undefined,
      messages: [{ role: 'user', content: cleanPrompt }],
      temperature: 0.3,
      max_tokens: 4096,
    };

    console.log(`OWH: Sending ${cleanPrompt.length} chars to LLM...`);

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
