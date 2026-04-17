/**
 * Identity Formatter — single source of truth for how a person is rendered
 * in analyst output.
 *
 * Rule (see memory/feedback_owh_recurring_rules.md §3):
 *   - Default display = primaryName (remark > nickname > wxid)
 *   - When a person has ≥2 aliases, first appearance MUST be annotated with
 *     their wxid + per-group aliases so the reader can cross-reference.
 *   - Subsequent appearances of the same person on the same page use plain
 *     primaryName (tracked via `seenWxids` set).
 */

import type { Identity, IdentityResolver } from './identity-resolver';

/**
 * Check if an identity has multiple aliases worth annotating.
 * Threshold: ≥2 human-facing names (excluding bare wxid).
 */
export function hasMultipleAliases(identity: Identity): boolean {
  let humanNames = 0;
  for (const n of identity.allNames) {
    if (!/^wxid_[a-zA-Z0-9_-]+$/i.test(n)) humanNames++;
    if (humanNames >= 2) return true;
  }
  return false;
}

/**
 * Format a person's name for inline appearance in a paragraph.
 * - First appearance (not in `seen`): "罗俊（ID: wxid_abc；数字游民群: Dexter · 家族群: 罗舒杨爸爸）"
 * - Subsequent appearance: "罗俊"
 * - Single-alias person: always plain primaryName
 */
export function formatPersonInline(
  identity: Identity,
  resolver: IdentityResolver,
  seen: Set<string>,
): string {
  const name = identity.primaryName;
  if (seen.has(identity.wxid)) return name;
  seen.add(identity.wxid);
  if (!hasMultipleAliases(identity)) return name;

  const groupEntries = resolver.getGroupAliasEntries(identity.wxid)
    .filter(e => e.alias && e.alias !== name);

  const parts: string[] = [`ID: ${identity.wxid}`];
  if (groupEntries.length > 0) {
    const aliasList = groupEntries
      .slice(0, 4)  // cap at 4 group aliases inline
      .map(e => `${e.groupName}: ${e.alias}`)
      .join(' · ');
    parts.push(aliasList);
    if (groupEntries.length > 4) parts.push(`另 ${groupEntries.length - 4} 个群`);
  }
  return `${name}（${parts.join('；')}）`;
}

/**
 * Build a "person alias index" table to be appended to a briefing header.
 * Lists every person with ≥2 aliases who appears in today's relevant wxids.
 * Sorted: people with remark first, then by alias count desc.
 */
export function buildAliasIndex(
  relevantWxids: Iterable<string>,
  resolver: IdentityResolver,
): string {
  const rows: Array<{ identity: Identity; aliases: Array<{ groupName: string; alias: string }> }> = [];

  for (const wxid of relevantWxids) {
    const identity = resolver.get(wxid);
    if (!identity) continue;
    if (identity.isGroup) continue;
    if (!hasMultipleAliases(identity)) continue;
    const aliases = resolver.getGroupAliasEntries(wxid)
      .filter(e => e.alias && e.alias !== identity.primaryName);
    if (aliases.length === 0 && identity.globalNames.size <= 2) continue;  // only wxid+nickname, no extras
    rows.push({ identity, aliases });
  }

  if (rows.length === 0) return '';

  rows.sort((a, b) => {
    const sa = (a.identity.hasRemark ? 1000 : 0) + a.aliases.length;
    const sb = (b.identity.hasRemark ? 1000 : 0) + b.aliases.length;
    return sb - sa;
  });

  const lines: string[] = [
    '### 👤 今日人物别名索引',
    '',
    '| 主名 | 微信 ID | 别名（分群） |',
    '|------|---------|------------|',
  ];
  for (const { identity, aliases } of rows) {
    const aliasStr = aliases.length > 0
      ? aliases.map(a => `${a.alias} @ ${a.groupName}`).join(' · ')
      : [...identity.globalNames].filter(n => n !== identity.wxid && n !== identity.primaryName).join(' · ') || '—';
    lines.push(`| ${identity.primaryName}${identity.hasRemark ? ' 📌' : ''} | \`${identity.wxid}\` | ${aliasStr} |`);
  }
  return lines.join('\n');
}

/**
 * Compact annotation used next to a person's name in dense lists.
 * Returns "" if no annotation needed, else "（ID: wxid；X 群: A）".
 */
export function compactAnnotation(
  identity: Identity,
  resolver: IdentityResolver,
): string {
  if (!hasMultipleAliases(identity)) return '';
  const aliases = resolver.getGroupAliasEntries(identity.wxid)
    .filter(e => e.alias && e.alias !== identity.primaryName)
    .slice(0, 2);
  const parts = [`ID: ${identity.wxid}`];
  if (aliases.length > 0) {
    parts.push(aliases.map(a => `${a.groupName}: ${a.alias}`).join(' · '));
  }
  return `（${parts.join('；')}）`;
}
