import type { ParsedMessage } from '../types';
import { LlmClient } from './llm-client';
import { buildBriefingPrompt, buildBatchPrompt } from './prompt-templates';

export interface BriefingOptions {
  skipEmoji?: boolean;
  skipSystemMessages?: boolean;
}

export class BriefingGenerator {
  private options: BriefingOptions;

  constructor(options: BriefingOptions = {}) {
    this.options = { skipEmoji: true, skipSystemMessages: true, ...options };
  }

  /**
   * Group messages by conversation, sorted by message count (most active first).
   */
  groupByConversation(messages: ParsedMessage[]): Map<string, ParsedMessage[]> {
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

    // Sort by message count (most active first)
    const sorted = new Map(
      [...groups.entries()].sort((a, b) => b[1].length - a[1].length)
    );
    return sorted;
  }

  /**
   * Format a single conversation's messages for AI.
   */
  formatConversation(name: string, msgs: ParsedMessage[]): string {
    const lines: string[] = [];
    for (const msg of msgs) {
      const time = msg.time.toTimeString().slice(0, 5);
      let line = `[${time}] ${msg.sender}: ${msg.text}`;
      if (msg.type === 'link' && msg.extra.description) {
        line += ` — ${msg.extra.description}`;
      }
      if (msg.extra.url) {
        line += ` (${msg.extra.url})`;
      }
      lines.push(line);
    }
    return `### ${name} (${msgs.length}条消息)\n${lines.join('\n')}`;
  }

  formatMessagesForAI(messages: ParsedMessage[]): string {
    const groups = this.groupByConversation(messages);
    const sections: string[] = [];
    for (const [name, msgs] of groups) {
      sections.push(this.formatConversation(name, msgs));
    }
    return sections.join('\n\n');
  }

  /**
   * Generate briefing progressively — one batch of conversations at a time.
   * Calls onProgress with each partial result so the note can be updated live.
   */
  async generateProgressive(
    messages: ParsedMessage[],
    llmClient: LlmClient,
    date: string,
    onProgress: (content: string, done: boolean) => Promise<void>,
  ): Promise<string> {
    const groups = this.groupByConversation(messages);
    const totalConversations = groups.size;
    const totalMessages = messages.length;

    // Header
    let briefing = `# 微信每日简报 — ${date}\n\n`;
    briefing += `> 共 ${totalConversations} 个活跃对话，${totalMessages} 条消息\n\n`;
    briefing += `---\n\n`;

    await onProgress(briefing + `_正在分析 ${totalConversations} 个对话..._`, false);

    // Batch conversations: ~200 messages per batch to stay within context window
    const BATCH_MSG_LIMIT = 200;
    const batches: { name: string; msgs: ParsedMessage[] }[][] = [];
    let currentBatch: { name: string; msgs: ParsedMessage[] }[] = [];
    let currentCount = 0;

    for (const [name, msgs] of groups) {
      if (currentCount + msgs.length > BATCH_MSG_LIMIT && currentBatch.length > 0) {
        batches.push(currentBatch);
        currentBatch = [];
        currentCount = 0;
      }
      currentBatch.push({ name, msgs });
      currentCount += msgs.length;
    }
    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }

    // Stage 1: Per-batch detailed analysis
    const batchSummaries: string[] = [];

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const batchNames = batch.map(b => b.name).join('、');

      await onProgress(
        briefing + `_📊 正在分析第 ${i + 1}/${batches.length} 批对话 (${batchNames})..._`,
        false,
      );

      const batchText = batch
        .map(b => this.formatConversation(b.name, b.msgs))
        .join('\n\n');

      try {
        const summary = await llmClient.complete(buildBatchPrompt(batchText));
        batchSummaries.push(summary);
      } catch (e) {
        batchSummaries.push(`> ⚠️ 批 ${i + 1} 分析失败: ${(e as Error).message}`);
      }
    }

    // Stage 2: Synthesize into BLUF intelligence brief
    await onProgress(briefing + `_🎯 正在生成情报简报 (BLUF 格式)..._`, false);

    const allBatchText = batchSummaries.join('\n\n');
    try {
      const finalBrief = await llmClient.complete(buildBriefingPrompt(date, allBatchText));
      briefing += finalBrief;
    } catch (e) {
      // If synthesis fails, fall back to raw batch summaries
      briefing += `## 详细分析\n\n${batchSummaries.join('\n\n')}\n\n> ⚠️ 简报合成失败: ${(e as Error).message}`;
    }

    await onProgress(briefing, true);
    return briefing;
  }

  // Keep simple generate for backward compatibility with tests
  async generate(messages: ParsedMessage[], llmClient: LlmClient, date: string): Promise<string> {
    return this.generateProgressive(messages, llmClient, date, async () => {});
  }

  buildPrompt(messages: ParsedMessage[], date: string): string {
    return buildBriefingPrompt(date, this.formatMessagesForAI(messages));
  }
}
