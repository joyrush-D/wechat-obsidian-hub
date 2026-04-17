import { describe, it, expect, vi } from 'vitest';
import { BriefingGenerator } from '../../src/ai/briefing-generator';
import { buildPdbSynthesisPrompt, buildDirectSynthesisPrompt } from '../../src/ai/prompt-templates';
import type { ParsedMessage } from '../../src/types';

function makeMsg(overrides: Partial<ParsedMessage> = {}): ParsedMessage {
  return {
    localId: 1,
    time: new Date('2024-01-15T09:30:00'),
    conversationId: 'group_001@chatroom',
    conversationName: 'Dev Team',
    sender: 'Alice',
    senderWxid: 'wxid_alice',
    text: 'Hello team',
    type: 'text',
    extra: {},
    ...overrides,
  };
}

describe('BriefingGenerator', () => {
  describe('constructor defaults', () => {
    it('defaults skipEmoji and skipSystemMessages to true', () => {
      const gen = new BriefingGenerator();
      // verified indirectly: emoji messages are filtered by default
      const msgs = [makeMsg({ type: 'emoji', text: '[emoji]' })];
      expect(gen.formatMessagesForAI(msgs)).toBe('');
    });

    it('respects explicit options override', () => {
      const gen = new BriefingGenerator({ skipEmoji: false, skipSystemMessages: false });
      const msgs = [
        makeMsg({ type: 'emoji', text: '[emoji]' }),
        makeMsg({ type: 'system', text: '[system]' }),
      ];
      const result = gen.formatMessagesForAI(msgs);
      expect(result).toContain('[emoji]');
      expect(result).toContain('[system]');
    });
  });

  describe('formatMessagesForAI()', () => {
    it('groups messages by conversationName', () => {
      const msgs = [
        makeMsg({ conversationName: 'Group A', text: 'Hello from A' }),
        makeMsg({ conversationName: 'Group B', text: 'Hello from B' }),
        makeMsg({ conversationName: 'Group A', text: 'Second A msg' }),
      ];
      const result = new BriefingGenerator().formatMessagesForAI(msgs);
      const groupAIndex = result.indexOf('## Group A');
      const groupBIndex = result.indexOf('## Group B');
      expect(groupAIndex).toBeGreaterThanOrEqual(0);
      expect(groupBIndex).toBeGreaterThanOrEqual(0);
      // Both groups appear
      expect(result).toContain('Hello from A');
      expect(result).toContain('Hello from B');
      expect(result).toContain('Second A msg');
    });

    it('falls back to conversationId when conversationName is empty', () => {
      const msgs = [makeMsg({ conversationName: '', conversationId: 'raw_id_123' })];
      const result = new BriefingGenerator().formatMessagesForAI(msgs);
      expect(result).toContain('## raw_id_123');
    });

    it('includes formatted time in HH:MM format', () => {
      const msgs = [makeMsg({ time: new Date('2024-01-15T14:05:00') })];
      const result = new BriefingGenerator().formatMessagesForAI(msgs);
      expect(result).toContain('[14:05]');
    });

    it('includes sender name', () => {
      const msgs = [makeMsg({ sender: 'Bob', text: 'Test message' })];
      const result = new BriefingGenerator().formatMessagesForAI(msgs);
      // Current format: "[HH:MM] sender [admiralty_code]: text"
      expect(result).toContain('Bob');
      expect(result).toContain('Test message');
      expect(result).toMatch(/Bob\s*\[[^\]]+\]:\s*Test message/);
    });

    it('includes message text', () => {
      const msgs = [makeMsg({ text: 'Important meeting at 3pm' })];
      const result = new BriefingGenerator().formatMessagesForAI(msgs);
      expect(result).toContain('Important meeting at 3pm');
    });

    it('appends description for link type messages', () => {
      const msgs = [makeMsg({
        type: 'link',
        text: '[link] Cool Article',
        extra: { description: 'A great read about TypeScript', url: 'https://example.com/ts' },
      })];
      const result = new BriefingGenerator().formatMessagesForAI(msgs);
      expect(result).toContain('— A great read about TypeScript');
    });

    it('appends URL for messages with extra.url', () => {
      const msgs = [makeMsg({
        type: 'link',
        text: '[link] Some Link',
        extra: { url: 'https://github.com/test' },
      })];
      const result = new BriefingGenerator().formatMessagesForAI(msgs);
      expect(result).toContain('(https://github.com/test)');
    });

    it('does not append URL when extra.url is absent', () => {
      const msgs = [makeMsg({ type: 'text', text: 'No URL here', extra: {} })];
      const result = new BriefingGenerator().formatMessagesForAI(msgs);
      expect(result).not.toContain('(http');
    });

    it('skips emoji messages by default', () => {
      const msgs = [
        makeMsg({ type: 'text', text: 'Normal message' }),
        makeMsg({ type: 'emoji', text: '[emoji]', localId: 2 }),
      ];
      const result = new BriefingGenerator().formatMessagesForAI(msgs);
      expect(result).toContain('Normal message');
      expect(result).not.toContain('[emoji]');
    });

    it('skips system messages by default', () => {
      const msgs = [
        makeMsg({ type: 'text', text: 'Normal message' }),
        makeMsg({ type: 'system', text: 'Alice joined the group', localId: 2 }),
      ];
      const result = new BriefingGenerator().formatMessagesForAI(msgs);
      expect(result).toContain('Normal message');
      expect(result).not.toContain('Alice joined the group');
    });

    it('includes emoji when skipEmoji is false', () => {
      const gen = new BriefingGenerator({ skipEmoji: false });
      const msgs = [makeMsg({ type: 'emoji', text: '[emoji]' })];
      expect(gen.formatMessagesForAI(msgs)).toContain('[emoji]');
    });

    it('includes system when skipSystemMessages is false', () => {
      const gen = new BriefingGenerator({ skipSystemMessages: false });
      const msgs = [makeMsg({ type: 'system', text: 'User left' })];
      expect(gen.formatMessagesForAI(msgs)).toContain('User left');
    });

    it('returns empty string when all messages are filtered out', () => {
      const msgs = [makeMsg({ type: 'emoji' }), makeMsg({ type: 'system', localId: 2 })];
      expect(new BriefingGenerator().formatMessagesForAI(msgs)).toBe('');
    });

    it('separates groups with a blank line', () => {
      const msgs = [
        makeMsg({ conversationName: 'Group A' }),
        makeMsg({ conversationName: 'Group B', localId: 2 }),
      ];
      const result = new BriefingGenerator().formatMessagesForAI(msgs);
      expect(result).toContain('\n\n');
    });

    it('preserves message order within a group', () => {
      const msgs = [
        makeMsg({ time: new Date('2024-01-15T09:00:00'), text: 'First' }),
        makeMsg({ time: new Date('2024-01-15T10:00:00'), text: 'Second', localId: 2 }),
        makeMsg({ time: new Date('2024-01-15T11:00:00'), text: 'Third', localId: 3 }),
      ];
      const result = new BriefingGenerator().formatMessagesForAI(msgs);
      const firstIdx = result.indexOf('First');
      const secondIdx = result.indexOf('Second');
      const thirdIdx = result.indexOf('Third');
      expect(firstIdx).toBeLessThan(secondIdx);
      expect(secondIdx).toBeLessThan(thirdIdx);
    });
  });

  describe('buildPrompt()', () => {
    it('includes the date in the prompt', () => {
      const gen = new BriefingGenerator();
      const msgs = [makeMsg()];
      const prompt = gen.buildPrompt(msgs, '2024-01-15');
      expect(prompt).toContain('2024-01-15');
    });

    it('includes message content in the prompt', () => {
      const gen = new BriefingGenerator();
      const msgs = [makeMsg({ text: 'Stand-up at 10am' })];
      const prompt = gen.buildPrompt(msgs, '2024-01-15');
      expect(prompt).toContain('Stand-up at 10am');
    });

    it('is a Chinese language prompt', () => {
      const gen = new BriefingGenerator();
      const prompt = gen.buildPrompt([], '2024-01-15');
      // Contains Chinese characters
      expect(/[\u4e00-\u9fff]/.test(prompt)).toBe(true);
    });
  });

  describe('generate()', () => {
    it('invokes llmClient.complete and wraps the result in the full brief envelope', async () => {
      // Current generate() is a thin wrapper around generateProgressive(), which runs
      // the full pipeline (direct synthesis → tearline → pattern-of-life → etc.).
      // Any LLM call returns the same canned output here; we just assert the pipeline
      // ran, produced a non-empty document, and embedded the canned content + the date.
      // generateProgressive rejects mainBrief < 100 chars as "model crashed"
      // and falls back to mechanical output. Provide a long enough canned response.
      const CANNED = 'AI generated briefing: ' + 'x'.repeat(200);
      const mockClient = { complete: vi.fn().mockResolvedValue(CANNED) } as any;
      const gen = new BriefingGenerator({
        enableTearline: false,
        enablePatternOfLife: false,
        enableBiasAudit: false,
        enableReflexiveControl: false,
        enableShareableTearline: false,
      });
      const msgs = [makeMsg()];
      const result = await gen.generate(msgs, mockClient, '2024-01-15');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
      expect(mockClient.complete).toHaveBeenCalled();
      // Result should include the canned LLM output somewhere in the composed brief
      expect(result).toContain('AI generated briefing');
      expect(result).toContain(CANNED);
    });
  });
});

describe('buildPdbSynthesisPrompt()', () => {
  it('includes the provided date', () => {
    const prompt = buildPdbSynthesisPrompt('2024-03-20', 'sources', 'content', 'meta');
    expect(prompt).toContain('2024-03-20');
  });

  it('includes the messages text', () => {
    const prompt = buildPdbSynthesisPrompt('2024-03-20', 'sources', '## Group\n[09:00] Alice: Hi', 'meta');
    expect(prompt).toContain('## Group');
    expect(prompt).toContain('[09:00] Alice: Hi');
  });

  it('is non-empty', () => {
    expect(buildPdbSynthesisPrompt('2024-01-01', '', '', '').length).toBeGreaterThan(0);
  });

  it('contains Chinese instruction text', () => {
    const prompt = buildPdbSynthesisPrompt('2024-01-01', '', '', '');
    expect(/[\u4e00-\u9fff]/.test(prompt)).toBe(true);
  });
});

describe('buildDirectSynthesisPrompt()', () => {
  it('includes the provided date', () => {
    const prompt = buildDirectSynthesisPrompt('2024-03-20', 'content', 'meta');
    expect(prompt).toContain('2024-03-20');
  });

  it('includes the raw messages', () => {
    const prompt = buildDirectSynthesisPrompt('2024-03-20', '[09:00] Alice: Hi', 'meta');
    expect(prompt).toContain('[09:00] Alice: Hi');
  });
});
