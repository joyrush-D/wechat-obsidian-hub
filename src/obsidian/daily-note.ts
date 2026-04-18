/**
 * Daily-Notes integration helpers (pure functions — no Obsidian API).
 *
 * Designed to plug into Obsidian's Daily Notes convention:
 *   <dailyNotesFolder>/YYYY-MM-DD.md
 * with a configurable date format. We embed today's briefing into the
 * daily note via a transclusion link so the note stays light and the
 * briefing source remains the single source of truth.
 *
 * Insertion uses sentinel comment markers so re-running the command
 * REPLACES the previous block instead of duplicating content. User
 * notes outside the markers are preserved.
 */

const SECTION_BEGIN = '<!-- OWH-briefing-begin -->';
const SECTION_END = '<!-- OWH-briefing-end -->';

/** Format a date with a date pattern. Subset of moment-style: YYYY MM DD */
export function formatDate(date: Date, pattern: string): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return pattern
    .replace(/YYYY/g, String(date.getFullYear()))
    .replace(/MM/g, pad(date.getMonth() + 1))
    .replace(/DD/g, pad(date.getDate()));
}

/** Build the full vault-relative path to today's daily note. */
export function dailyNotePath(date: Date, folder: string, pattern: string): string {
  const filename = formatDate(date, pattern) + '.md';
  if (!folder || folder === '/') return filename;
  return `${folder.replace(/\/$/, '')}/${filename}`;
}

/**
 * From a list of vault-relative briefing filenames, pick the most recent
 * one whose name starts with the given date prefix (e.g., "2026-04-18").
 * Returns null when none match.
 */
export function pickLatestBriefingForDate(
  briefingFiles: string[],
  datePrefix: string,
  briefingFolder: string,
): string | null {
  const prefix = datePrefix.replace(/\.md$/i, '');
  const matches = briefingFiles
    .filter(f => {
      const base = f.split('/').pop() || f;
      return base.startsWith(prefix);
    })
    .sort();   // lexicographic = chronological for YYYY-MM-DD-HHMM
  if (matches.length === 0) return null;
  const last = matches[matches.length - 1];
  // Strip any folder prefix if user passed full paths; we want just the slug
  const base = last.split('/').pop()!.replace(/\.md$/i, '');
  return `${briefingFolder}/${base}`;
}

/**
 * Build the briefing section to embed in the daily note. Uses Obsidian
 * transclusion syntax so the daily note stays light and updates if the
 * briefing is regenerated.
 */
export function buildBriefingSection(briefingPath: string, generatedAt: Date): string {
  return [
    SECTION_BEGIN,
    '',
    `## 📰 今日微信简报`,
    '',
    `> _自动嵌入 · ${formatDate(generatedAt, 'YYYY-MM-DD')} ${pad2(generatedAt.getHours())}:${pad2(generatedAt.getMinutes())}_`,
    '',
    `![[${briefingPath}]]`,
    '',
    SECTION_END,
  ].join('\n');
}

function pad2(n: number) { return String(n).padStart(2, '0'); }

/**
 * Insert (or replace) the OWH briefing section in a daily note's content.
 * If the markers already exist, replace just the block between them.
 * If not, append the section at the end with a divider above.
 */
export function insertOrReplaceBriefingSection(
  dailyContent: string,
  newSection: string,
): string {
  const beginIdx = dailyContent.indexOf(SECTION_BEGIN);
  const endIdx = dailyContent.indexOf(SECTION_END);

  if (beginIdx >= 0 && endIdx > beginIdx) {
    return dailyContent.slice(0, beginIdx)
      + newSection
      + dailyContent.slice(endIdx + SECTION_END.length);
  }

  // First insertion — append at end with divider
  const trimmed = dailyContent.replace(/\s+$/, '');
  return trimmed + (trimmed.length > 0 ? '\n\n---\n\n' : '') + newSection + '\n';
}
