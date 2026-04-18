/**
 * AgentRunner — thin wrapper around vercel/ai SDK's generateText with
 * tool-calling loop. Lets us run a ReAct-style agent against any
 * OpenAI-compatible endpoint (including LM Studio with Hermes-4).
 *
 * The SDK handles:
 *   - Tool schema → LLM
 *   - Parsing tool calls from the response
 *   - Executing the tools
 *   - Feeding observations back
 *   - Looping until model returns final answer or maxSteps reached
 *
 * We just register the Skills, configure the model client, and call run().
 */

import { generateText, stepCountIs } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { SkillRegistry } from '../skills/skill-registry';

export interface AgentRunnerConfig {
  /** OpenAI-compatible base URL (LM Studio default: http://localhost:1234/v1). */
  baseURL: string;
  /** Model id; can be empty to let LM Studio pick the loaded model. */
  modelId: string;
  /** Skills the agent may call. */
  skills: SkillRegistry;
  /** Cap on tool-call iterations. Default 10. */
  maxSteps?: number;
  /** Sampling temperature. Default 0.1 for structured / verification work. */
  temperature?: number;
}

export interface AgentRunResult {
  /** Final text returned by the model after tool calls (or '' on failure). */
  text: string;
  /** Total tool calls executed across all steps. */
  toolCallCount: number;
  /** Number of generate-respond cycles. */
  steps: number;
  /** Set when the loop exited due to an error rather than completion. */
  error?: string;
}

export class AgentRunner {
  private modelProvider: ReturnType<typeof createOpenAICompatible>;
  private skills: SkillRegistry;
  private modelId: string;
  private maxSteps: number;
  private temperature: number;

  constructor(cfg: AgentRunnerConfig) {
    // LM Studio doesn't require an API key but @ai-sdk/openai-compatible
    // expects one — passing 'lm-studio' as a stub is the conventional fix.
    this.modelProvider = createOpenAICompatible({
      name: 'lm-studio',
      baseURL: cfg.baseURL,
      apiKey: 'lm-studio',
    });
    this.skills = cfg.skills;
    this.modelId = cfg.modelId;
    this.maxSteps = cfg.maxSteps ?? 10;
    this.temperature = cfg.temperature ?? 0.1;
  }

  /**
   * Run the agent with a user prompt and an optional system prompt.
   * Tools available come from the SkillRegistry.
   */
  async run(prompt: string, systemPrompt?: string): Promise<AgentRunResult> {
    try {
      // generateText with stopWhen runs the tool loop for us
      const tools = this.skills.asTools();
      const result = await generateText({
        model: this.modelProvider(this.modelId || 'auto'),
        system: systemPrompt,
        prompt,
        tools,
        stopWhen: stepCountIs(this.maxSteps),
        temperature: this.temperature,
      });
      return {
        text: result.text || '',
        toolCallCount: countToolCalls(result),
        steps: (result as any).steps?.length ?? 1,
      };
    } catch (e) {
      return {
        text: '',
        toolCallCount: 0,
        steps: 0,
        error: (e as Error).message,
      };
    }
  }
}

function countToolCalls(result: any): number {
  if (Array.isArray(result.toolCalls)) return result.toolCalls.length;
  if (Array.isArray(result.steps)) {
    return result.steps.reduce(
      (sum: number, step: any) => sum + (step.toolCalls?.length ?? 0),
      0,
    );
  }
  return 0;
}
