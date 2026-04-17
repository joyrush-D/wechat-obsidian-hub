/**
 * Source trust system inspired by NATO Admiralty Code (STANAG 2511).
 *
 * Each contact accumulates stats over time → derives a trust grade A-F.
 * Each message gets credibility 1-6 based on content characteristics.
 * Combined "B2" code means: usually reliable source + probably true info.
 *
 * Trust persists across briefing runs (saved to plugin data).
 */

import type { Contact, ParsedMessage } from '../types';

/** NATO Admiralty Code source reliability (A=best, F=cannot judge) */
export type SourceReliability = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
/** NATO Admiralty Code information credibility (1=confirmed, 6=cannot judge) */
export type InfoCredibility = 1 | 2 | 3 | 4 | 5 | 6;

export interface SourceStats {
  wxid: string;
  displayName: string;
  totalMessages: number;       // lifetime count
  recentMessages: number;       // last 7 days
  daysObserved: number;         // unique days seen
  hasRemark: boolean;           // user gave them a remark name (signals importance)
  isInDirectMsg: boolean;       // user has 1:1 chat (high trust signal)
  mentionsUser: number;         // times @ed the user
  sharedLinks: number;          // links they've shared
  firstSeen: string;            // ISO date
  lastSeen: string;             // ISO date
}

export interface SourceTrustData {
  version: 1;
  updatedAt: string;
  sources: Record<string, SourceStats>;  // wxid → stats
}

const EMPTY_TRUST: SourceTrustData = {
  version: 1,
  updatedAt: '',
  sources: {},
};

/**
 * Compute source reliability grade based on accumulated stats.
 *
 * Grading philosophy:
 *   A: User has remark + frequent + has DM → "completely reliable"
 *   B: User has remark OR has DM → "usually reliable"
 *   C: Frequent in groups, no remark → "fairly reliable"
 *   D: Occasional contributor → "not usually reliable"
 *   E: Rare/new speaker → "unreliable"
 *   F: Unknown → "cannot judge"
 */
export function gradeSource(stats: SourceStats | undefined, contact?: Contact): SourceReliability {
  if (!stats) {
    if (contact?.remark) return 'B';
    if (contact?.nickName) return 'D';
    return 'F';
  }

  const score =
    (stats.hasRemark ? 30 : 0) +
    (stats.isInDirectMsg ? 25 : 0) +
    (stats.mentionsUser > 0 ? 15 : 0) +
    Math.min(stats.daysObserved * 2, 20) +
    Math.min(stats.totalMessages / 10, 10);

  if (score >= 60) return 'A';
  if (score >= 40) return 'B';
  if (score >= 20) return 'C';
  if (score >= 8) return 'D';
  if (score > 0) return 'E';
  return 'F';
}

/**
 * Estimate information credibility for a single message based on content shape.
 *
 *   1: Direct quote / first-hand observation / verifiable URL
 *   2: Second-hand from credible source
 *   3: Opinion / analysis from frequent contributor
 *   4: Speculation / unverified claim
 *   5: Likely incorrect (controversy markers)
 *   6: Cannot judge
 */
export function gradeMessage(msg: ParsedMessage, sourceGrade: SourceReliability): InfoCredibility {
  const text = msg.text.toLowerCase();

  // Type-based heuristics
  if (msg.type === 'link' || msg.type === 'file') return 1;  // URL/file = verifiable
  if (msg.type === 'quote') return 2;  // referencing another message
  if (msg.type === 'system') return 1;  // system events are factual

  // Content markers
  const speculation = /可能|也许|或许|大概|估计|据说|听说|maybe|perhaps|might|rumor/i;
  const certainty = /确认|确定|已经|刚刚|just|confirmed|breaking/i;
  const opinion = /我觉得|我认为|个人看法|imo|i think/i;
  const question = /\?|？|吗|嘛|怎么|为什么|how|why|what/;

  if (question.test(text)) return 6;  // questions don't claim facts
  if (certainty.test(text) && sourceGrade <= 'B') return 1;
  if (certainty.test(text)) return 2;
  if (speculation.test(text)) return 4;
  if (opinion.test(text)) return 3;

  // Default: 3 if from reliable source, 4 if not
  return (sourceGrade <= 'C') ? 3 : 4;
}

/**
 * Plain-Chinese labels for source reliability (A-F).
 */
const RELIABILITY_LABEL: Record<SourceReliability, string> = {
  A: '核心信源',
  B: '常规信源',
  C: '偶发信源',
  D: '生疏信源',
  E: '陌生人',
  F: '无法判断',
};

/**
 * Plain-Chinese labels for info credibility (1-6).
 */
const CREDIBILITY_LABEL: Record<number, string> = {
  1: '已确认',
  2: '可能为真',
  3: '观点',
  4: '待验证',
  5: '存疑',
  6: '无法判断',
};

/**
 * Format as plain Chinese: "核心信源·观点" instead of "B2".
 */
export function formatAdmiraltyCode(reliability: SourceReliability, credibility: InfoCredibility): string {
  return `${RELIABILITY_LABEL[reliability]}·${CREDIBILITY_LABEL[credibility]}`;
}

/**
 * Technical code for internal use (NATO STANAG 2511).
 */
export function formatAdmiraltyCodeShort(reliability: SourceReliability, credibility: InfoCredibility): string {
  return `${reliability}${credibility}`;
}

/**
 * Update source stats from a batch of messages from today.
 * Modifies trust data in-place.
 */
export function updateTrust(
  trust: SourceTrustData,
  messages: ParsedMessage[],
  contacts: Map<string, Contact>,
  userWxid: string = '',
): SourceTrustData {
  const today = new Date().toISOString().slice(0, 10);

  // Group messages by sender for batch update
  const bySpeaker = new Map<string, ParsedMessage[]>();
  for (const msg of messages) {
    if (!msg.senderWxid) continue;
    if (!bySpeaker.has(msg.senderWxid)) bySpeaker.set(msg.senderWxid, []);
    bySpeaker.get(msg.senderWxid)!.push(msg);
  }

  for (const [wxid, msgs] of bySpeaker) {
    const contact = contacts.get(wxid);
    const existing = trust.sources[wxid];

    const isInDirectMsg = msgs.some(m => m.conversationId === wxid);
    const mentionsUser = userWxid
      ? msgs.filter(m => m.text.includes(`@${userWxid}`)).length
      : 0;
    const sharedLinks = msgs.filter(m => m.type === 'link').length;

    if (existing) {
      // Increment stats
      existing.totalMessages += msgs.length;
      existing.recentMessages = msgs.length;  // reset to today's count
      existing.mentionsUser += mentionsUser;
      existing.sharedLinks += sharedLinks;
      existing.lastSeen = today;
      if (existing.firstSeen !== today && !existing.daysObserved) existing.daysObserved = 1;
      if (existing.lastSeen !== today) existing.daysObserved += 1;
      existing.isInDirectMsg = existing.isInDirectMsg || isInDirectMsg;
      existing.hasRemark = !!contact?.remark;
      existing.displayName = contact?.remark || contact?.nickName || wxid;
    } else {
      trust.sources[wxid] = {
        wxid,
        displayName: contact?.remark || contact?.nickName || wxid,
        totalMessages: msgs.length,
        recentMessages: msgs.length,
        daysObserved: 1,
        hasRemark: !!contact?.remark,
        isInDirectMsg,
        mentionsUser,
        sharedLinks,
        firstSeen: today,
        lastSeen: today,
      };
    }
  }

  trust.updatedAt = new Date().toISOString();
  return trust;
}

/**
 * Initialize empty trust data.
 */
export function initTrust(): SourceTrustData {
  return JSON.parse(JSON.stringify(EMPTY_TRUST));
}

/**
 * Get top-N sources by composite trust score.
 */
export function getTopSources(trust: SourceTrustData, n: number = 10): SourceStats[] {
  return Object.values(trust.sources)
    .sort((a, b) => {
      const scoreA = (a.hasRemark ? 30 : 0) + (a.isInDirectMsg ? 25 : 0) + a.mentionsUser * 5 + a.daysObserved * 2;
      const scoreB = (b.hasRemark ? 30 : 0) + (b.isInDirectMsg ? 25 : 0) + b.mentionsUser * 5 + b.daysObserved * 2;
      return scoreB - scoreA;
    })
    .slice(0, n);
}
