import { describe, it, expect } from 'vitest';
import { extractTopics, topicSlug, injectTopicWikilinks } from '../../src/obsidian/topic-extractor';

const SAMPLE_BRIEFING = `# 微信日报 2026-04-18

## 🎯 30 秒速读
1. 行程变更
2. 加纳光伏

## 📰 今日要闻（按具体主题）

### 行程变更与差旅审批
**涉及**: 内部调休 / 邓惠锋 (7 条)
**核心**: 杭州行程变更为宁波，需重新审批 [几乎肯定]
💬 引用: "改宁波了" [msg:wechat:fengqi:84] — Dexter
💬 引用: "重新提交电子流" [msg:wechat:abc:123] — Dexter
🧠 分析: 影响下周交付节奏

### 加纳光伏农业项目推进
**涉及**: 我的王朝 / Shu 张姝
**核心**: 千年发展局 MOU 真实性待核实 [可能]
💬 引用: "千年发展局不会变" [msg:wechat:b:1] — Dexter

### OpenAI 视频业务关停
**涉及**: 理性吹水群 (38 条)
**核心**: Sora 关停，转向企业级 AI [几乎肯定]
💬 引用: "OpenAI 已分阶段关停 Sora" [msg:wechat:c:9042] — 李先森

## 🌐 今日信息接触面（Information Touchpoints）

### 📊 行业 / 市场情报
- xxx

### 🌍 宏观 / 时事
- yyy

## 🧠 关键判断
1. 判断1
`;

describe('extractTopics', () => {
  it('returns each H3 under 今日要闻 as a topic', () => {
    const topics = extractTopics(SAMPLE_BRIEFING);
    expect(topics).toHaveLength(3);
    expect(topics[0].title).toBe('行程变更与差旅审批');
    expect(topics[1].title).toBe('加纳光伏农业项目推进');
    expect(topics[2].title).toBe('OpenAI 视频业务关停');
  });

  it('skips emoji-prefixed subcategory headers', () => {
    const topics = extractTopics(SAMPLE_BRIEFING);
    const titles = topics.map(t => t.title);
    expect(titles).not.toContain('📊 行业 / 市场情报');
    expect(titles).not.toContain('🌍 宏观 / 时事');
  });

  it('parses involvedConversations from **涉及** line', () => {
    const topics = extractTopics(SAMPLE_BRIEFING);
    expect(topics[0].involvedConversations).toContain('内部调休');
    expect(topics[0].involvedConversations).toContain('邓惠锋');   // (7 条) suffix stripped
  });

  it('parses coreSummary from **核心** line', () => {
    const topics = extractTopics(SAMPLE_BRIEFING);
    expect(topics[0].coreSummary).toContain('杭州行程变更为宁波');
    expect(topics[0].coreSummary).toContain('几乎肯定');
  });

  it('extracts cited [msg:wechat:...] ids', () => {
    const topics = extractTopics(SAMPLE_BRIEFING);
    expect(topics[0].citedMessageIds).toEqual(
      expect.arrayContaining(['msg:wechat:fengqi:84', 'msg:wechat:abc:123']),
    );
    expect(topics[0].citedMessageIds.length).toBe(2);   // deduped
  });

  it('returns empty array when 今日要闻 section absent', () => {
    expect(extractTopics('# 简报\n\n## 其他\n内容')).toEqual([]);
  });

  it('handles trailing whitespace and Chinese full-width colons', () => {
    const md = `## 📰 今日要闻\n\n### 测试\n**涉及**：A / B\n**核心**：C [可能]\n`;
    const topics = extractTopics(md);
    expect(topics).toHaveLength(1);
    expect(topics[0].involvedConversations).toContain('A');
    expect(topics[0].involvedConversations).toContain('B');
    expect(topics[0].coreSummary).toContain('C');
  });
});

describe('topicSlug', () => {
  it('strips filesystem-unsafe characters', () => {
    // Input has 11 chars (3 alpha + 8 unsafe); each unsafe becomes _
    expect(topicSlug('a/b:c*?"<>|')).toBe('a_b_c______');
  });

  it('caps long titles at 80 chars', () => {
    expect(topicSlug('x'.repeat(200)).length).toBe(80);
  });

  it('preserves Chinese characters and spaces', () => {
    expect(topicSlug('行程变更与差旅审批')).toBe('行程变更与差旅审批');
  });

  it('handles markdown special characters by stripping #', () => {
    expect(topicSlug('Topic # with hash')).toBe('Topic _ with hash');
  });
});

describe('injectTopicWikilinks', () => {
  it('appends [[WeChat-Topics/<slug>|话题档案]] after each topic block', () => {
    const topics = extractTopics(SAMPLE_BRIEFING);
    const { enriched, linked } = injectTopicWikilinks(SAMPLE_BRIEFING, topics, 'WeChat-Topics');
    expect(linked.size).toBe(3);
    expect(enriched).toContain('→ [[WeChat-Topics/行程变更与差旅审批|话题档案]]');
    expect(enriched).toContain('→ [[WeChat-Topics/加纳光伏农业项目推进|话题档案]]');
    expect(enriched).toContain('→ [[WeChat-Topics/OpenAI 视频业务关停|话题档案]]');
  });

  it('is idempotent — re-running does not duplicate the wikilink', () => {
    const topics = extractTopics(SAMPLE_BRIEFING);
    const once = injectTopicWikilinks(SAMPLE_BRIEFING, topics, 'WeChat-Topics').enriched;
    const twice = injectTopicWikilinks(once, topics, 'WeChat-Topics').enriched;
    const matches1 = (twice.match(/→ \[\[WeChat-Topics\/行程变更/g) || []).length;
    expect(matches1).toBe(1);
  });

  it('places wikilink before the next H3 boundary', () => {
    const topics = extractTopics(SAMPLE_BRIEFING);
    const { enriched } = injectTopicWikilinks(SAMPLE_BRIEFING, topics, 'WeChat-Topics');
    // First topic's wikilink must appear before the second topic's H3
    const firstLink = enriched.indexOf('→ [[WeChat-Topics/行程变更与差旅审批');
    const secondHeader = enriched.indexOf('### 加纳光伏');
    expect(firstLink).toBeLessThan(secondHeader);
    expect(firstLink).toBeGreaterThan(0);
  });

  it('does not modify briefing when no topics found', () => {
    const md = '# 简报\n\n没有要闻段。';
    const { enriched, linked } = injectTopicWikilinks(md, [], 'WeChat-Topics');
    expect(enriched).toBe(md);
    expect(linked.size).toBe(0);
  });
});
