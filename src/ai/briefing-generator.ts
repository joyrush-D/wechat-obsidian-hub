import type { ParsedMessage, Contact } from '../types';
import { LlmClient } from './llm-client';
import {
  buildExtractionPrompt,
  buildClusteringPrompt,
  buildPdbSynthesisPrompt,
  buildTearlinePrompt,
  buildBiasAuditPrompt,
  buildShareableTearlinePrompt,
  buildReflexiveControlPrompt,
  buildPatternOfLifePromptV2,
  buildDirectSynthesisPrompt,
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
import { IdentityResolver } from '../intel/identity-resolver';

export interface BriefingOptions {
  skipEmoji?: boolean;
  skipSystemMessages?: boolean;
  trust?: SourceTrustData;
  contactsMap?: Map<string, Contact>;
  userWxid?: string;
  userIdentities?: string[];  // all names user could be @'d by (wxid + nickname + remark + alias)
  enableTearline?: boolean;       // 30-sec ultra-condensed version
  enableShareableTearline?: boolean;  // desensitized team-shareable version
  enableBiasAudit?: boolean;      // Heuer's 18-bias check
  enableReflexiveControl?: boolean;  // manipulation/planted info flag
  enablePatternOfLife?: boolean;     // per-important-person daily profile
  extractionStore?: ExtractionStore;  // persistent cache (skip re-extracting unchanged convos)
  identityResolver?: IdentityResolver;  // canonical person index (wxid → all aliases)
}

export class BriefingGenerator {
  private options: BriefingOptions;
  private trust: SourceTrustData;

  constructor(options: BriefingOptions = {}) {
    this.options = {
      skipEmoji: true,
      skipSystemMessages: true,
      // Direct synthesis already emits its own "## 🎯 30 秒速读" section.
      // Running a second-pass tearline compressor would duplicate it, so off by default.
      enableTearline: false,
      // Default OFF for these to reduce LLM call count and avoid model crashes:
      // (User can opt in via plugin settings)
      enableShareableTearline: false,
      enableBiasAudit: false,
      enableReflexiveControl: false,
      enablePatternOfLife: true,
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

  /**
   * Format a conversation with plain-Chinese source labels.
   * Each message is prefixed with its stable id `msg:wechat:<convoId>:<localId>`
   * so downstream Finding extraction can cite real evidence entities rather
   * than the "msg:wechat:unknown" placeholder.
   */
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
      const msgId = `msg:wechat:${msg.conversationId}:${msg.localId}`;
      let line = `[${time}] [${msgId}] ${msg.sender} [${code}]: ${msg.text}`;
      if (msg.type === 'link' && msg.extra.description) line += ` — ${msg.extra.description}`;
      if (msg.extra.url && msg.extra.unsupported !== '1') line += ` (${msg.extra.url})`;
      lines.push(line);
    }
    return lines.join('\n');
  }

  /**
   * Build a mechanical (no-LLM) brief when synthesis fails.
   * Pulls real value from raw messages instead of returning empty template.
   */
  private buildMechanicalFallback(
    date: string,
    groups: Map<string, ParsedMessage[]>,
    metaStats: string,
    errorMsg: string,
  ): string {
    const sections: string[] = [
      `# 微信日报 ${date}`,
      `> ⚠️ AI 合成失败 (${errorMsg.slice(0, 100)})`,
      `> 以下是程序化整理的概览，请重新加载 LM Studio 模型后再生成完整版`,
    ];

    // Top 10 most active conversations
    const top = [...groups.entries()].slice(0, 10);
    sections.push(`\n## 📊 今日最活跃 ${top.length} 个对话`);
    for (const [name, msgs] of top) {
      const senders = new Set(msgs.map(m => m.sender));
      const types = new Set(msgs.map(m => m.type));
      const last = msgs[msgs.length - 1];
      const lastTime = last.time.toTimeString().slice(0, 5);
      sections.push(
        `### ${name} (${msgs.length} 条 / ${senders.size} 人 / 最后 ${lastTime})\n` +
        `**类型**: ${[...types].join(', ')}\n` +
        `**最后一句**: ${last.sender}: ${last.text.slice(0, 100).replace(/\n/g, ' ')}`,
      );
    }

    // All resources/links from today
    const links: string[] = [];
    for (const [name, msgs] of groups) {
      for (const m of msgs) {
        if (m.type === 'link' && m.extra.url && m.extra.unsupported !== '1') {
          const desc = m.extra.description || '';
          links.push(`- **[${m.sender} @ ${name}]** ${m.text} ${desc ? '— ' + desc : ''} (${m.extra.url})`);
        }
      }
    }
    if (links.length > 0) {
      sections.push(`\n## 🔗 今日所有链接 (${links.length} 条)`);
      sections.push(...links.slice(0, 30));
    }

    sections.push(`\n## 📊 元数据\n${metaStats}`);
    return sections.join('\n\n');
  }

  /**
   * Persist a daily record to the extraction store.
   * Used by weekly/topic briefs to look up history.
   * In Direct Synthesis mode, we save the formatted message text per conversation
   * (not LLM-summarized), so future cross-day analyses see the real content.
   */
  private persistDailyRecord(
    date: string,
    groups: Map<string, ParsedMessage[]>,
    allMessagesText: string,
  ): void {
    const store = this.options.extractionStore;
    if (!store) return;

    const entries = [...groups.entries()].map(([name, msgs]) => {
      const lastTs = msgs.length > 0 ? Math.max(...msgs.map(m => Math.floor(m.time.getTime() / 1000))) : 0;
      const conversationId = msgs[0]?.conversationId || '';
      // Save the formatted conversation as "extracted" (it IS the source of truth in direct mode)
      const extracted = this.formatConversation(name, msgs);
      return {
        conversationName: name,
        conversationId,
        msgCount: msgs.length,
        lastMsgTimestamp: lastTs,
        cacheKey: `${name}|${msgs.length}|${lastTs}`,
        extracted,
        extractedAt: new Date().toISOString(),
      };
    });

    try {
      store.saveAll(date, entries);
    } catch (e) {
      console.error('OWH: Failed to persist daily record:', e);
    }
  }

  /**
   * Scan ALL messages for direct @ mentions to the user.
   * Not cached — always runs fresh on current data.
   * Uses ALL user identities (wxid + nickname + remark + alias),
   * because in WeChat groups, people @ by nickname not wxid.
   */
  scanUserMentions(messages: ParsedMessage[]): string {
    const userWxid = (this.options.userWxid || '').toLowerCase();
    const identities = (this.options.userIdentities || (userWxid ? [userWxid] : []))
      .filter(id => id && id.length >= 2)
      .map(id => id.trim());

    if (identities.length === 0) return '';

    // Build a set of all wxids that ARE the user (resolver may return multiple
    // wxids if same person had multiple WeChat accounts, but usually 1).
    // We use this to skip self-messages reliably.
    const selfWxids = new Set<string>();
    selfWxids.add(userWxid);
    if (this.options.identityResolver) {
      const userIdentity = this.options.identityResolver.findByName(userWxid);
      if (userIdentity) selfWxids.add(userIdentity.wxid.toLowerCase());
    }

    const mentions: Array<{ msg: ParsedMessage; reason: string; matchedId: string }> = [];

    for (const msg of messages) {
      if (selfWxids.has(msg.senderWxid.toLowerCase())) continue;  // skip user's own messages
      const text = msg.text;

      // Direct @-mention check (WeChat uses various separators after @name:
      // space, colon, newline, \u2005 mention-space, end-of-string)
      let matched = false;
      let reason = '';
      let matchedId = '';
      for (const id of identities) {
        if (!id) continue;
        // Case-insensitive substring match for @<id>
        const idx = text.toLowerCase().indexOf(`@${id.toLowerCase()}`);
        if (idx >= 0) {
          // Verify it's a real mention (followed by non-word boundary)
          const afterIdx = idx + 1 + id.length;
          const after = text[afterIdx] || ' ';
          if (!/[a-zA-Z0-9_]/.test(after)) {
            matched = true;
            reason = `@${id}`;
            matchedId = id;
            break;
          }
        }
      }

      // Direct message (1-on-1 with user as conversation)
      if (!matched && (msg.conversationId === userWxid || identities.includes(msg.conversationId))) {
        matched = true;
        reason = `私聊消息`;
      }

      if (matched) mentions.push({ msg, reason, matchedId });
    }

    if (mentions.length === 0) return '';

    // Sort by time desc (newest first)
    mentions.sort((a, b) => b.msg.time.getTime() - a.msg.time.getTime());

    const lines: string[] = [
      `## 📍 直接 @ 你的消息（${mentions.length} 条）`,
      '',
    ];
    for (const { msg, reason } of mentions.slice(0, 30)) {
      // Show FULL datetime including seconds so user can verify freshness
      const hhmmss = msg.time.toTimeString().slice(0, 8);
      const sender = msg.sender || msg.senderWxid;
      const text = msg.text.slice(0, 300).replace(/\n/g, ' ');
      // Conversation name → [[WeChat-Groups/群名]] wikilink (lazily generated on click)
      const convoTag = msg.conversationName && !msg.conversationName.match(/^[a-f0-9]{32}$/)
        ? `[[WeChat-Groups/${msg.conversationName}|${msg.conversationName}]]`
        : `_${msg.conversationId || msg.conversationName}_ (未命名)`;
      lines.push(`- 🔴 **[${hhmmss}] ${sender}** 在 ${convoTag} — ${reason}`);
      lines.push(`  > ${text}`);
    }
    return lines.join('\n');
  }

  /**
   * Mechanical Pattern of Life — lists EVERY contact with a remark + top-N active,
   * regardless of whether their content is "interesting" to LLM.
   * Ensures user can answer "did X message today?" at a glance.
   */
  buildMechanicalPatternOfLife(messages: ParsedMessage[]): string {
    const contactsMap = this.options.contactsMap || new Map();
    const resolver = this.options.identityResolver;
    const bySpeaker = new Map<string, { msgs: ParsedMessage[]; displayName: string; hasRemark: boolean }>();

    for (const msg of messages) {
      if (!msg.senderWxid || msg.senderWxid === this.options.userWxid) continue;
      // Skip user under any alias
      if (this.options.userIdentities && this.options.userIdentities.includes(msg.senderWxid)) continue;
      if (msg.type === 'emoji' || msg.type === 'system') continue;
      if (!bySpeaker.has(msg.senderWxid)) {
        // PRIORITY: IdentityResolver canonical name > contact remark > nickName > parsed sender > wxid
        let display: string;
        let hasRemark = false;
        if (resolver) {
          const ident = resolver.get(msg.senderWxid);
          if (ident) {
            display = ident.primaryName;
            hasRemark = ident.hasRemark;
          } else {
            display = msg.sender || msg.senderWxid;
          }
        } else {
          const contact = contactsMap.get(msg.senderWxid);
          display = contact?.remark || contact?.nickName || msg.sender || msg.senderWxid;
          hasRemark = !!contact?.remark;
        }
        bySpeaker.set(msg.senderWxid, { msgs: [], displayName: display, hasRemark });
      }
      bySpeaker.get(msg.senderWxid)!.msgs.push(msg);
    }

    // Skip wxid_-only entries (no real name) to avoid noise
    const named = [...bySpeaker.entries()].filter(([, info]) => {
      return !/^wxid_[a-z0-9]+$/i.test(info.displayName);
    });

    // Everyone with a remark gets listed; plus top-N most active (even without remark)
    const withRemark = named.filter(([, info]) => info.hasRemark);
    const withoutRemark = named
      .filter(([, info]) => !info.hasRemark)
      .sort((a, b) => b[1].msgs.length - a[1].msgs.length)
      .slice(0, 8);

    const combined = [...withRemark, ...withoutRemark].sort((a, b) => {
      // remarked first, then by msg count
      const scoreA = (a[1].hasRemark ? 1000 : 0) + a[1].msgs.length;
      const scoreB = (b[1].hasRemark ? 1000 : 0) + b[1].msgs.length;
      return scoreB - scoreA;
    });

    if (combined.length === 0) return '### 今日无有名联系人发言记录';

    const lines: string[] = ['### 📋 今日有发言的重要联系人（机械完整列表）', ''];
    for (const [wxid, info] of combined) {
      const msgs = info.msgs;
      const conversations = new Set(msgs.map(m => m.conversationName));
      const types = new Set(msgs.map(m => m.type));
      const lastMsg = msgs[msgs.length - 1];
      const lastTime = lastMsg.time.toTimeString().slice(0, 5);
      const typesList = [...types].join('/');

      // Pick one representative text message (longest meaningful text)
      const textMsgs = msgs.filter(m => m.type === 'text' && m.text.length > 5);
      const highlight = textMsgs.sort((a, b) => b.text.length - a.text.length)[0];
      const sample = highlight ? `"${highlight.text.slice(0, 80).replace(/\n/g, ' ')}"` : '（纯多媒体/未提取文本）';

      const remarkTag = info.hasRemark ? ' 📌' : '';
      // Identity resolution happens BEHIND THE SCENES — we don't display alias noise,
      // we just guarantee aggregation counts the same person once regardless of which
      // group-specific nickname they used.
      lines.push(`- **${info.displayName}${remarkTag}** — ${msgs.length} 条 · 跨 ${conversations.size} 个对话 · 最后 ${lastTime} · 类型: ${typesList}`);
      lines.push(`  代表发言: ${sample}`);
    }
    return lines.join('\n');
  }

  /**
   * Build per-person daily data for Pattern of Life analysis.
   * Returns top 8 speakers (by message volume or trust grade), with their quotes across groups.
   */
  buildPerPersonData(messages: ParsedMessage[]): string {
    const contactsMap = this.options.contactsMap || new Map();
    const resolver = this.options.identityResolver;
    const bySpeaker = new Map<string, { msgs: ParsedMessage[]; displayName: string }>();

    for (const msg of messages) {
      if (!msg.senderWxid || msg.senderWxid === this.options.userWxid) continue;
      if (this.options.userIdentities && this.options.userIdentities.includes(msg.senderWxid)) continue;
      if (msg.type === 'emoji' || msg.type === 'system') continue;
      if (msg.text.trim().length < 3) continue;
      if (!bySpeaker.has(msg.senderWxid)) {
        // Canonical name from IdentityResolver
        let display: string;
        if (resolver) {
          const ident = resolver.get(msg.senderWxid);
          display = ident?.primaryName || msg.sender || msg.senderWxid;
        } else {
          display = msg.sender || contactsMap.get(msg.senderWxid)?.remark || contactsMap.get(msg.senderWxid)?.nickName || msg.senderWxid;
        }
        bySpeaker.set(msg.senderWxid, { msgs: [], displayName: display });
      }
      bySpeaker.get(msg.senderWxid)!.msgs.push(msg);
    }

    // Filter: ONLY include people with a real name (not raw wxid_xxx).
    // Raw wxids = unknown contacts, user can't recognize them anyway.
    const namedSpeakers = [...bySpeaker.entries()].filter(([, info]) => {
      // Skip if display name looks like a raw wxid
      return !/^wxid_[a-z0-9]+$/i.test(info.displayName);
    });

    // Sort by: remarked first (user explicitly cared), then by message volume
    const speakers = namedSpeakers.sort((a, b) => {
      const ca = contactsMap.get(a[0]);
      const cb = contactsMap.get(b[0]);
      const sa = (ca?.remark ? 1000 : 0) + a[1].msgs.length;
      const sb = (cb?.remark ? 1000 : 0) + b[1].msgs.length;
      return sb - sa;
    }).slice(0, 8);  // top 8

    if (speakers.length === 0) return '';

    const sections: string[] = [];
    for (const [wxid, info] of speakers) {
      const msgs = info.msgs;
      const name = info.displayName;
      const conversations = new Set(msgs.map(m => m.conversationName));
      const lines = [`### ${name} (${msgs.length} 条，跨 ${conversations.size} 个对话)`];

      // Show top 8 most informative messages (filter: any text non-empty, skip emoji)
      // Lowered threshold from >10 to >=3 after user noticed short but meaningful
      // messages (e.g. "你这是什么时候的") were filtered out.
      const informative = msgs
        .filter(m => m.text.length >= 3 && m.type !== 'emoji')
        .sort((a, b) => b.text.length - a.text.length)
        .slice(0, 8);

      for (const m of informative) {
        const time = m.time.toTimeString().slice(0, 5);
        const text = m.text.slice(0, 150).replace(/\n/g, ' ');
        lines.push(`[${time} @ ${m.conversationName}]: ${text}`);
      }
      sections.push(lines.join('\n'));
    }

    return sections.join('\n\n');
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
   * Direct Synthesis pipeline — single-pass briefing on RAW messages.
   * Avoids cascaded summarization information loss.
   * Requires large context model (~100K+ tokens).
   *
   * Steps:
   * 1. TRIAGE (mechanical, no LLM): filter noise
   * 2. SPLIT (mechanical, no LLM): group by conversation, format with metadata
   * 3. SYNTHESIZE (1 LLM call): full PDB brief from raw messages
   * 4. ENRICH (parallel LLM calls): Tearline, Pattern of Life, Reflexive Control, etc.
   */
  async generateProgressive(
    messages: ParsedMessage[],
    llmClient: LlmClient,
    date: string,
    onProgress: (content: string, done: boolean) => Promise<void>,
  ): Promise<string> {
    if (this.options.contactsMap || this.options.identityResolver) {
      updateTrust(
        this.trust,
        messages,
        this.options.contactsMap || new Map(),
        this.options.userWxid,
        this.options.identityResolver,
        this.options.userIdentities,
      );
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

    await onProgress(header + `_🔍 阶段 1/3: 信号分流完成_`, false);

    // Stage 2: SPLIT (mechanical, no LLM) — format raw messages by conversation
    const allMessagesText = this.formatMessagesForAI(triaged);
    const metaStats = `- 数据日期: ${date}\n- 总消息: ${totalMessages}, 对话: ${totalConversations}\n- 信源库规模: ${Object.keys(this.trust.sources).length}`;

    // Hard cap input to ~80K chars (leaves room for prompt overhead within 262K context)
    const MAX_DIRECT_INPUT = 80000;
    const trimmedAllMessages = allMessagesText.length > MAX_DIRECT_INPUT
      ? allMessagesText.slice(0, MAX_DIRECT_INPUT) + '\n\n...(超出限制已截断)'
      : allMessagesText;

    await onProgress(header + `_🧠 阶段 2/3: 直接合成简报 (单次 LLM 调用，输入 ${trimmedAllMessages.length} 字符)_`, false);

    // Stage 3: SYNTHESIZE — single direct synthesis on raw messages
    let mainBrief: string;
    let synthesisFailed = false;
    try {
      const directPrompt = buildDirectSynthesisPrompt(
        date,
        trimmedAllMessages,
        metaStats,
        this.options.userWxid,
        this.options.userIdentities,
      );
      mainBrief = await llmClient.complete(directPrompt);
      if (!mainBrief || mainBrief.length < 100) {
        throw new Error('LLM 返回内容过短，可能模型崩溃');
      }
    } catch (e) {
      console.error('Direct synthesis failed:', e);
      synthesisFailed = true;
      // Build a structured fallback that preserves raw value:
      // - top 10 active conversations summarized mechanically
      // - all message types broken down
      mainBrief = this.buildMechanicalFallback(date, groups, metaStats, (e as Error).message);
    }

    // Save extraction record for accumulation layer (used by weekly/topic briefs)
    this.persistDailyRecord(date.slice(0, 10), groups, allMessagesText);

    // Stage 5: enrich (parallel-ish: Tearline, Bias Audit, Reflexive Control, Pattern of Life, Shareable)
    let tearline = '';
    let biasAudit = '';
    let shareable = '';
    let reflexive = '';
    let patternOfLife = '';

    if (this.options.enableTearline) {
      await onProgress(header + `_⚡ 阶段 5: 生成 30 秒速读版_`, false);
      try {
        tearline = await llmClient.complete(buildTearlinePrompt(mainBrief));
      } catch (e) {
        console.error('Tearline failed:', e);
      }
    }

    if (this.options.enableReflexiveControl) {
      await onProgress(header + `_🛡️ 阶段 5: 反操纵评估_`, false);
      try {
        // Use the main brief as input (already analyzed) — avoids hallucinations from raw clutter
        reflexive = await llmClient.complete(buildReflexiveControlPrompt(mainBrief.slice(0, 15000)));
      } catch (e) {
        console.error('Reflexive control failed:', e);
      }
    }

    if (this.options.enablePatternOfLife) {
      await onProgress(header + `_👥 阶段 5: 重要人物画像_`, false);

      // STEP 1: Mechanical listing — every remarked contact gets included, period.
      const mechanicalSection = this.buildMechanicalPatternOfLife(messages);

      // STEP 2: LLM deep analysis on top-3 most active (optional add-on)
      const perPersonData = this.buildPerPersonData(messages);
      let llmDeepAnalysis = '';
      if (perPersonData) {
        try {
          llmDeepAnalysis = await llmClient.complete(buildPatternOfLifePromptV2(perPersonData));
        } catch (e) {
          console.error('Pattern of life LLM failed:', e);
        }
      }

      // Combine: mechanical list first (complete), then LLM deep analysis (focused)
      patternOfLife = mechanicalSection + (llmDeepAnalysis ? '\n\n### 🔬 深度画像（AI 分析）\n\n' + llmDeepAnalysis : '');
    }

    if (this.options.enableBiasAudit) {
      await onProgress(header + `_🔍 阶段 5: 偏差审计_`, false);
      try {
        biasAudit = await llmClient.complete(buildBiasAuditPrompt(mainBrief));
      } catch (e) {
        console.error('Bias audit failed:', e);
      }
    }

    if (this.options.enableShareableTearline) {
      await onProgress(header + `_📤 阶段 5: 生成可分享版_`, false);
      try {
        shareable = await llmClient.complete(buildShareableTearlinePrompt(mainBrief));
      } catch (e) {
        console.error('Shareable failed:', e);
      }
    }

    // Scan raw messages for @ mentions — this is NOT cached, always fresh
    const directMentions = this.scanUserMentions(messages);

    // IdentityResolver does its consolidation work behind the scenes — the
    // analyst output shows primary names only. The alias-index appendix is
    // deliberately omitted: readers don't need the mapping, they need clean
    // consistent aggregation.

    // Compose final document. Order matters for boss UX:
    // 1. Second-pass Tearline (optional; skipped by default since direct synthesis
    //    already has its own "30 秒速读" section)
    // 2. Direct @ mentions (raw scan, never cached)
    // 3. Main brief (full PDB, its own BLUF up top)
    // 4. Pattern of Life (who said what — names aggregated per wxid, no alias noise)
    // 5. Reflexive Control (what to question)
    // 6. Bias Audit (self-check)
    // 7. Shareable Tearline (team-ready, below dashed line)
    const sections: string[] = [];
    if (tearline) {
      sections.push(`# ⚡ 30 秒速读（压缩版） — ${date}\n\n${tearline}\n\n---`);
    }
    if (directMentions) {
      sections.push(directMentions + '\n\n---');
    }
    sections.push(mainBrief);
    if (patternOfLife) {
      sections.push(`---\n\n## 👥 重要人物今日画像 (Pattern of Life)\n\n${patternOfLife}`);
    }
    if (reflexive) {
      sections.push(`---\n\n${reflexive}`);
    }
    if (biasAudit) {
      sections.push(`---\n\n${biasAudit}`);
    }
    if (shareable) {
      sections.push(`\n\n---\n---\n**以上为私人版（仅供自己）**\n\n**以下为脱敏分享版（可转发给团队）**\n---\n---\n\n${shareable}`);
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
