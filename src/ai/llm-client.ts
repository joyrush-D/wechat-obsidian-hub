export class LlmClient {
  constructor(private endpoint: string, private model: string) {}

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
    if (!response.ok) throw new Error(`LLM API error: ${response.status}`);
    const data = await response.json();
    return data.choices[0].message.content;
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
