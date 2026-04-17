/**
 * LlmAdapter — abstracts the language model backend so the Agent can
 * run against LM Studio (local), Ollama, Claude API, OpenAI, etc.
 *
 * The shape is deliberately small: complete() for text, describeImage()
 * for vision, transcribe() for audio (if available). This mirrors the
 * three modalities the Agent cares about.
 */

export interface LlmCompleteOptions {
  /** Override model if the adapter supports routing. */
  model?: string;
  /** Sampling temperature. 0 = deterministic, 1 = creative. */
  temperature?: number;
  /** Cap on output tokens. */
  maxTokens?: number;
  /** System prompt / persona. */
  system?: string;
}

export interface LlmAdapter {
  /** Adapter identifier, e.g. 'lm-studio', 'anthropic', 'ollama'. */
  readonly id: string;

  /** Quick health/readiness check. */
  isAvailable(): Promise<boolean>;

  /** Text → text completion. */
  complete(prompt: string, opts?: LlmCompleteOptions): Promise<string>;

  /** Optional: multimodal image → description. null if adapter lacks vision. */
  describeImage?(image: Uint8Array, prompt?: string, opts?: LlmCompleteOptions): Promise<string>;

  /** Optional: audio → transcript. null if adapter lacks ASR. */
  transcribe?(audio: Uint8Array, language?: string): Promise<string>;

  /** Optional: model list for UI. */
  listModels?(): Promise<string[]>;
}
