/**
 * PersonProfile — auto-generated/updated per-person notes that live in
 * `<vault>/WeChat-People/<name>.md`. Each note has:
 *   - YAML frontmatter (Dataview-queryable: aliases, wxid, group_count, ...)
 *   - "档案概览" section with stats
 *   - "出现的简报" — list of briefings that wikilinked this person (auto)
 *   - "近期发言样本" — short message excerpts
 *
 * Updates are idempotent: re-running on the same person merges new
 * briefing references without duplicating, and refreshes the stats.
 */

import type { Identity } from '../intel/identity-resolver';

export interface PersonProfileInput {
  identity: Identity;
  /** Stable group display names this person appears in (sorted, deduped). */
  groupNames: string[];
  /** Briefing slugs the person has been mentioned in (sorted desc by date). */
  recentBriefingSlugs: string[];
  /** Up to 8 short representative quotes (latest first). */
  recentQuotes?: Array<{ time: string; text: string; conversation: string }>;
  /** Briefing folder path, used to build wikilinks. */
  briefingFolder: string;
}

const PROFILE_MARKER_BEGIN = '<!-- OWH:auto-begin -->';
const PROFILE_MARKER_END = '<!-- OWH:auto-end -->';

/**
 * Render a fresh profile note. Auto-managed sections live between the
 * OWH:auto-begin / OWH:auto-end markers so users can add their own
 * notes outside the markers without losing them on refresh.
 */
export function renderPersonProfile(input: PersonProfileInput): string {
  const { identity, groupNames, recentBriefingSlugs, recentQuotes, briefingFolder } = input;

  const frontmatter = renderFrontmatter({
    type: 'wechat-person',
    wxid: identity.wxid,
    primary_name: identity.primaryName,
    aliases: [...identity.allNames].slice(0, 30),
    group_count: groupNames.length,
    has_remark: identity.hasRemark,
    last_updated: new Date().toISOString(),
  });

  const lines: string[] = [];
  lines.push(`# ${identity.primaryName}${identity.hasRemark ? ' 📌' : ''}`);
  lines.push('');
  lines.push(PROFILE_MARKER_BEGIN);
  lines.push('');
  lines.push('## 📋 档案概览');
  lines.push('');
  lines.push(`- **微信 ID**: \`${identity.wxid}\``);
  if (identity.allNames.size > 1) {
    const otherNames = [...identity.allNames].filter(n => n !== identity.primaryName && n !== identity.wxid);
    if (otherNames.length > 0) {
      lines.push(`- **别名 (${otherNames.length})**: ${otherNames.slice(0, 12).join(' · ')}${otherNames.length > 12 ? ` 等共 ${otherNames.length} 个` : ''}`);
    }
  }
  lines.push(`- **所在群 (${groupNames.length})**: ${groupNames.length > 0 ? groupNames.slice(0, 8).join(' · ') + (groupNames.length > 8 ? ` ... ` : '') : '(无)'}`);
  lines.push(`- **是否备注**: ${identity.hasRemark ? '✅ 已备注（重要联系人）' : '❌ 未备注'}`);
  lines.push('');

  if (recentBriefingSlugs.length > 0) {
    lines.push('## 📅 近期出现的简报');
    lines.push('');
    for (const slug of recentBriefingSlugs.slice(0, 30)) {
      lines.push(`- [[${briefingFolder}/${slug}]]`);
    }
    lines.push('');
  }

  if (recentQuotes && recentQuotes.length > 0) {
    lines.push('## 💬 近期发言样本');
    lines.push('');
    for (const q of recentQuotes.slice(0, 8)) {
      lines.push(`- **[${q.time}] @ ${q.conversation}**: ${q.text.slice(0, 120).replace(/\n/g, ' ')}`);
    }
    lines.push('');
  }

  lines.push(PROFILE_MARKER_END);
  lines.push('');
  lines.push('## ✏️ 我的笔记（不会被自动更新覆盖）');
  lines.push('');
  lines.push('_在这里写你对这位联系人的私人观察、决策记录、TODO 等。_');

  return frontmatter + '\n' + lines.join('\n') + '\n';
}

/**
 * Update an existing profile by replacing only the auto-managed region
 * (between markers). Any user-added notes after the END marker are preserved.
 * If the file doesn't have markers (first time, or manually edited),
 * the whole content is replaced with the freshly rendered version.
 */
export function updatePersonProfile(existingContent: string, input: PersonProfileInput): string {
  const fresh = renderPersonProfile(input);
  if (!existingContent.includes(PROFILE_MARKER_BEGIN) || !existingContent.includes(PROFILE_MARKER_END)) {
    return fresh;
  }

  // Extract user-edited content (after the end marker)
  const endIdx = existingContent.indexOf(PROFILE_MARKER_END);
  const userEnd = existingContent.slice(endIdx + PROFILE_MARKER_END.length);

  // Take the new fresh up to the end marker, then append user's preserved tail
  const freshEnd = fresh.indexOf(PROFILE_MARKER_END);
  if (freshEnd === -1) return fresh;
  return fresh.slice(0, freshEnd + PROFILE_MARKER_END.length) + userEnd;
}

/**
 * Merge new briefing slugs into the existing profile's slug list (no dupes,
 * sorted desc). Used to extract the prior recentBriefingSlugs before
 * regenerating.
 */
export function extractExistingBriefingSlugs(existingContent: string): string[] {
  const slugs: string[] = [];
  const re = /\[\[[^\]/]+\/([^\]|]+)\]\]/g;
  let match: RegExpExecArray | null;
  // Only parse inside the auto-region
  const begin = existingContent.indexOf(PROFILE_MARKER_BEGIN);
  const end = existingContent.indexOf(PROFILE_MARKER_END);
  const region = (begin >= 0 && end > begin)
    ? existingContent.slice(begin, end)
    : existingContent;
  while ((match = re.exec(region)) !== null) {
    if (match[1].match(/^\d{4}-\d{2}-\d{2}/)) slugs.push(match[1]);
  }
  return [...new Set(slugs)];
}

// ----------------------------------------------------------------------
// Internals
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
  // Pure numeric strings render unquoted (as numbers)
  if (/^-?\d+(\.\d+)?$/.test(s)) return s;
  // Special leading characters or ambiguous content → quote
  if (/^[\s\-:#&*?|>%@`]/.test(s) || s.includes(': ') || s.includes(' #') || s.includes('\n')) {
    return JSON.stringify(s);
  }
  return s;
}
