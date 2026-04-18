import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { SkillRegistry } from '../../../src/core/skills/skill-registry';
import { defineSkill } from '../../../src/core/skills/skill';

const echoSkill = defineSkill({
  name: 'echo',
  description: 'Return the input verbatim',
  parameters: z.object({ text: z.string() }),
  execute: async ({ text }: { text: string }) => `echoed:${text}`,
});

const upperSkill = defineSkill({
  name: 'upper',
  description: 'Uppercase a string',
  parameters: z.object({ s: z.string() }),
  execute: async ({ s }: { s: string }) => s.toUpperCase(),
});

describe('SkillRegistry', () => {
  it('registers + retrieves skills', () => {
    const r = new SkillRegistry();
    r.register(echoSkill);
    expect(r.get('echo')).toBe(echoSkill);
    expect(r.get('does-not-exist')).toBeUndefined();
    expect(r.list()).toHaveLength(1);
  });

  it('throws on duplicate skill name', () => {
    const r = new SkillRegistry();
    r.register(echoSkill);
    expect(() => r.register(echoSkill)).toThrow(/already registered/);
  });

  it('registerAll bulk-registers', () => {
    const r = new SkillRegistry().registerAll([echoSkill, upperSkill]);
    expect(r.list()).toHaveLength(2);
  });

  it('asTools returns one entry per registered skill', () => {
    const r = new SkillRegistry().registerAll([echoSkill, upperSkill]);
    const tools = r.asTools();
    expect(Object.keys(tools).sort()).toEqual(['echo', 'upper']);
  });

  it('skill execute() runs the function', async () => {
    const r = new SkillRegistry().register(echoSkill);
    const s = r.get('echo')!;
    const result = await s.execute({ text: 'hi' });
    expect(result).toBe('echoed:hi');
  });
});
