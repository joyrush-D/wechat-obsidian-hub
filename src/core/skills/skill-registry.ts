/**
 * SkillRegistry — collects Skills and exposes them as vercel/ai SDK tools.
 *
 * The registry is the bridge between our domain-language Skills and the
 * generic agent runtime. The runtime (AgentRunner) just sees `tools` and
 * loops — it doesn't know about WeChat or Findings.
 */

import { tool } from 'ai';
import type { Skill } from './skill';

export class SkillRegistry {
  private skills: Map<string, Skill> = new Map();

  register(skill: Skill): this {
    if (this.skills.has(skill.name)) {
      throw new Error(`Skill "${skill.name}" already registered`);
    }
    this.skills.set(skill.name, skill);
    return this;
  }

  registerAll(skills: Skill[]): this {
    for (const s of skills) this.register(s);
    return this;
  }

  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  list(): Skill[] {
    return [...this.skills.values()];
  }

  /** Expose the registry as the {tools} object vercel/ai SDK expects. */
  asTools(): Record<string, any> {
    const out: Record<string, any> = {};
    for (const s of this.skills.values()) {
      out[s.name] = tool({
        description: s.description,
        inputSchema: s.parameters,
        execute: async (args: unknown) => s.execute(args),
      } as any);
    }
    return out;
  }
}
