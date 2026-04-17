import type { ParsedMessage, Contact } from '../types';
import { LlmClient } from './llm-client';
import {
  buildExtractionPrompt,
  buildClusteringPrompt,
  buildPdbSynthesisPrompt,
  buildTearlinePrompt,
  buildBiasAuditPrompt,
} from './prompt-templates';
import {
  type SourceTrustData,
  gradeSource,
  gradeMessage,
  formatAdmiraltyCode,
  updateTrust,
  getTopSources,
  initTrust,
} from '../intel/source-trust';
import { ExtractionStore, type ExtractionEntry } from '../intel/extraction-store';

export interface BriefingOptions {
  skipEmoji?: boolean;
  skipSystemMessages?: boolean;
  trust?: SourceTrustData;
  contactsMap?: Map<string, Contact>;
  userWxid?: string;
  enableTearline?: boolean;       // 30-sec ultra-condensed version
  enableBiasAudit?: boolean;      // Heuer's 18-bias check
  extractionStore?: ExtractionStore;  // persistent cache (skip re-extracting unchanged convos)
}

export class BriefingGenerator {
  private options: BriefingOptions;
  private trust: SourceTrustData;

  constructor(options: BriefingOptions = {}) {
    this.options = {
      skipEmoji: true,
      skipSystemMessages: true,
      enableTearline: true,
      enableBiasAudit: true,
      ...options,
    };
    this.trust = options.trust || initTrust();
  }

  getTrust(): SourceTrustData {
    return this.trust;
  }

  /** Stage 1: TRIAGE — filter low-signal noise. */
  triage(messages: ParsedMessage[]): ParsedMessage[] {
    return messages.filter(msg => {
      if (this.options.skipEmoji && msg.type === 'emoji') return false;
      if (this.options.skipSystemMessages && msg.type === 'system') return false;
      const text = msg.text.trim();
      if (text.length < 2) return false;
      // Filter ultra-low-signal replies
      if (/^(嗯+|哦+|好+|哈+|对|是|ok|👍|🙏)$/i.test(text)) return false;
      return true;
    });
  }

  /** Group by conversation, sorted by activity. */
  groupByConversation(messages: ParsedMessage[]): Map<string, ParsedMessage[]> {
    const groups = new Map<string, ParsedMessage[]>();
    for (const msg of messages) {
      const key = msg.conversationName || msg.conversationId;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(msg);
    }
    return new Map([...groups.entries()].sort((a, b) => b[1].length - a[1].length));
  }

  /** Format a conversation with plain-Chinese source labels. */
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
      if (msg.extra.url && msg.extra.unsupported !== '1') line += ` (${msg.extra.url})`;
      lines.push(line);
    }
    return lines.join('\n');
  }

  formatTopSourcesSummary(): string {
    const top = getTopSources(this.trust, 10);
    if (top.length === 0) return '(本次为首次运行，信源信任度基于联系人备注初始化)';
    const lines: string[] = [];
    for (const s of top) {
      const grade = gradeSource(s);
      lines.push(`- ${s.displayName}: ${grade} (${s.totalMessages}条历史)`);
    }
    return lines.join('\n');
  }

  /**
   * Stage 2: per-conversation extraction with persistent cache.
   * Smart batching: priority conversations solo, minor ones bundled.
   * Cache hits skip LLM calls entirely.
   */
  async extractAll(
    groups: Map<string, ParsedMessage[]>,
    llmClient: LlmClient,
    onProgress: (msg: string) => Promise<void>,
    date: string,
  ): Promise<Array<{ name: string; extracted: string; msgCount: number; cached: boolean }>> {
    const results: Array<{ name: string; extracted: string; msgCount: number; cached: boolean }> = [];
    const PRIORITY_THRESHOLD = 15;
    const BATCH_LIMIT = 80;
    const PER_CONV_MSG_CAP = 150;

    const store = this.options.extractionStore;
    const today = store ? store.load(date) : null;
    const cachedEntries = today ? today.entries.slice() : [];

    const priority: Array<[string, ParsedMessage[]]> = [];
    const minor: Array<[string, ParsedMessage[]]> = [];

    for (const [name, msgs] of groups) {
      (msgs.length >= PRIORITY_THRESHOLD ? priority : minor).push([name, msgs]);
    }

    // Helper: check cache by name + msgCount + lastTimestamp
    const lookupCache = (name: string, msgs: ParsedMessage[]) => {
      if (!store) return null;
      const lastTs = msgs.length > 0 ? Math.max(...msgs.map(m => Math.floor(m.time.getTime() / 1000))) : 0;
      const key = ExtractionStore.cacheKey(name, msgs.length, lastTs);
      const hit = cachedEntries.find(e => e.cacheKey === key);
      return hit;
    };

    const saveToCache = (name: string, conversationId: string, msgs: ParsedMessage[], extracted: string) => {
      if (!store) return;
      const lastTs = msgs.length > 0 ? Math.max(...msgs.map(m => Math.floor(m.time.getTime() / 1000))) : 0;
      const key = ExtractionStore.cacheKey(name, msgs.length, lastTs);
      const entry: ExtractionEntry = {
        conversationName: name,
        conversationId,
        msgCount: msgs.length,
        lastMsgTimestamp: lastTs,
        cacheKey: key,
        extracted,
        extractedAt: new Date().toISOString(),
      };
      cachedEntries.push(entry);
    };

    let cacheHits = 0;
    let cacheMisses = 0;

    // Process priority conversations
    for (let i = 0; i < priority.length; i++) {
      const [name, msgs] = priority[i];
      const trimmed = msgs.slice(-PER_CONV_MSG_CAP);

      const cached = lookupCache(name, trimmed);
      if (cached) {
        cacheHits++;
        await onProgress(`💾 缓存命中 ${i + 1}/${priority.length}: ${name}`);
        results.push({ name, extracted: cached.extracted, msgCount: trimmed.length, cached: true });
        continue;
      }

      cacheMisses++;
      await onProgress(`📊 抽取活跃对话 ${i + 1}/${priority.length}: ${name}`);
      const text = this.formatConversation(name, trimmed);
      try {
        const extracted = await llmClient.complete(buildExtractionPrompt(name, text));
        results.push({ name, extracted, msgCount: trimmed.length, cached: false });
        saveToCache(name, trimmed[0]?.conversationId || '', trimmed, extracted);
      } catch (e) {
        results.push({ name, extracted: `（提取失败: ${(e as Error).message.slice(0, 80)}）`, msgCount: trimmed.length, cached: false });
      }
    }

    // Bundle minor conversations
    let currentBatch: Array<[string, ParsedMessage[]]> = [];
    let currentCount = 0;
    const minorBatches: Array<Array<[string, ParsedMessage[]]>> = [];
    for (const [name, msgs] of minor) {
      if (currentCount + msgs.length > BATCH_LIMIT && currentBatch.length > 0) {
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
      const totalMsgs = batch.reduce((s, [, m]) => s + m.length, 0);
      const batchKeyName = `minor_batch_${batch.map(([n]) => n).join('_').slice(0, 80)}`;

      // Cache lookup using a synthetic key from batch composition
      const combinedMsgs = batch.flatMap(([, m]) => m);
      const cached = lookupCache(batchKeyName, combinedMsgs);
      if (cached) {
        cacheHits++;
        await onProgress(`💾 次要批次缓存命中 ${i + 1}/${minorBatches.length}`);
        results.push({ name: `次要对话(${batch.length}个)`, extracted: cached.extracted, msgCount: totalMsgs, cached: true });
        continue;
      }

      cacheMisses++;
      await onProgress(`📊 抽取次要对话批次 ${i + 1}/${minorBatches.length} (${batch.length}个)`);
      const combined = batch.map(([n, m]) => this.formatConversation(n, m)).join('\n\n');
      try {
        const extracted = await llmClient.complete(
          buildExtractionPrompt(`次要对话集合(${batch.length}个)`, combined),
        );
        results.push({ name: `次要对话(${batch.length}个)`, extracted, msgCount: totalMsgs, cached: false });
        saveToCache(batchKeyName, '', combinedMsgs, extracted);
      } catch (e) {
        results.push({ name: 'minor', extracted: `（提取失败）`, msgCount: totalMsgs, cached: false });
      }
    }

    // Persist all entries (including new ones)
    if (store) {
      store.saveAll(date, cachedEntries);
      await onProgress(`✅ 抽取完成 (缓存命中 ${cacheHits} / 新抽取 ${cacheMisses})`);
    }

    return results;
  }

  /**
   * Stage 3: cluster compression.
   * Reduce 16 conversation extractions into themes (cuts tokens for synthesis).
   */
  async cluster(
    extractions: Array<{ name: string; extracted: string; msgCount: number }>,
    llmClient: LlmClient,
    onProgress: (msg: string) => Promise<void>,
  ): Promise<string> {
    await onProgress(`🧩 跨对话主题聚类中...`);
    const combined = extractions
      .map(r => `### 来源: ${r.name} (${r.msgCount}条原始消息)\n${r.extracted}`)
      .join('\n\n---\n\n');

    // Now that context is 262K, allow much larger clustering input
    const MAX_CLUSTER_INPUT = 60000;
    if (combined.length <= MAX_CLUSTER_INPUT) {
      try {
        return await llmClient.complete(buildClusteringPrompt(combined));
      } catch (e) {
        console.error('Clustering failed:', e);
        return combined;  // fallback: pass through
      }
    }

    // Too long: split into chunks and cluster each, then merge
    const chunks: string[] = [];
    let buf = '';
    for (const r of extractions) {
      const piece = `### 来源: ${r.name}\n${r.extracted}\n\n`;
      if (buf.length + piece.length > MAX_CLUSTER_INPUT) {
        chunks.push(buf);
        buf = piece;
      } else {
        buf += piece;
      }
    }
    if (buf) chunks.push(buf);

    await onProgress(`🧩 聚类输入过大，分 ${chunks.length} 块处理`);
    const clustered: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      try {
        clustered.push(await llmClient.complete(buildClusteringPrompt(chunks[i])));
      } catch (e) {
        clustered.push(chunks[i].slice(0, 3000));  // fallback
      }
    }
    return clustered.join('\n\n');
  }

  /**
   * Stage 4: PDB synthesis with aggressive input capping + clean fallback.
   */
  async synthesize(
    clusteredText: string,
    llmClient: LlmClient,
    date: string,
    metaStats: string,
    extractions: Array<{ name: string; extracted: string; msgCount: number }>,
  ): Promise<string> {
    // Cap at 80K chars (~25K tokens) — well within 262K context, but reasonable for synthesis quality
    const MAX_INPUT = 80000;
    let trimmed = clusteredText;
    if (trimmed.length > MAX_INPUT) {
      trimmed = trimmed.slice(0, MAX_INPUT) + '\n\n...(已截断)';
    }

    const topSources = this.formatTopSourcesSummary();
    const prompt = buildPdbSynthesisPrompt(date, topSources, trimmed, metaStats);

    try {
      return await llmClient.complete(prompt);
    } catch (e) {
      console.error('Synthesis failed:', e);
      // Programmatic fallback: build a clean curated brief without LLM
      return this.buildFallbackBrief(date, extractions, metaStats);
    }
  }

  /**
   * Build a clean structured brief when LLM synthesis fails.
   * Aggregates @mentions, action items, resources, top topics from extractions.
   */
  private buildFallbackBrief(
    date: string,
    extractions: Array<{ name: string; extracted: string; msgCount: number }>,
    metaStats: string,
  ): string {
    const sections: string[] = [`# 微信日报 ${date}\n\n> ⚠️ AI 合成阶段超时/失败，以下是程序化整理的精简版`];

    // Extract @-mentions across all conversations
    const mentions: string[] = [];
    const actions: string[] = [];
    const resources: string[] = [];
    const topics: string[] = [];

    for (const r of extractions) {
      const txt = r.extracted;
      // Extract sections by header
      const mentionMatch = txt.match(/### @我或求助[\s\S]*?(?=###|$)/);
      const actionMatch = txt.match(/### 行动项[\s\S]*?(?=###|$)/);
      const resourceMatch = txt.match(/### 资源链接[\s\S]*?(?=###|$)/);
      const topicMatch = txt.match(/### 议题[\s\S]*?(?=###|$)/);

      const extractLines = (block: string | undefined) => {
        if (!block) return [];
        return block
          .split('\n')
          .filter(line => line.trim().startsWith('-') && !line.includes('无'))
          .map(line => line.trim());
      };

      const m = extractLines(mentionMatch?.[0]);
      const a = extractLines(actionMatch?.[0]);
      const res = extractLines(resourceMatch?.[0]);
      const t = extractLines(topicMatch?.[0]);

      if (m.length > 0) mentions.push(`**[${r.name}]**\n${m.join('\n')}`);
      if (a.length > 0) actions.push(`**[${r.name}]**\n${a.join('\n')}`);
      if (res.length > 0) resources.push(`**[${r.name}]**\n${res.join('\n')}`);
      if (t.length > 0) topics.push(`**[${r.name}]** ${t.slice(0, 3).join('; ')}`);
    }

    // Compose sections
    sections.push(`## ⚡ 直接关乎你\n\n${mentions.length > 0 ? mentions.join('\n\n') : '今日无人直接 @ 你'}`);
    sections.push(`## ✅ 待办与行动项\n\n${actions.length > 0 ? actions.join('\n\n') : '今日无明确行动项'}`);
    sections.push(`## 📚 今日话题\n\n${topics.length > 0 ? topics.slice(0, 15).join('\n') : '无'}`);
    sections.push(`## 🔗 资源链接\n\n${resources.length > 0 ? resources.join('\n\n') : '今日无分享的链接'}`);
    sections.push(`## 📊 元数据\n${metaStats}`);

    return sections.join('\n\n');
  }

  /**
   * Full intel pipeline (5 stages):
   * 1. TRIAGE  → filter noise
   * 2. EXTRACT → per-conversation structured intel
   * 3. CLUSTER → compress into cross-conversation themes
   * 4. SYNTHESIZE → PDB-style brief
   * 5. ENRICH → Tearline (30-sec) + Bias Audit
   */
  async generateProgressive(
    messages: ParsedMessage[],
    llmClient: LlmClient,
    date: string,
    onProgress: (content: string, done: boolean) => Promise<void>,
  ): Promise<string> {
    if (this.options.contactsMap) {
      updateTrust(this.trust, messages, this.options.contactsMap, this.options.userWxid);
    }

    // Stage 1: triage
    const triaged = this.triage(messages);
    const groups = this.groupByConversation(triaged);
    const totalConversations = groups.size;
    const totalMessages = triaged.length;

    // Compute data freshness from latest message timestamp
    const latestMsgTime = messages.length > 0
      ? new Date(Math.max(...messages.map(m => m.time.getTime())))
      : new Date();
    const earliestMsgTime = messages.length > 0
      ? new Date(Math.min(...messages.map(m => m.time.getTime())))
      : new Date();
    const fmt = (d: Date) => d.toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-');
    const ageMin = Math.round((Date.now() - latestMsgTime.getTime()) / 60000);
    const freshness = ageMin < 10 ? '🟢 最新' : ageMin < 60 ? `🟡 ${ageMin} 分钟前` : `🔴 ${Math.round(ageMin/60)} 小时前`;

    const reportGenTime = fmt(new Date());
    let header = `# 微信日报 ${date}\n\n` +
      `> **🕐 报告生成时间**: ${reportGenTime}\n` +
      `> **📡 数据范围**: ${fmt(earliestMsgTime)} → ${fmt(latestMsgTime)} (最新消息距今: ${freshness})\n` +
      `> **📊 统计**: ${totalConversations} 个活跃对话, ${triaged.length} 条有效消息（已过滤 ${messages.length - triaged.length} 条噪音）\n\n`;

    await onProgress(header + `_🔍 阶段 1/5: 信号分流完成_`, false);

    // Stage 2: extract (with persistent cache)
    // Use date YYYY-MM-DD for cache key, regardless of full datetime label
    const cacheDate = date.slice(0, 10);
    const extractions = await this.extractAll(
      groups,
      llmClient,
      async (msg) => {
        await onProgress(header + `_${msg}_`, false);
      },
      cacheDate,
    );

    // Stage 3: cluster
    const clustered = await this.cluster(
      extractions,
      llmClient,
      async (msg) => {
        await onProgress(header + `_${msg}_`, false);
      },
    );

    // Stage 4: synthesize
    await onProgress(header + `_🧠 阶段 4/5: 按 PDB 标准合成简报_`, false);
    const metaStats = `- 数据日期: ${date}\n- 总消息: ${totalMessages}, 对话: ${totalConversations}\n- 信源库规模: ${Object.keys(this.trust.sources).length}`;
    const mainBrief = await this.synthesize(clustered, llmClient, date, metaStats, extractions);

    // Stage 5: enrich (Tearline + Bias Audit)
    let tearline = '';
    let biasAudit = '';

    if (this.options.enableTearline) {
      await onProgress(header + `_⚡ 阶段 5/5: 生成 30 秒速读版_`, false);
      try {
        tearline = await llmClient.complete(buildTearlinePrompt(mainBrief));
      } catch (e) {
        console.error('Tearline failed:', e);
      }
    }

    if (this.options.enableBiasAudit) {
      await onProgress(header + `_🔍 阶段 5/5: 偏差审计_`, false);
      try {
        biasAudit = await llmClient.complete(buildBiasAuditPrompt(mainBrief));
      } catch (e) {
        console.error('Bias audit failed:', e);
      }
    }

    // Compose final document with Tearline at top (boss reads here first)
    const sections: string[] = [];
    if (tearline) {
      sections.push(`# ⚡ 30 秒速读 — ${date}\n\n${tearline}\n\n---`);
    }
    sections.push(mainBrief);
    if (biasAudit) {
      sections.push(`---\n\n${biasAudit}`);
    }

    const finalDoc = sections.join('\n\n');
    await onProgress(finalDoc, true);
    return finalDoc;
  }

  // Backward-compat
  async generate(messages: ParsedMessage[], llmClient: LlmClient, date: string): Promise<string> {
    return this.generateProgressive(messages, llmClient, date, async () => {});
  }

  buildPrompt(messages: ParsedMessage[], date: string): string {
    const groups = this.groupByConversation(this.triage(messages));
    const text = [...groups.entries()].map(([n, m]) => this.formatConversation(n, m)).join('\n\n');
    return buildPdbSynthesisPrompt(date, this.formatTopSourcesSummary(), text, `- 总消息: ${messages.length}`);
  }

  formatMessagesForAI(messages: ParsedMessage[]): string {
    const groups = this.groupByConversation(this.triage(messages));
    return [...groups.entries()].map(([n, m]) => this.formatConversation(n, m)).join('\n\n');
  }
}
