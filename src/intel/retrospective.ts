/**
 * Retrospective intel analysis — reads historical extractions and runs
 * cross-time analyses. All three commands share the ExtractionStore:
 *
 * - Weekly Rollup:    last 7 days → trends, persistent topics, active people
 * - Topic Brief:      keyword filter across history → target-centric report
 * - ACH Analysis:     competing hypotheses + evidence matrix on a controversy
 */

import { LlmClient } from '../ai/llm-client';
import {
  buildWeeklyRollupPrompt,
  buildTopicBriefPrompt,
  buildACHPrompt,
} from '../ai/prompt-templates';
import { ExtractionStore, type DailyExtractions } from './extraction-store';
import type { IdentityResolver } from './identity-resolver';

/** Format a date N days ago as YYYY-MM-DD. */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Format current datetime as "YYYY-MM-DD HH:MM". */
function nowStamp(): string {
  const d = new Date();
  const dateStr = d.toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-');
  return dateStr;
}

/**
 * Compress daily extractions to a succinct string representation.
 * Each day is one bloc with conversation list + extractions.
 */
function formatDailies(dailies: DailyExtractions[]): string {
  return dailies
    .map(d => {
      const body = d.entries
        .map(e => `### ${e.conversationName} (${e.msgCount}条)\n${e.extracted}`)
        .join('\n\n');
      return `## ${d.date} (${d.entries.length} 个对话)\n\n${body}`;
    })
    .join('\n\n---\n\n');
}

/**
 * Filter extractions by keyword. If keyword matches a person via resolver,
 * expand search to ALL of that person's aliases (subject-centric matching).
 */
function filterByKeyword(
  dailies: DailyExtractions[],
  keyword: string,
  resolver?: IdentityResolver,
): { filtered: DailyExtractions[]; searchTerms: string[] } {
  // Build search terms: keyword itself + all aliases if it resolves to a person
  const searchTerms = new Set<string>([keyword]);
  if (resolver) {
    const identity = resolver.findByName(keyword);
    if (identity) {
      for (const name of identity.allNames) {
        if (name && name.length >= 2) searchTerms.add(name);
      }
    }
  }

  const terms = [...searchTerms].map(t => t.toLowerCase());
  const filtered = dailies
    .map(d => ({
      date: d.date,
      entries: d.entries.filter(e => {
        const txt = (e.extracted + ' ' + e.conversationName).toLowerCase();
        return terms.some(t => txt.includes(t));
      }),
    }))
    .filter(d => d.entries.length > 0);

  return { filtered, searchTerms: [...searchTerms] };
}

/**
 * Helper: format search context for the report header so the user sees
 * whether a "subject expansion" happened.
 */
function formatSearchContext(searchTerms: string[], originalKeyword: string): string {
  if (searchTerms.length <= 1) return `"${originalKeyword}"`;
  const others = searchTerms.filter(t => t !== originalKeyword);
  return `"${originalKeyword}"（同一主体的别名也一起搜索：${others.slice(0, 6).join(' / ')}${others.length > 6 ? `...共 ${others.length} 个` : ''}）`;
}

// ============================================================================
// Weekly Rollup
// ============================================================================
export async function generateWeeklyRollup(
  store: ExtractionStore,
  llmClient: LlmClient,
  days: number = 7,
  resolver?: IdentityResolver,
): Promise<string> {
  const from = daysAgo(days - 1);
  const to = today();
  const dailies = store.loadRange(from, to);

  if (dailies.length === 0) {
    return `# 微信周报 ${from} — ${to}\n\n> 累积层为空。需要先跑日报生成每日抽取数据，然后周报才能分析。\n\n**提示**: 累积层随每天的日报自动填充。请先跑几天日报后再生成周报。`;
  }

  const totalConvos = dailies.reduce((s, d) => s + d.entries.length, 0);
  const weeklyData = formatDailies(dailies);

  const MAX_INPUT = 60000;
  const trimmed = weeklyData.length > MAX_INPUT
    ? weeklyData.slice(0, MAX_INPUT) + '\n\n...(数据较大，已截断)'
    : weeklyData;

  const dateRange = `${from} → ${to} (${dailies.length} 天, ${totalConvos} 个对话抽取)`;

  // If resolver is provided, hint the LLM that same-person-different-names should be merged
  const resolverHint = resolver
    ? `\n\n【重要】数据中同一个人可能用不同昵称出现（群内别名系统）。分析"活跃人物"时按同一主体聚合，不要把一个人拆成多人。`
    : '';

  try {
    const body = await llmClient.complete(buildWeeklyRollupPrompt(dateRange + resolverHint, trimmed));
    return `> 🕐 **报告生成时间**: ${nowStamp()}\n> 📅 **数据范围**: ${dateRange}\n\n${body}`;
  } catch (e) {
    return `# 微信周报 ${dateRange}\n\n> 🕐 生成时间: ${nowStamp()}\n> 合成失败: ${(e as Error).message}\n\n## 原始数据汇总\n\n${trimmed.slice(0, 3000)}...`;
  }
}

// ============================================================================
// Topic Brief (Target-Centric)
// ============================================================================
export async function generateTopicBrief(
  store: ExtractionStore,
  llmClient: LlmClient,
  topic: string,
  days: number = 30,
  resolver?: IdentityResolver,
): Promise<string> {
  const from = daysAgo(days - 1);
  const to = today();
  const allDailies = store.loadRange(from, to);

  if (allDailies.length === 0) {
    return `# 专题简报: ${topic}\n\n> 累积层为空。请先跑几天日报后再生成专题简报。`;
  }

  const { filtered, searchTerms } = filterByKeyword(allDailies, topic, resolver);

  if (filtered.length === 0) {
    const note = searchTerms.length > 1
      ? `\n> （已尝试搜索 ${searchTerms.length} 个关联别名：${searchTerms.slice(1, 6).join(' / ')}）`
      : '';
    return `# 专题简报: ${topic}\n\n> 过去 ${days} 天的 ${allDailies.length} 天数据中未发现与"${topic}"相关的内容。${note}\n> 建议：换一个关键词，或延长时间范围。`;
  }

  const totalConvos = filtered.reduce((s, d) => s + d.entries.length, 0);
  const filteredData = formatDailies(filtered);

  const MAX_INPUT = 60000;
  const trimmed = filteredData.length > MAX_INPUT
    ? filteredData.slice(0, MAX_INPUT) + '\n\n...(已截断)'
    : filteredData;

  const dateRange = `${from} → ${to}`;
  const searchContext = formatSearchContext(searchTerms, topic);

  try {
    const body = await llmClient.complete(buildTopicBriefPrompt(topic, dateRange, trimmed));
    return `> 🕐 **报告生成时间**: ${nowStamp()}\n> 📅 **分析范围**: ${dateRange}\n> 🎯 **主题**: ${searchContext}\n> 📊 **命中**: ${filtered.length} 天 / ${totalConvos} 个对话\n\n${body}`;
  } catch (e) {
    return `# 专题简报: ${topic}\n\n> 🕐 生成时间: ${nowStamp()}\n> 合成失败: ${(e as Error).message}\n\n命中 ${filtered.length} 天 / ${totalConvos} 个对话\n\n原始过滤数据：\n\n${trimmed.slice(0, 3000)}...`;
  }
}

// ============================================================================
// ACH (Analysis of Competing Hypotheses)
// ============================================================================
export async function runACHAnalysis(
  store: ExtractionStore,
  llmClient: LlmClient,
  topic: string,
  days: number = 14,
  resolver?: IdentityResolver,
): Promise<string> {
  const from = daysAgo(days - 1);
  const to = today();
  const allDailies = store.loadRange(from, to);

  if (allDailies.length === 0) {
    return `# ACH 分析: ${topic}\n\n> 累积层为空，无法进行竞争性假设分析。`;
  }

  const { filtered, searchTerms } = filterByKeyword(allDailies, topic, resolver);

  if (filtered.length === 0) {
    const note = searchTerms.length > 1
      ? `（已搜 ${searchTerms.length} 个关联别名）`
      : '';
    return `# ACH 分析: ${topic}\n\n> 过去 ${days} 天未找到"${topic}"相关讨论 ${note}。\n> ACH 需要至少有争议性的数据点才能有效。`;
  }

  const totalConvos = filtered.reduce((s, d) => s + d.entries.length, 0);
  const filteredData = formatDailies(filtered);

  const MAX_INPUT = 40000;
  const trimmed = filteredData.length > MAX_INPUT
    ? filteredData.slice(0, MAX_INPUT) + '\n\n...(已截断)'
    : filteredData;

  const searchContext = formatSearchContext(searchTerms, topic);

  try {
    const body = await llmClient.complete(buildACHPrompt(topic, trimmed));
    return `> 🕐 **报告生成时间**: ${nowStamp()}\n> 📅 **分析范围**: ${from} → ${to}\n> 🧮 **ACH 主题**: ${searchContext}\n> 📊 **数据**: ${filtered.length} 天 / ${totalConvos} 个对话\n\n${body}`;
  } catch (e) {
    return `# ACH 分析: ${topic}\n\n> 🕐 生成时间: ${nowStamp()}\n> 合成失败: ${(e as Error).message}\n\n命中 ${filtered.length} 天 / ${totalConvos} 个对话`;
  }
}

export { daysAgo, today };
