/**
 * TopicProfile — auto-generated/updated per-topic profile pages at
 * <vault>/WeChat-Topics/<slug>.md. Mirror of person-profile.ts but
 * indexed by topic title rather than person.
 *
 * Each profile carries:
 *   - YAML frontmatter for Dataview queries (type, title, briefing_count)
 *   - 📋 概览: latest core summary + first-seen + last-seen dates
 *   - 📅 出现的简报: backlinks to every briefing that mentioned this topic
 *   - 🔗 相关消息: msg:wechat:... ids cited (for evidence drilldown)
 *   - ✏️ 我的笔记: user-editable section preserved across regenerations
 */

import type { ExtractedTopic } from './topic-extractor';

export interface TopicProfileInput {
  topic: ExtractedTopic;
  /** Briefing slugs that have mentioned this topic (sorted desc). */
  briefingSlugs: string[];
  /** Briefing folder for backlinks. */
  briefingFolder: string;
  /** ISO timestamp of "first seen" (oldest briefing date). */
  firstSeen: string;
  /** ISO timestamp of "last seen" (newest briefing date). */
  lastSeen: string;
}

const PROFILE_BEGIN = '<!-- OWH:topic-auto-begin -->';
const PROFILE_END = '<!-- OWH:topic-auto-end -->';

export function renderTopicProfile(input: TopicProfileInput): string {
  const { topic, briefingSlugs, briefingFolder, firstSeen, lastSeen } = input;

  const frontmatter = renderFrontmatter({
    type: 'wechat-topic',
    title: topic.title,
    briefing_count: briefingSlugs.length,
    first_seen: firstSeen,
    last_seen: lastSeen,
    last_updated: new Date().toISOString(),
    cited_messages: topic.citedMessageIds.length,
  });

  const lines: string[] = [];
  lines.push(`# ${topic.title}`);
  lines.push('');
  lines.push(PROFILE_BEGIN);
  lines.push('');
  lines.push('## 📋 概览');
  lines.push('');
  if (topic.coreSummary) {
    lines.push(`- **最新核心**: ${topic.coreSummary}`);
  }
  lines.push(`- **首次出现**: ${firstSeen.slice(0, 10)}`);
  lines.push(`- **最近出现**: ${lastSeen.slice(0, 10)}`);
  lines.push(`- **总简报数**: ${briefingSlugs.length}`);
  if (topic.involvedConversations.length > 0) {
    lines.push(`- **涉及对话**: ${topic.involvedConversations.slice(0, 8).join(' · ')}`);
  }
  lines.push('');

  if (briefingSlugs.length > 0) {
    lines.push('## 📅 出现的简报');
    lines.push('');
    for (const slug of briefingSlugs.slice(0, 30)) {
      lines.push(`- [[${briefingFolder}/${slug}]]`);
    }
    lines.push('');
  }

  if (topic.citedMessageIds.length > 0) {
    lines.push('## 🔗 引用的原始消息');
    lines.push('');
    for (const id of topic.citedMessageIds.slice(0, 20)) {
      lines.push(`- \`${id}\``);
    }
    lines.push('');
  }

  lines.push(PROFILE_END);
  lines.push('');
  lines.push('## ✏️ 我的笔记（不会被自动更新覆盖）');
  lines.push('');
  lines.push('_在这里写你对这个话题的私人观察、决策记录、TODO 等。_');

  return frontmatter + '\n' + lines.join('\n') + '\n';
}

export function updateTopicProfile(existing: string, input: TopicProfileInput): string {
  const fresh = renderTopicProfile(input);
  if (!existing.includes(PROFILE_BEGIN) || !existing.includes(PROFILE_END)) {
    return fresh;
  }
  const endIdx = existing.indexOf(PROFILE_END);
  const userTail = existing.slice(endIdx + PROFILE_END.length);
  const freshEnd = fresh.indexOf(PROFILE_END);
  if (freshEnd === -1) return fresh;
  return fresh.slice(0, freshEnd + PROFILE_END.length) + userTail;
}

export function extractExistingBriefingSlugsFromTopic(existing: string): string[] {
  const slugs: string[] = [];
  const re = /\[\[[^\]/]+\/([^\]|]+)\]\]/g;
  let m: RegExpExecArray | null;
  const begin = existing.indexOf(PROFILE_BEGIN);
  const end = existing.indexOf(PROFILE_END);
  const region = (begin >= 0 && end > begin) ? existing.slice(begin, end) : existing;
  while ((m = re.exec(region)) !== null) {
    if (m[1].match(/^\d{4}-\d{2}-\d{2}/)) slugs.push(m[1]);
  }
  return [...new Set(slugs)];
}

// ----------------------------------------------------------------------
// Internals (duplicated from person-profile.ts intentionally to keep
// the two modules independent — easier to evolve separately)
// ----------------------------------------------------------------------

function renderFrontmatter(fields: Record<string, unknown>): string {
  const lines: string[] = ['---'];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      lines.push(`${k}:`);
      for (const item of v) lines.push(`  - ${yamlValueFor(item)}`);
    } else {
      lines.push(`${k}: ${yamlValueFor(v)}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

function yamlValueFor(v: unknown): string {
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return yamlEscapeString(String(v));
}

function yamlEscapeString(s: string): string {
  if (/^-?\d+(\.\d+)?$/.test(s)) return s;
  if (/^[\s\-:#&*?|>%@`]/.test(s) || s.includes(': ') || s.includes(' #') || s.includes('\n')) {
    return JSON.stringify(s);
  }
  return s;
}
