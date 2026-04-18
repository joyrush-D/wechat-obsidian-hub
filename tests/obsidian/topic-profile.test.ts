import { describe, it, expect } from 'vitest';
import {
  renderTopicProfile,
  updateTopicProfile,
  extractExistingBriefingSlugsFromTopic,
  type TopicProfileInput,
} from '../../src/obsidian/topic-profile';
import type { ExtractedTopic } from '../../src/obsidian/topic-extractor';

const TOPIC: ExtractedTopic = {
  title: '加纳光伏农业项目推进',
  body: '...',
  involvedConversations: ['Shu 张姝', '我的王朝'],
  coreSummary: '千年发展局 MOU 真实性待核实 [可能]',
  citedMessageIds: ['msg:wechat:54083445447@chatroom:20', 'msg:wechat:b:106'],
};

const INPUT: TopicProfileInput = {
  topic: TOPIC,
  briefingSlugs: ['2026-04-18-1341', '2026-04-17-2330'],
  briefingFolder: 'WeChat-Briefings',
  firstSeen: '2026-04-15T00:00:00Z',
  lastSeen: '2026-04-18T13:41:00Z',
};

describe('renderTopicProfile', () => {
  it('produces frontmatter with searchable fields', () => {
    const md = renderTopicProfile(INPUT);
    expect(md).toMatch(/^---\n/);
    expect(md).toContain('type: wechat-topic');
    expect(md).toContain('title: 加纳光伏农业项目推进');
    expect(md).toContain('briefing_count: 2');
    expect(md).toContain('first_seen: 2026-04-15T00:00:00Z');
    expect(md).toContain('last_seen: 2026-04-18T13:41:00Z');
    expect(md).toContain('cited_messages: 2');
  });

  it('uses topic title as H1', () => {
    const md = renderTopicProfile(INPUT);
    expect(md).toContain('# 加纳光伏农业项目推进');
  });

  it('emits briefing wikilinks for each slug', () => {
    const md = renderTopicProfile(INPUT);
    expect(md).toContain('[[WeChat-Briefings/2026-04-18-1341]]');
    expect(md).toContain('[[WeChat-Briefings/2026-04-17-2330]]');
  });

  it('shows core summary, first/last seen, and conversations', () => {
    const md = renderTopicProfile(INPUT);
    expect(md).toContain('千年发展局 MOU');
    expect(md).toContain('首次出现**: 2026-04-15');
    expect(md).toContain('最近出现**: 2026-04-18');
    expect(md).toContain('Shu 张姝');
    expect(md).toContain('我的王朝');
  });

  it('lists cited message ids in monospace', () => {
    const md = renderTopicProfile(INPUT);
    expect(md).toContain('`msg:wechat:54083445447@chatroom:20`');
    expect(md).toContain('`msg:wechat:b:106`');
  });

  it('includes auto-region markers + user notes section', () => {
    const md = renderTopicProfile(INPUT);
    expect(md).toContain('<!-- OWH:topic-auto-begin -->');
    expect(md).toContain('<!-- OWH:topic-auto-end -->');
    expect(md).toContain('我的笔记');
  });

  it('handles empty briefing list gracefully', () => {
    const md = renderTopicProfile({ ...INPUT, briefingSlugs: [] });
    expect(md).toContain('总简报数**: 0');
    expect(md).not.toContain('## 📅 出现的简报');
  });

  it('handles empty cited message ids gracefully', () => {
    const md = renderTopicProfile({
      ...INPUT,
      topic: { ...TOPIC, citedMessageIds: [] },
    });
    expect(md).not.toContain('## 🔗 引用的原始消息');
  });
});

describe('updateTopicProfile', () => {
  it('preserves user notes after end marker', () => {
    const initial = renderTopicProfile(INPUT) + '\n\n这是我对这个话题的私人观察。\n';
    const updated = updateTopicProfile(initial, {
      ...INPUT,
      briefingSlugs: ['2026-04-19-0900', ...INPUT.briefingSlugs],
    });
    expect(updated).toContain('[[WeChat-Briefings/2026-04-19-0900]]');
    expect(updated).toContain('这是我对这个话题的私人观察');
  });

  it('replaces entire content when markers absent', () => {
    const updated = updateTopicProfile('old freeform notes', INPUT);
    expect(updated).toContain('# 加纳光伏农业项目推进');
    expect(updated).not.toContain('old freeform notes');
  });
});

describe('extractExistingBriefingSlugsFromTopic', () => {
  it('returns dated slugs from auto region', () => {
    const md = renderTopicProfile(INPUT);
    const slugs = extractExistingBriefingSlugsFromTopic(md);
    expect(slugs).toContain('2026-04-18-1341');
    expect(slugs).toContain('2026-04-17-2330');
  });

  it('deduplicates', () => {
    const md = '<!-- OWH:topic-auto-begin -->\n[[WeChat-Briefings/2026-04-17-2330]]\n[[WeChat-Briefings/2026-04-17-2330]]\n<!-- OWH:topic-auto-end -->';
    expect(extractExistingBriefingSlugsFromTopic(md)).toEqual(['2026-04-17-2330']);
  });
});
