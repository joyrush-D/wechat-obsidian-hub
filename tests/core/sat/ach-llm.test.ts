import { describe, it, expect } from 'vitest';
import {
  buildHypothesisGenerationPrompt,
  parseHypotheses,
  buildEvidenceMarkingPrompt,
  parseMarkings,
  composeMatrix,
} from '../../../src/core/sat/ach-llm';
import { getMark } from '../../../src/core/sat/ach';

describe('buildHypothesisGenerationPrompt', () => {
  it('includes topic and all evidence', () => {
    const prompt = buildHypothesisGenerationPrompt(
      'is the rumor real?',
      [
        { id: 'e1', description: 'first evidence', grade: 'B2' },
        { id: 'e2', description: 'second evidence' },
      ],
    );
    expect(prompt).toContain('is the rumor real?');
    expect(prompt).toContain('first evidence');
    expect(prompt).toContain('[B2]');
    expect(prompt).toContain('second evidence');
  });

  it('requires a null hypothesis', () => {
    const prompt = buildHypothesisGenerationPrompt('x', []);
    expect(prompt).toMatch(/null 假设/);
  });

  it('requires JSON-only output', () => {
    const prompt = buildHypothesisGenerationPrompt('x', []);
    expect(prompt).toMatch(/仅 JSON/);
  });
});

describe('parseHypotheses', () => {
  it('parses well-formed JSON array', () => {
    const out = parseHypotheses(`[
      {"id": "h1", "statement": "APT28 做的"},
      {"id": "h2", "statement": "内鬼"},
      {"id": "h3", "statement": "随机", "isNull": true}
    ]`);
    expect(out).toHaveLength(3);
    expect(out[0].id).toBe('h1');
    expect(out[2].isNull).toBe(true);
  });

  it('strips ```json fences', () => {
    const out = parseHypotheses('```json\n[{"id":"h1","statement":"x"}]\n```');
    expect(out).toHaveLength(1);
  });

  it('tolerates preamble text', () => {
    const out = parseHypotheses('好的，结果：\n[{"id":"h1","statement":"x"}]\n说明：...');
    expect(out).toHaveLength(1);
  });

  it('skips rows without statement', () => {
    const out = parseHypotheses('[{"id":"h1"},{"id":"h2","statement":"ok"}]');
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('h2');
  });

  it('auto-generates id when missing', () => {
    const out = parseHypotheses('[{"statement":"first"},{"statement":"second"}]');
    expect(out[0].id).toBe('h1');
    expect(out[1].id).toBe('h2');
  });

  it('returns empty array for malformed input', () => {
    expect(parseHypotheses('')).toEqual([]);
    expect(parseHypotheses('not json')).toEqual([]);
    expect(parseHypotheses('{"not": "array"}')).toEqual([]);
  });

  it('coerces isNull only when strictly true', () => {
    const out = parseHypotheses('[{"statement":"x","isNull":"true"},{"statement":"y","isNull":true}]');
    expect(out[0].isNull).toBe(false);   // string "true" is not === true
    expect(out[1].isNull).toBe(true);
  });
});

describe('buildEvidenceMarkingPrompt', () => {
  it('includes all hypotheses and evidence', () => {
    const prompt = buildEvidenceMarkingPrompt(
      'topic',
      [{ id: 'h1', statement: 'first h' }, { id: 'h2', statement: 'second h' }],
      [{ id: 'e1', description: 'first e' }, { id: 'e2', description: 'second e' }],
    );
    expect(prompt).toContain('first h');
    expect(prompt).toContain('second h');
    expect(prompt).toContain('first e');
    expect(prompt).toContain('second e');
  });

  it('mentions expected cell count', () => {
    const prompt = buildEvidenceMarkingPrompt(
      'x',
      [{ id: 'h1', statement: 'a' }, { id: 'h2', statement: 'b' }],
      [{ id: 'e1', description: 'x' }, { id: 'e2', description: 'y' }, { id: 'e3', description: 'z' }],
    );
    expect(prompt).toContain('6 条标签');   // 2 hyp × 3 ev = 6
  });

  it('marks null hypotheses in the prompt', () => {
    const prompt = buildEvidenceMarkingPrompt('x', [
      { id: 'h1', statement: 'claim', isNull: false },
      { id: 'h2', statement: 'random', isNull: true },
    ], []);
    expect(prompt).toContain('(null)');
  });
});

describe('parseMarkings', () => {
  it('parses well-formed JSON object', () => {
    const out = parseMarkings(`{
      "h1:e1": "C",
      "h1:e2": "I",
      "h2:e1": "N",
      "h2:e2": "C"
    }`);
    expect(out['h1:e1']).toBe('C');
    expect(out['h1:e2']).toBe('I');
    expect(out['h2:e1']).toBe('N');
  });

  it('strips ```json fences', () => {
    const out = parseMarkings('```json\n{"h1:e1":"C"}\n```');
    expect(out['h1:e1']).toBe('C');
  });

  it('drops invalid mark values', () => {
    const out = parseMarkings('{"h1:e1":"C","h1:e2":"maybe","h2:e1":"I"}');
    expect(out['h1:e1']).toBe('C');
    expect(out['h1:e2']).toBeUndefined();
    expect(out['h2:e1']).toBe('I');
  });

  it('drops keys without colon separator', () => {
    const out = parseMarkings('{"h1e1":"C","h1:e1":"I"}');
    expect(out['h1e1']).toBeUndefined();
    expect(out['h1:e1']).toBe('I');
  });

  it('returns empty object for malformed input', () => {
    expect(parseMarkings('')).toEqual({});
    expect(parseMarkings('[1,2,3]')).toEqual({});
    expect(parseMarkings('not json')).toEqual({});
  });
});

describe('composeMatrix', () => {
  const hyp = [{ id: 'h1', statement: 'a' }, { id: 'h2', statement: 'b' }];
  const ev = [{ id: 'e1', description: 'x' }, { id: 'e2', description: 'y' }];

  it('applies all valid markings', () => {
    const m = composeMatrix(hyp, ev, { 'h1:e1': 'C', 'h2:e2': 'I' });
    expect(getMark(m, 'e1', 'h1')).toBe('C');
    expect(getMark(m, 'e2', 'h2')).toBe('I');
    // Missing markings default to N
    expect(getMark(m, 'e2', 'h1')).toBe('N');
    expect(getMark(m, 'e1', 'h2')).toBe('N');
  });

  it('silently drops markings for unknown hypothesis or evidence', () => {
    const m = composeMatrix(hyp, ev, {
      'h1:e1': 'C',
      'h99:e1': 'C',     // unknown hypothesis
      'h1:e99': 'I',     // unknown evidence
      'h1:': 'C',        // malformed
    });
    expect(Object.keys(m.marks)).toEqual(['h1:e1']);
  });
});
