/**
 * TopicExtractor — pulls topic titles + their bodies out of a briefing
 * markdown document so we can:
 *   1. Generate a `WeChat-Topics/<title>.md` profile page per topic
 *   2. Inject `[[WeChat-Topics/<title>]]` wikilinks back into the briefing
 *
 * "Topics" are the H3 headers (`### <title>`) that live under the H2
 * `## 📰 今日要闻` section. Other H3 headers (e.g., information touchpoint
 * subcategories like `### 📊 行业 / 市场情报`) are excluded by an opt-out
 * list of emoji-prefixed labels.
 */

export interface ExtractedTopic {
  /** H3 title (cleaned of leading/trailing whitespace + emoji prefixes). */
  title: string;
  /** Raw body markdown between this H3 and the next H2/H3 (excluding the header). */
  body: string;
  /** Lines like "**涉及**: A / B / C" parsed into a string array. */
  involvedConversations: string[];
  /** Lines like '**核心**: <one-liner> [置信度]' parsed. */
  coreSummary: string;
  /** All `[msg:wechat:...]` ids cited in the body. */
  citedMessageIds: string[];
}

const TOPIC_SECTION_REGEX = /##\s*📰\s*今日要闻[^\n]*\n([\s\S]*?)(?=\n##\s|$)/;
// Skip H3s that are clearly subcategory labels rather than topics
const SUBCATEGORY_BLOCKLIST = [
  /^\s*[📊🌍💡📚🎭]\s/,           // info-touchpoint subgroups
  /^\s*📋\s/,                      // mechanical lists
  /^\s*🔬\s/,                      // deep analysis
];

export function extractTopics(briefingMarkdown: string): ExtractedTopic[] {
  const sectionMatch = TOPIC_SECTION_REGEX.exec(briefingMarkdown);
  if (!sectionMatch) return [];
  const sectionBody = sectionMatch[1];

  // Split on H3 headers — keep them with the following body
  const parts = sectionBody.split(/^###\s+/m);
  const topics: ExtractedTopic[] = [];

  for (let i = 1; i < parts.length; i++) {   // i=0 is content before first H3
    const block = parts[i];
    const newlineIdx = block.indexOf('\n');
    const rawTitle = newlineIdx === -1 ? block : block.slice(0, newlineIdx);
    const body = newlineIdx === -1 ? '' : block.slice(newlineIdx + 1);
    const title = rawTitle.trim();
    if (!title) continue;
    if (SUBCATEGORY_BLOCKLIST.some(re => re.test(title))) continue;

    topics.push({
      title,
      body: body.trim(),
      involvedConversations: parseInvolvedLine(body),
      coreSummary: parseCoreLine(body),
      citedMessageIds: parseCitedMessageIds(body),
    });
  }
  return topics;
}

function parseInvolvedLine(body: string): string[] {
  const m = /\*\*涉及\*\*[:：]\s*([^\n]+)/.exec(body);
  if (!m) return [];
  return m[1]
    .split(/[\/／·]/)
    .map(s => s.trim().replace(/\(\d+\s*条\)$/, '').trim())
    .filter(s => s.length > 0)
    .slice(0, 12);
}

function parseCoreLine(body: string): string {
  const m = /\*\*核心\*\*[:：]\s*([^\n]+)/.exec(body);
  return m ? m[1].trim() : '';
}

function parseCitedMessageIds(body: string): string[] {
  const ids = new Set<string>();
  const re = /\[(msg:wechat:[^\]]+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) ids.add(m[1]);
  return [...ids];
}

/**
 * Build a safe filename from a topic title. Strips path separators and
 * caps length so we don't blow filesystem limits.
 */
export function topicSlug(title: string): string {
  return title.replace(/[\\/:*?"<>|#]/g, '_').slice(0, 80).trim();
}

/**
 * Add a "→ [[WeChat-Topics/<title>]]" reference at the end of each topic
 * block in the briefing markdown. Returns enriched markdown + the set of
 * topic titles actually linked.
 *
 * Idempotent: if the wikilink already exists, leaves it alone.
 */
export function injectTopicWikilinks(
  briefingMarkdown: string,
  topics: ExtractedTopic[],
  folder: string,
): { enriched: string; linked: Set<string> } {
  const linked = new Set<string>();
  let out = briefingMarkdown;
  for (const t of topics) {
    const slug = topicSlug(t.title);
    if (!slug) continue;
    const wikilink = `\n\n→ [[${folder}/${slug}|话题档案]]`;
    if (out.includes(`[[${folder}/${slug}|`) || out.includes(`[[${folder}/${slug}]]`)) {
      linked.add(t.title);
      continue;
    }
    // Find the H3 line and append the wikilink at the next blank-line boundary
    // (i.e., end of this topic block).
    const escapedTitle = t.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const headerRegex = new RegExp(`(###\\s+${escapedTitle}\\s*\\n[\\s\\S]*?)(?=\\n###\\s|\\n##\\s|$)`);
    const replaced = out.replace(headerRegex, (block) => {
      linked.add(t.title);
      return block.replace(/\s*$/, '') + wikilink;
    });
    if (replaced !== out) out = replaced;
  }
  return { enriched: out, linked };
}
