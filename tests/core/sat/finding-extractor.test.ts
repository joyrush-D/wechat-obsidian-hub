/**
 * Tests for the Finding extractor — turns LLM JSON into validated Finding[].
 */
import { describe, it, expect } from 'vitest';
import { buildFindingsExtractionPrompt, parseFindings } from '../../../src/core/sat/finding-extractor';

const VALID_FINDING_JSON = `[
  {
    "judgment": "罗俊高度可能本周出差深圳",
    "kentPhrase": "highly likely",
    "probRange": [80, 92],
    "sourceGrade": "B2",
    "evidenceRefs": [
      { "entityId": "msg:wechat:g1@chatroom:42", "stance": "supports", "grade": "B2", "quote": "订好机票了" }
    ],
    "assumptions": [
      { "statement": "行程未被取消", "confidence": "solid" }
    ],
    "dissentingView": null
  }
]`;

describe('buildFindingsExtractionPrompt', () => {
  it('contains the briefing markdown verbatim', () => {
    const prompt = buildFindingsExtractionPrompt('## 简报\n今日无事');
    expect(prompt).toContain('## 简报');
    expect(prompt).toContain('今日无事');
  });

  it('lists all 7 Kent phrases with probability ranges', () => {
    const prompt = buildFindingsExtractionPrompt('x');
    expect(prompt).toContain('almost certain');
    expect(prompt).toContain('highly likely');
    expect(prompt).toContain('likely');
    expect(prompt).toContain('roughly even chance');
    expect(prompt).toContain('unlikely');
    expect(prompt).toContain('highly unlikely');
    expect(prompt).toContain('almost no chance');
  });

  it('is in Chinese for Chinese briefing context', () => {
    expect(/[\u4e00-\u9fff]/.test(buildFindingsExtractionPrompt('x'))).toBe(true);
  });
});

describe('parseFindings', () => {
  it('parses a well-formed JSON array', () => {
    const { findings, errors } = parseFindings(VALID_FINDING_JSON);
    expect(errors).toEqual([]);
    expect(findings).toHaveLength(1);
    expect(findings[0].judgment).toBe('罗俊高度可能本周出差深圳');
    expect(findings[0].kentPhrase).toBe('highly likely');
    expect(findings[0].probRange).toEqual([80, 92]);
    expect(findings[0].sourceGrade).toBe('B2');
    expect(findings[0].evidenceRefs[0].entityId).toBe('msg:wechat:g1@chatroom:42');
    expect(findings[0].evidenceRefs[0].quote).toBe('订好机票了');
    expect(findings[0].assumptions).toHaveLength(1);
  });

  it('generates deterministic id from judgment text', () => {
    const r1 = parseFindings(VALID_FINDING_JSON, { createdAt: '2026-04-18T10:00:00Z' });
    const r2 = parseFindings(VALID_FINDING_JSON, { createdAt: '2026-04-18T10:00:00Z' });
    expect(r1.findings[0].id).toBe(r2.findings[0].id);
  });

  it('attaches reportId when provided', () => {
    const { findings } = parseFindings(VALID_FINDING_JSON, { reportId: 'rep-123' });
    expect(findings[0].reportId).toBe('rep-123');
  });

  it('strips markdown code fences', () => {
    const fenced = '```json\n' + VALID_FINDING_JSON + '\n```';
    const { findings, errors } = parseFindings(fenced);
    expect(errors).toEqual([]);
    expect(findings).toHaveLength(1);
  });

  it('tolerates preamble text and extracts the JSON array', () => {
    const withPreamble = '好的，这里是结果：\n' + VALID_FINDING_JSON + '\n注：仅供参考。';
    const { findings, errors } = parseFindings(withPreamble);
    expect(errors).toEqual([]);
    expect(findings).toHaveLength(1);
  });

  it('empty input yields empty findings + error', () => {
    const { findings, errors } = parseFindings('');
    expect(findings).toHaveLength(0);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('malformed JSON yields empty findings + error', () => {
    const { findings, errors } = parseFindings('[{"judgment": "x"'); // unclosed
    expect(findings).toHaveLength(0);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('non-array JSON yields empty findings + error', () => {
    const { findings, errors } = parseFindings('{"not": "array"}');
    expect(findings).toHaveLength(0);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('JSON array wrapped in braces (malformed) extracts inner array', () => {
    // Defensive test: if LLM outputs {"findings": [...]}, parser should
    // extract the inner [...] array via bracket-matching fallback.
    const weird = `{"findings": ${VALID_FINDING_JSON}}`;
    const { findings } = parseFindings(weird);
    expect(findings).toHaveLength(1);
  });

  it('skips rows missing required fields but returns valid ones', () => {
    const mixed = `[
      { "judgment": "缺失字段" },
      ${VALID_FINDING_JSON.slice(1, -1).trim()}
    ]`;
    const { findings, errors } = parseFindings(mixed);
    expect(findings).toHaveLength(1);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('Row 0');
  });

  it('skips rows with invalid Kent / probability mismatch', () => {
    const bad = `[{
      "judgment": "x",
      "kentPhrase": "highly likely",
      "probRange": [5, 10],
      "sourceGrade": "B2",
      "evidenceRefs": [{ "entityId": "msg:wechat:x:1", "stance": "supports", "grade": "B2" }],
      "assumptions": []
    }]`;
    const { findings, errors } = parseFindings(bad);
    expect(findings).toHaveLength(0);
    expect(errors[0]).toMatch(/canonical range/);
  });

  it('skips rows with invalid Admiralty code', () => {
    const bad = `[{
      "judgment": "x",
      "kentPhrase": "likely",
      "probRange": [60, 80],
      "sourceGrade": "Z9",
      "evidenceRefs": [{ "entityId": "msg:wechat:x:1", "stance": "supports", "grade": "B2" }],
      "assumptions": []
    }]`;
    const { findings, errors } = parseFindings(bad);
    expect(findings).toHaveLength(0);
    expect(errors[0]).toMatch(/Row 0: required fields missing|Admiralty/);
  });

  it('defaults invalid stance to neutral rather than dropping row', () => {
    const withBadStance = `[{
      "judgment": "x",
      "kentPhrase": "likely",
      "probRange": [60, 80],
      "sourceGrade": "B2",
      "evidenceRefs": [{ "entityId": "msg:wechat:x:1", "stance": "unclear", "grade": "B2" }],
      "assumptions": []
    }]`;
    const { findings, errors } = parseFindings(withBadStance);
    expect(findings).toHaveLength(1);
    expect(findings[0].evidenceRefs[0].stance).toBe('neutral');
  });

  it('accepts row with empty assumptions array', () => {
    const { findings, errors } = parseFindings(`[{
      "judgment": "x",
      "kentPhrase": "likely",
      "probRange": [60, 80],
      "sourceGrade": "B2",
      "evidenceRefs": [{ "entityId": "msg:wechat:x:1", "stance": "supports", "grade": "B2" }],
      "assumptions": []
    }]`);
    expect(errors).toEqual([]);
    expect(findings[0].assumptions).toEqual([]);
  });

  it('accepts empty JSON array (no findings) without error', () => {
    const { findings, errors } = parseFindings('[]');
    expect(findings).toEqual([]);
    expect(errors).toEqual([]);
  });
});
