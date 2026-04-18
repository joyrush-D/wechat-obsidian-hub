/**
 * Skill — a typed, tool-callable capability the Agent can invoke during
 * its analysis loop.
 *
 * Per user direction: "核心是重用 Agent 框架，需求转化为 Skill". Each
 * analyst capability (look up a person, check if a message was sent by
 * the user, query historical findings) becomes a Skill the Agent can
 * call via OpenAI-compatible tool-calling — handled by vercel/ai SDK
 * which wraps the loop for us.
 *
 * Skill design rules (Voyager / Claude Skills tradition):
 *   - Self-describing: name + plain-language description go to the LLM
 *   - Typed parameters via Zod (used for both LLM tool schema AND TS validation)
 *   - Idempotent execute(): safe to call repeatedly
 *   - Fast: <500ms typical (the LLM may call multiple times per turn)
 *   - Returns string output (LLM-friendly; structured JSON if needed)
 */

import type { z } from 'zod';

export interface Skill<P = any> {
  /** Unique identifier (snake_case). Goes into the tool schema. */
  name: string;
  /** Plain-language description so the model knows when to call. */
  description: string;
  /** Zod schema for the call arguments. Doubles as JSON schema for the LLM. */
  parameters: z.ZodType<P>;
  /** Run the skill. Return a string for the LLM to consume. */
  execute(args: P): Promise<string>;
}

/** Helper to define a Skill with type inference from the Zod schema. */
export function defineSkill<P>(spec: Skill<P>): Skill<P> {
  return spec;
}
