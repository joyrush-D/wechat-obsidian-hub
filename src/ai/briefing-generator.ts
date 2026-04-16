import type { ParsedMessage } from '../types';
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

    // Process each batch
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const batchNames = batch.map(b => b.name).join('、');
      const batchMsgCount = batch.reduce((s, b) => s + b.msgs.length, 0);

      await onProgress(
        briefing + `_正在分析第 ${i + 1}/${batches.length} 批 (${batchNames})..._`,
        false,
      );

      // Format this batch
      const batchText = batch
        .map(b => this.formatConversation(b.name, b.msgs))
        .join('\n\n');

      const prompt = `你是微信消息助手。请总结以下对话的要点，用中文简洁输出。
每个对话用 "### 对话名" 格式，列出：
- 主要讨论话题
- 重要信息或待办
- 分享的链接（标题+简介）
不重要的寒暄可以跳过。

${batchText}`;

      try {
        const summary = await llmClient.complete(prompt);
        briefing += summary + '\n\n';
      } catch (e) {
        briefing += `> ⚠️ 第 ${i + 1} 批分析失败 (${batchNames}): ${(e as Error).message}\n\n`;
      }

      await onProgress(briefing, i === batches.length - 1);
    }

    return briefing;
  }

  // Keep simple generate for backward compatibility with tests
  async generate(messages: ParsedMessage[], llmClient: LlmClient, date: string): Promise<string> {
    return this.generateProgressive(messages, llmClient, date, async () => {});
  }
}
