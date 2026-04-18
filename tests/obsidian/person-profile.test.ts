import { describe, it, expect } from 'vitest';
import {
  renderPersonProfile,
  updatePersonProfile,
  extractExistingBriefingSlugs,
  type PersonProfileInput,
} from '../../src/obsidian/person-profile';
import type { Identity } from '../../src/intel/identity-resolver';

function makeIdentity(overrides: Partial<Identity> = {}): Identity {
  return {
    wxid: 'wxid_test',
    primaryName: '罗俊',
    globalNames: new Set(['wxid_test', '罗俊', 'Dexter']),
    groupAliases: new Map([['g1@chatroom', 'Dexter'], ['g2@chatroom', '罗总']]),
    allNames: new Set(['wxid_test', '罗俊', 'Dexter', '罗总']),
    isGroup: false,
    hasRemark: true,
    ...overrides,
  };
}

const BASE_INPUT: PersonProfileInput = {
  identity: makeIdentity(),
  groupNames: ['内部联调群', '产品评审群'],
  recentBriefingSlugs: ['2026-04-18-1341', '2026-04-17-2330'],
  recentQuotes: [
    { time: '13:45', text: '改宁波了', conversation: '内部调休' },
    { time: '11:20', text: '所有客户评审意见已修复', conversation: '内部联调群' },
  ],
  briefingFolder: 'WeChat-Briefings',
};

describe('renderPersonProfile', () => {
  it('produces frontmatter with searchable fields', () => {
    const md = renderPersonProfile(BASE_INPUT);
    expect(md).toMatch(/^---\n/);
    expect(md).toContain('type: wechat-person');
    expect(md).toContain('wxid: wxid_test');
    expect(md).toContain('primary_name: 罗俊');
    expect(md).toContain('aliases:');
    expect(md).toContain('  - 罗俊');
    expect(md).toContain('  - Dexter');
    expect(md).toContain('group_count: 2');
    expect(md).toContain('has_remark: true');
    // ISO timestamps may be unquoted now since we stopped force-quoting things
    expect(md).toMatch(/last_updated: "?2\d{3}-/);
  });

  it('uses primary name in heading with 📌 if remarked', () => {
    const md = renderPersonProfile(BASE_INPUT);
    expect(md).toContain('# 罗俊 📌');
  });

  it('omits 📌 when not remarked', () => {
    const md = renderPersonProfile({ ...BASE_INPUT, identity: makeIdentity({ hasRemark: false }) });
    expect(md).toContain('# 罗俊\n');
    expect(md).not.toContain('# 罗俊 📌');
  });

  it('lists groups and other aliases', () => {
    const md = renderPersonProfile(BASE_INPUT);
    expect(md).toContain('内部联调群');
    expect(md).toContain('产品评审群');
    expect(md).toContain('Dexter');
    expect(md).toContain('罗总');
  });

  it('emits briefing wikilinks in 近期出现的简报 section', () => {
    const md = renderPersonProfile(BASE_INPUT);
    expect(md).toContain('[[WeChat-Briefings/2026-04-18-1341]]');
    expect(md).toContain('[[WeChat-Briefings/2026-04-17-2330]]');
  });

  it('emits recent quotes when provided', () => {
    const md = renderPersonProfile(BASE_INPUT);
    expect(md).toContain('改宁波了');
    expect(md).toContain('所有客户评审意见已修复');
  });

  it('includes auto-region markers and a user-notes section', () => {
    const md = renderPersonProfile(BASE_INPUT);
    expect(md).toContain('<!-- OWH:auto-begin -->');
    expect(md).toContain('<!-- OWH:auto-end -->');
    expect(md).toContain('我的笔记');
  });

  it('truncates very long alias list with "等共 N 个"', () => {
    const id = makeIdentity({
      allNames: new Set(['wxid_test', '罗俊', ...Array.from({ length: 25 }, (_, i) => `alias-${i}`)]),
    });
    const md = renderPersonProfile({ ...BASE_INPUT, identity: id });
    expect(md).toMatch(/等共 \d+ 个/);
  });

  it('handles empty groups gracefully', () => {
    const md = renderPersonProfile({ ...BASE_INPUT, groupNames: [] });
    expect(md).toContain('所在群 (0)');
    expect(md).toContain('(无)');
  });

  it('handles empty briefings list (first sighting)', () => {
    const md = renderPersonProfile({ ...BASE_INPUT, recentBriefingSlugs: [] });
    expect(md).not.toContain('近期出现的简报');
  });
});

describe('updatePersonProfile', () => {
  it('replaces auto-region but preserves user notes after end marker', () => {
    const existing = renderPersonProfile(BASE_INPUT) + '\n\n这里是我手写的笔记，记录了一些 TODO。';
    const updated = updatePersonProfile(existing, {
      ...BASE_INPUT,
      recentBriefingSlugs: ['2026-04-19-0900', ...BASE_INPUT.recentBriefingSlugs],
    });
    expect(updated).toContain('[[WeChat-Briefings/2026-04-19-0900]]');
    expect(updated).toContain('这里是我手写的笔记，记录了一些 TODO');
  });

  it('replaces entire content if markers absent (first generation)', () => {
    const updated = updatePersonProfile('some old freeform notes', BASE_INPUT);
    expect(updated).toContain('# 罗俊');
    expect(updated).not.toContain('some old freeform notes');
  });
});

describe('extractExistingBriefingSlugs', () => {
  it('returns empty for fresh content', () => {
    expect(extractExistingBriefingSlugs('# title\n\nno wikilinks here')).toEqual([]);
  });

  it('extracts dated briefing slugs from auto region', () => {
    const profile = renderPersonProfile(BASE_INPUT);
    const slugs = extractExistingBriefingSlugs(profile);
    expect(slugs).toContain('2026-04-18-1341');
    expect(slugs).toContain('2026-04-17-2330');
  });

  it('deduplicates duplicate slug references', () => {
    const md = `<!-- OWH:auto-begin -->
[[WeChat-Briefings/2026-04-17-2330]]
[[WeChat-Briefings/2026-04-17-2330]]
<!-- OWH:auto-end -->`;
    expect(extractExistingBriefingSlugs(md)).toEqual(['2026-04-17-2330']);
  });
});
