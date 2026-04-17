/**
 * Group Dossier — lazily-generated per-group intel note.
 * Created the first time a user clicks [[WeChat-Groups/群名]] in a briefing.
 * Does NOT pre-populate all groups (would clutter vault with 300+ notes).
 */

import type { ContactReader } from '../db/contact-reader';
import type { MessageReader } from '../db/message-reader';
import type { ParsedMessage, Contact } from '../types';
import { parseMessage } from '../parser/index';
import type { IdentityResolver } from './identity-resolver';

export interface GroupDossierInput {
  groupWxid: string;           // real wxid like "58263875481@chatroom"
  groupName: string;           // resolved display name
  contactReader: ContactReader;
  messageReader: MessageReader;
  daysBack?: number;           // how many days of messages to include
  userIdentities?: string[];   // to detect @ mentions to user
  identityResolver?: IdentityResolver;  // canonical person names
}

/**
 * Build a Markdown dossier for a single group.
 * Mechanical summary + selected real messages, no LLM.
 */
export function buildGroupDossier(input: GroupDossierInput): string {
  const { groupWxid, groupName, contactReader, messageReader, userIdentities = [], identityResolver } = input;
  const daysBack = input.daysBack ?? 7;

  const since = new Date(Date.now() - daysBack * 24 * 3600 * 1000);
  // Resolve table hash from wxid
  const { createHash } = require('crypto');
  const tableHash = createHash('md5').update(groupWxid).digest('hex');
  const tableName = `Msg_${tableHash}`;

  let rawMessages;
  try {
    rawMessages = messageReader.getMessages(tableName, since, 2000);
  } catch {
    return `# ${groupName}\n\n> ❌ 未找到该群的消息表（${tableName}）`;
  }

  if (rawMessages.length === 0) {
    return `# ${groupName}\n\n> wxid: \`${groupWxid}\`\n> 过去 ${daysBack} 天内无消息记录`;
  }

  // Parse messages
  const parsed: ParsedMessage[] = [];
  for (const raw of rawMessages) {
    const p = parseMessage(raw);
    let senderWxid = p.senderWxid || '';
    if (!senderWxid || /^\d+$/.test(senderWxid)) {
      senderWxid = messageReader.resolveSenderId(raw.real_sender_id);
    }
    // Canonical name from resolver (same person across groups → same display name)
    let senderName: string;
    if (identityResolver) {
      const ident = identityResolver.get(senderWxid);
      senderName = ident?.primaryName || senderWxid;
    } else {
      const senderContact = contactReader.getContact(senderWxid);
      senderName = senderContact?.remark || senderContact?.nickName || senderWxid;
    }
    parsed.push({
      localId: raw.local_id,
      time: new Date(raw.create_time * 1000),
      conversationId: groupWxid,
      conversationName: groupName,
      sender: senderName,
      senderWxid,
      text: p.text,
      type: p.type,
      extra: p.extra,
    });
  }

  // Aggregations — key by wxid so multi-alias people don't get double-counted
  const speakerStats = new Map<string, { name: string; count: number }>();
  for (const m of parsed) {
    const key = m.senderWxid || m.sender;
    const existing = speakerStats.get(key);
    if (existing) existing.count++;
    else speakerStats.set(key, { name: m.sender, count: 1 });
  }
  const topSpeakers = [...speakerStats.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10);

  const links: ParsedMessage[] = parsed.filter(m => m.type === 'link' && m.extra.url && m.extra.unsupported !== '1');

  // @user mentions in this group (all user identities considered)
  const selfWxids = new Set<string>();
  if (identityResolver && userIdentities.length > 0) {
    for (const id of userIdentities) {
      const found = identityResolver.findByName(id);
      if (found) selfWxids.add(found.wxid);
    }
  }
  const userMentions = parsed.filter(m => {
    if (userIdentities.length === 0) return false;
    if (selfWxids.has(m.senderWxid)) return false;  // skip user's own messages
    const t = m.text.toLowerCase();
    return userIdentities.some(id => id && id.length >= 2 && t.includes(`@${id.toLowerCase()}`));
  });

  // Daily message counts
  const byDay = new Map<string, number>();
  for (const m of parsed) {
    const d = m.time.toISOString().slice(0, 10);
    byDay.set(d, (byDay.get(d) || 0) + 1);
  }

  // Build markdown
  const lines: string[] = [];
  lines.push(`# ${groupName}`);
  lines.push('');
  lines.push(`> **WXID**: \`${groupWxid}\`  `);
  lines.push(`> **分析范围**: 过去 ${daysBack} 天  `);
  lines.push(`> **消息总数**: ${parsed.length}  `);
  lines.push(`> **活跃发言人数**: ${speakerStats.size}  `);
  lines.push(`> **📅 档案生成时间**: ${new Date().toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-')}  `);
  lines.push('');
  lines.push('---');
  lines.push('');

  // @ 你
  if (userMentions.length > 0) {
    lines.push(`## 📍 @ 你的消息（${userMentions.length} 条）`);
    lines.push('');
    for (const m of userMentions.slice(-30).reverse()) {
      const t = m.time.toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-');
      lines.push(`- **[${t}] ${m.sender}**: ${m.text.slice(0, 300).replace(/\n/g, ' ')}`);
    }
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  // 每日消息量
  lines.push('## 📊 每日消息量');
  lines.push('');
  const sortedDays = [...byDay.entries()].sort();
  for (const [d, c] of sortedDays) {
    const bar = '█'.repeat(Math.min(Math.round(c / 5), 50));
    lines.push(`- \`${d}\`: ${c.toString().padStart(4)} ${bar}`);
  }
  lines.push('');

  // 活跃发言人 — dedup happens by wxid upstream (speakerStats), names shown clean.
  // IdentityResolver ensures same person counted once across group nicknames.
  lines.push('## 👥 活跃发言人 Top 10');
  lines.push('');
  for (const [, info] of topSpeakers) {
    const pct = Math.round((info.count / parsed.length) * 100);
    lines.push(`- **${info.name}**: ${info.count} 条 (${pct}%)`);
  }
  lines.push('');

  // 分享链接
  if (links.length > 0) {
    lines.push(`## 🔗 分享的链接（${links.length} 条）`);
    lines.push('');
    for (const m of links.slice(-30).reverse()) {
      const t = m.time.toLocaleDateString('zh-CN').replace(/\//g, '-');
      const desc = m.extra.description ? ` — ${m.extra.description}` : '';
      lines.push(`- [${t}] **${m.sender}**: ${m.text}${desc}`);
      if (m.extra.url) lines.push(`  - ${m.extra.url}`);
    }
    lines.push('');
  }

  // 最近原始消息
  lines.push('## 💬 最近 100 条原始消息');
  lines.push('');
  for (const m of parsed.slice(-100)) {
    const t = m.time.toLocaleTimeString('zh-CN', { hour12: false });
    const d = m.time.toLocaleDateString('zh-CN').replace(/\//g, '-');
    const text = m.text.slice(0, 200).replace(/\n/g, ' ');
    lines.push(`- \`${d} ${t}\` **${m.sender}**: ${text}`);
  }

  return lines.join('\n');
}
