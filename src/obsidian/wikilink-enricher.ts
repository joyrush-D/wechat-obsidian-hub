/**
 * WikilinkEnricher — post-process a briefing markdown so person/topic mentions
 * become Obsidian [[wikilinks]]. This is what unlocks the graph view, backlinks,
 * and quick-jump UX that Obsidian users expect from a PKM platform.
 *
 * Conservative replacement rules:
 *   - Only replace inside prose; never inside code blocks (``` … ```), inline
 *     code (`…`), or existing wikilinks ([[…]])
 *   - Match longest names first so "罗俊产品经理" wins over "罗俊"
 *   - Whole-token match (no partial substring inside another word)
 *   - Limit to known Identities with a remark (analyst-relevant) OR top-N
 *     by activity, to avoid wikilinking every random group member
 */

export interface PersonMention {
  /** Canonical display name used as the wikilink target. */
  name: string;
  /** Substrings that should match as the same person. Sorted long → short. */
  aliases: string[];
  /** Folder under vault root where person notes live. */
  folder: string;
}

/**
 * Replace person mentions in `markdown` with [[<folder>/<name>|<alias>]]
 * Obsidian wikilinks. Returns the rewritten markdown plus a list of
 * names actually wikilinked (for downstream profile-page generation).
 */
export function enrichWithPersonWikilinks(
  markdown: string,
  mentions: PersonMention[],
): { enriched: string; linkedNames: Set<string> } {
  // Sort all (name, alias, folder) tuples by alias length descending so we
  // replace longer matches first.
  const replaceTuples = mentions.flatMap(m =>
    m.aliases.map(alias => ({ alias, name: m.name, folder: m.folder })),
  ).sort((a, b) => b.alias.length - a.alias.length);

  const linkedNames = new Set<string>();
  const enriched = transformProseRegions(markdown, (region) => {
    let out = region;
    for (const { alias, name, folder } of replaceTuples) {
      if (alias.length < 2) continue;   // skip 1-char names (too noisy)
      if (!out.includes(alias)) continue;

      // Build a regex that matches alias on word boundaries (or CJK boundaries)
      const escaped = alias.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
      const re = new RegExp(escaped, 'g');
      out = out.replace(re, (match, offset, str) => {
        // Skip if already inside a wikilink: look back for an unmatched `[[`
        const before = str.slice(0, offset);
        const lastOpen = before.lastIndexOf('[[');
        const lastClose = before.lastIndexOf(']]');
        if (lastOpen > lastClose) return match;
        // Skip if the match continues an English word (avoid partial matches)
        const after = str[offset + match.length] || '';
        if (/[a-zA-Z0-9_]/.test(after) && /[a-zA-Z0-9_]/.test(match.slice(-1))) return match;
        const beforeChar = str[offset - 1] || '';
        if (/[a-zA-Z0-9_]/.test(beforeChar) && /[a-zA-Z0-9_]/.test(match[0])) return match;
        linkedNames.add(name);
        return `[[${folder}/${name}|${match}]]`;
      });
    }
    return out;
  });

  return { enriched, linkedNames };
}

/**
 * Walk the markdown applying `transform` only to "prose" regions —
 * skipping fenced code blocks, inline code, frontmatter, and existing wikilinks.
 */
export function transformProseRegions(
  markdown: string,
  transform: (region: string) => string,
): string {
  // Detect frontmatter first (--- … --- at top of file)
  let body = markdown;
  let frontmatter = '';
  if (markdown.startsWith('---\n')) {
    const close = markdown.indexOf('\n---\n', 4);
    if (close !== -1) {
      frontmatter = markdown.slice(0, close + 5);
      body = markdown.slice(close + 5);
    }
  }

  // Split body by fenced code blocks
  const fencedParts = body.split(/(```[\s\S]*?```)/);
  const transformed = fencedParts.map(part => {
    if (part.startsWith('```')) return part;   // leave fenced as-is
    // For each non-fenced part, also protect inline-code spans
    return part.split(/(`[^`\n]+`)/).map(seg => {
      if (seg.startsWith('`') && seg.endsWith('`')) return seg;
      return transform(seg);
    }).join('');
  }).join('');

  return frontmatter + transformed;
}
