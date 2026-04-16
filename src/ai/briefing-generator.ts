import type { ParsedMessage, MessageCategory } from '../types';
import { buildBriefingPrompt } from './prompt-templates';
import { LlmClient } from './llm-client';

export interface BriefingOptions {
  skipEmoji?: boolean;
  skipSystemMessages?: boolean;
}

export class BriefingGenerator {
  private options: BriefingOptions;

  constructor(options: BriefingOptions = {}) {
    this.options = { skipEmoji: true, skipSystemMessages: true, ...options };
  }

  formatMessagesForAI(messages: ParsedMessage[]): string {
    const filtered = messages.filter(msg => {
      if (this.options.skipEmoji && msg.type === 'emoji') return false;
      if (this.options.skipSystemMessages && msg.type === 'system') return false;
      return true;
    });

    const groups = new Map<string, ParsedMessage[]>();
    for (const msg of filtered) {
      const key = msg.conversationName || msg.conversationId;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(msg);
    }

    const sections: string[] = [];
    for (const [name, msgs] of groups) {
      const lines: string[] = [`## ${name}`];
      for (const msg of msgs) {
        const time = msg.time.toTimeString().slice(0, 5);
        let line = `[${time}] ${msg.sender}: ${msg.text}`;
        if (msg.type === 'link' && msg.extra.description) line += ` — ${msg.extra.description}`;
        if (msg.extra.url) line += ` (${msg.extra.url})`;
        lines.push(line);
      }
      sections.push(lines.join('\n'));
    }
    return sections.join('\n\n');
  }

  buildPrompt(messages: ParsedMessage[], date: string): string {
    return buildBriefingPrompt(date, this.formatMessagesForAI(messages));
  }

  async generate(messages: ParsedMessage[], llmClient: LlmClient, date: string): Promise<string> {
    return llmClient.complete(this.buildPrompt(messages, date));
  }
}
