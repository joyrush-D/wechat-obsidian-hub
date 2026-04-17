import type { ParsedMessage, Contact } from '../types';
import { LlmClient } from './llm-client';
import { buildExtractionPrompt, buildPdbSynthesisPrompt } from './prompt-templates';
import {
  type SourceTrustData,
  type SourceStats,
  gradeSource,
  gradeMessage,
  formatAdmiraltyCode,
  updateTrust,
  getTopSources,
  initTrust,
} from '../intel/source-trust';

export interface BriefingOptions {
  skipEmoji?: boolean;
  skipSystemMessages?: boolean;
  trust?: SourceTrustData;
  contactsMap?: Map<string, Contact>;
  userWxid?: string;
}

export class BriefingGenerator {
  private options: BriefingOptions;
  private trust: SourceTrustData;

  constructor(options: BriefingOptions = {}) {
    this.options = { skipEmoji: true, skipSystemMessages: true, ...options };
    this.trust = options.trust || initTrust();
  }

  getTrust(): SourceTrustData {
    return this.trust;
  }

  /** Group filtered messages by conversation, sorted by activity. */
  groupByConversation(messages: ParsedMessage[]): Map<string, ParsedMessage[]> {
    const filtered = messages.filter(msg => {
      if (this.options.skipEmoji && msg.type === 'emoji') return false;
      if (this.options.skipSystemMessages && msg.type === 'system') return false;
      // Stage 1 TRIAGE: drop ultra-low-signal messages
      const text = msg.text.trim();
      if (text.length < 2) return false;
      if (/^(嗯+|哦+|好+|哈+|对|是|ok)$/i.test(text)) return false;
      return true;
    });

    const groups = new Map<string, ParsedMessage[]>();
    for (const msg of filtered) {
      const key = msg.conversationName || msg.conversationId;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(msg);
    }

    return new Map([...groups.entries()].sort((a, b) => b[1].length - a[1].length));
  }

  /** Format one conversation with Admiralty Code annotations on each message. */
  formatConversation(name: string, msgs: ParsedMessage[]): string {
    const contactsMap = this.options.contactsMap || new Map();
    const lines: string[] = [`## ${name} (${msgs.length}条)`];

    for (const msg of msgs) {
      const contact = contactsMap.get(msg.senderWxid);
      const stats = this.trust.sources[msg.senderWxid];
      const reliability = gradeSource(stats, contact);
      const credibility = gradeMessage(msg, reliability);
      const code = formatAdmiraltyCode(reliability, credibility);

      const time = msg.time.toTimeString().slice(0, 5);
      let line = `[${time}] ${msg.sender} [${code}]: ${msg.text}`;
      if (msg.type === 'link' && msg.extra.description) line += ` — ${msg.extra.description}`;
      if (msg.extra.url) line += ` (${msg.extra.url})`;
      lines.push(line);
    }
    return lines.join('\n');
  }

  formatMessagesForAI(messages: ParsedMessage[]): string {
    const groups = this.groupByConversation(messages);
    return [...groups.entries()]
      .map(([name, msgs]) => this.formatConversation(name, msgs))
      .join('\n\n');
  }

  /**
   * Format the trust summary for inclusion in the synthesis prompt.
   */
  formatTopSourcesSummary(): string {
    const top = getTopSources(this.trust, 15);
    if (top.length === 0) return '(首次运行，尚无历史信源数据)';

    const lines: string[] = ['| 发言人 | 信源等级 | 累计消息 | @你 | DM | 备注 |', '|---|---|---|---|---|---|'];
    for (const s of top) {
      const grade = gradeSource(s);
      lines.push(`| ${s.displayName} | ${grade} | ${s.totalMessages} | ${s.mentionsUser} | ${s.isInDirectMsg ? '✓' : '-'} | ${s.hasRemark ? '已备注' : '-'} |`);
    }
    return lines.join('\n');
  }

  /**
   * Stage 2: extract structured intel from each conversation.
   * Returns array of {conversation, extracted_intel_markdown}.
   */
  async extractFromBatches(
    groups: Map<string, ParsedMessage[]>,
    llmClient: LlmClient,
    onProgress: (msg: string) => Promise<void>,
  ): Promise<Array<{ name: string; extracted: string; msgCount: number }>> {
    const results: Array<{ name: string; extracted: string; msgCount: number }> = [];

    // Batch small conversations together to reduce LLM calls; large ones go solo.
    const PRIORITY_THRESHOLD = 20;  // conversations with >= N msgs get individual treatment
    const BATCH_SIZE = 80;           // small conversations grouped up to this many msgs

    const priority: Array<[string, ParsedMessage[]]> = [];
    const minor: Array<[string, ParsedMessage[]]> = [];

    for (const [name, msgs] of groups) {
      (msgs.length >= PRIORITY_THRESHOLD ? priority : minor).push([name, msgs]);
    }

    // Process priority conversations individually (cap at 200 msgs each to avoid model crash)
    for (let i = 0; i < priority.length; i++) {
      const [name, msgs] = priority[i];
      const trimmed = msgs.slice(-200);  // most recent 200
      await onProgress(`📊 分析活跃对话 ${i + 1}/${priority.length}: ${name} (${trimmed.length}条)`);

      const text = this.formatConversation(name, trimmed);
      try {
        const extracted = await llmClient.complete(buildExtractionPrompt(name, text));
        results.push({ name, extracted, msgCount: trimmed.length });
      } catch (e) {
        results.push({ name, extracted: `> 分析失败: ${(e as Error).message}`, msgCount: trimmed.length });
      }
    }

    // Bundle minor conversations into batches
    let currentBatch: Array<[string, ParsedMessage[]]> = [];
    let currentCount = 0;
    const minorBatches: Array<Array<[string, ParsedMessage[]]>> = [];
    for (const [name, msgs] of minor) {
      if (currentCount + msgs.length > BATCH_SIZE && currentBatch.length > 0) {
        minorBatches.push(currentBatch);
        currentBatch = [];
        currentCount = 0;
      }
      currentBatch.push([name, msgs]);
      currentCount += msgs.length;
    }
    if (currentBatch.length > 0) minorBatches.push(currentBatch);

    for (let i = 0; i < minorBatches.length; i++) {
      const batch = minorBatches[i];
      const names = batch.map(([n]) => n).join('、');
      const totalMsgs = batch.reduce((s, [, m]) => s + m.length, 0);

      await onProgress(`📊 分析次要对话批次 ${i + 1}/${minorBatches.length} (${batch.length}个对话, ${totalMsgs}条)`);

      const combined = batch
        .map(([name, msgs]) => this.formatConversation(name, msgs))
        .join('\n\n');

      try {
        const extracted = await llmClient.complete(buildExtractionPrompt(`次要对话集合: ${names}`, combined));
        results.push({ name: `次要对话集合 (${batch.length}个)`, extracted, msgCount: totalMsgs });
      } catch (e) {
        results.push({ name: 'minor batch', extracted: `> 分析失败: ${(e as Error).message}`, msgCount: totalMsgs });
      }
    }

    return results;
  }

  /**
   * Run the full intel pipeline:
   * 1. TRIAGE (groupByConversation filters noise)
   * 2. ENTITY EXTRACTION (per conversation, structured)
   * 3. SYNTHESIS (PDB-style brief from all extracted intel)
   */
  async generateProgressive(
    messages: ParsedMessage[],
    llmClient: LlmClient,
    date: string,
    onProgress: (content: string, done: boolean) => Promise<void>,
  ): Promise<string> {
    // Update trust data with today's observations
    if (this.options.contactsMap) {
      updateTrust(this.trust, messages, this.options.contactsMap, this.options.userWxid);
    }

    const groups = this.groupByConversation(messages);
    const totalConversations = groups.size;
    const totalMessages = messages.length;

    let header = `# 微信日报 — ${date} (生成中…)\n\n`;
    header += `> 共 ${totalConversations} 个活跃对话，${totalMessages} 条消息\n\n---\n\n`;

    await onProgress(header + `_🔍 Stage 1-2: 信号分流与实体提取..._`, false);

    // Stage 2: Extract structured intel from each conversation
    const extractedResults = await this.extractFromBatches(
      groups,
      llmClient,
      async (msg) => {
        await onProgress(header + `_${msg}_`, false);
      },
    );

    await onProgress(header + `_🧠 Stage 5: 按情报标准合成 PDB 简报..._`, false);

    // Stage 5: PDB synthesis
    const clusteredFindings = extractedResults
      .map(r => `## ${r.name} (${r.msgCount}条原始消息)\n${r.extracted}`)
      .join('\n\n---\n\n');

    const topSources = this.formatTopSourcesSummary();
    const metaStats = `- 总消息数：${totalMessages}\n- 活跃对话数：${totalConversations}\n- 数据日期：${date}\n- 信源库规模：${Object.keys(this.trust.sources).length}`;

    let finalBrief: string;
    try {
      finalBrief = await llmClient.complete(
        buildPdbSynthesisPrompt(date, topSources, clusteredFindings, metaStats),
      );
    } catch (e) {
      // Fallback: just dump the extracted intel
      finalBrief = `# 微信日报 — ${date} (合成失败)\n\n> 合成阶段失败: ${(e as Error).message}\n\n## 详细抽取结果\n\n${clusteredFindings}`;
    }

    const finalContent = `${finalBrief}\n\n---\n\n<details><summary>📋 原始抽取数据 (${extractedResults.length} 个对话)</summary>\n\n${clusteredFindings}\n\n</details>`;

    await onProgress(finalContent, true);
    return finalContent;
  }

  // Backward-compat
  async generate(messages: ParsedMessage[], llmClient: LlmClient, date: string): Promise<string> {
    return this.generateProgressive(messages, llmClient, date, async () => {});
  }

  buildPrompt(messages: ParsedMessage[], date: string): string {
    const groups = this.groupByConversation(messages);
    const allText = [...groups.entries()].map(([n, m]) => this.formatConversation(n, m)).join('\n\n');
    return buildPdbSynthesisPrompt(date, this.formatTopSourcesSummary(), allText, `- 总消息数：${messages.length}`);
  }
}
