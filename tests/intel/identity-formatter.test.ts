/**
 * Tests for IdentityFormatter — the annotation layer for multi-alias people.
 * These tests use a hand-crafted mock IdentityResolver to avoid protobuf parsing.
 */
import { describe, it, expect } from 'vitest';
import {
  hasMultipleAliases,
  compactAnnotation,
  buildAliasIndex,
  formatPersonInline,
} from '../../src/intel/identity-formatter';
import type { Identity, IdentityResolver } from '../../src/intel/identity-resolver';

/** Build an Identity for tests without going through ContactReader. */
function makeIdentity(opts: {
  wxid: string;
  primaryName: string;
  globalNames?: string[];
  groupAliases?: Array<[string, string]>;  // [groupId, alias]
  hasRemark?: boolean;
  isGroup?: boolean;
}): Identity {
  const globalNames = new Set<string>([opts.wxid, ...(opts.globalNames ?? [])]);
  const groupAliasesMap = new Map<string, string>(opts.groupAliases ?? []);
  const allNames = new Set<string>(globalNames);
  for (const alias of groupAliasesMap.values()) allNames.add(alias);
  return {
    wxid: opts.wxid,
    primaryName: opts.primaryName,
    globalNames,
    groupAliases: groupAliasesMap,
    allNames,
    isGroup: opts.isGroup ?? false,
    hasRemark: opts.hasRemark ?? false,
  };
}

/** Build a mock resolver backed by a wxid → Identity map + group display names. */
function makeResolver(
  identities: Identity[],
  groupDisplayNames: Record<string, string> = {},
): IdentityResolver {
  const byWxid = new Map(identities.map(i => [i.wxid, i]));
  const byAlias = new Map<string, string>();
  for (const id of identities) {
    for (const name of id.allNames) {
      byAlias.set(name.trim().toLowerCase(), id.wxid);
    }
  }
  return {
    get: (wxid: string) => byWxid.get(wxid) ?? null,
    findByName: (name: string) => {
      const wxid = byAlias.get(name.trim().toLowerCase());
      return wxid ? byWxid.get(wxid) ?? null : null;
    },
    getAllNames: (wxid: string) => {
      const id = byWxid.get(wxid);
      return id ? [...id.allNames] : [];
    },
    getGroupAliasEntries: (wxid: string) => {
      const id = byWxid.get(wxid);
      if (!id) return [];
      return [...id.groupAliases.entries()].map(([groupId, alias]) => ({
        groupName: groupDisplayNames[groupId] ?? groupId,
        alias,
      }));
    },
    allIdentities: () => [...byWxid.values()],
    stats: () => ({
      identities: byWxid.size,
      aliases: byAlias.size,
      withRemark: identities.filter(i => i.hasRemark).length,
      multiAlias: identities.filter(i => i.allNames.size >= 3).length,
    }),
  } as unknown as IdentityResolver;
}

describe('hasMultipleAliases', () => {
  it('returns false for a person with only wxid + single nickname', () => {
    const id = makeIdentity({
      wxid: 'wxid_abc',
      primaryName: 'Alice',
      globalNames: ['Alice'],
    });
    expect(hasMultipleAliases(id)).toBe(false);
  });

  it('returns true when person has nickname + remark', () => {
    const id = makeIdentity({
      wxid: 'wxid_abc',
      primaryName: 'Alice Wang',
      globalNames: ['Alice', 'Alice Wang'],
      hasRemark: true,
    });
    expect(hasMultipleAliases(id)).toBe(true);
  });

  it('returns true when person has nickname + a group alias', () => {
    const id = makeIdentity({
      wxid: 'wxid_abc',
      primaryName: 'Alice',
      globalNames: ['Alice'],
      groupAliases: [['group1@chatroom', 'AliceDev']],
    });
    expect(hasMultipleAliases(id)).toBe(true);
  });

  it('ignores raw wxid when counting human names', () => {
    // If person only has wxid + raw wxid-looking names, it should NOT count as multi-alias
    const id = makeIdentity({
      wxid: 'wxid_abc',
      primaryName: 'wxid_abc',
      globalNames: ['wxid_other_123'],
    });
    expect(hasMultipleAliases(id)).toBe(false);
  });
});

describe('compactAnnotation', () => {
  it('returns empty string for single-alias person', () => {
    const id = makeIdentity({
      wxid: 'wxid_abc',
      primaryName: 'Alice',
      globalNames: ['Alice'],
    });
    const resolver = makeResolver([id]);
    expect(compactAnnotation(id, resolver)).toBe('');
  });

  it('includes wxid for multi-alias person', () => {
    const id = makeIdentity({
      wxid: 'wxid_abc',
      primaryName: '罗俊',
      globalNames: ['罗俊'],
      groupAliases: [
        ['group1@chatroom', 'Dexter'],
        ['group2@chatroom', '罗舒杨爸爸'],
      ],
      hasRemark: true,
    });
    const resolver = makeResolver([id], {
      'group1@chatroom': '数字游民群',
      'group2@chatroom': '家族群',
    });
    const annotation = compactAnnotation(id, resolver);
    expect(annotation).toContain('wxid_abc');
    expect(annotation).toContain('ID:');
    // Should mention at least one group alias
    expect(annotation).toMatch(/Dexter|罗舒杨爸爸/);
  });

  it('resolves group id to group display name when available', () => {
    const id = makeIdentity({
      wxid: 'wxid_abc',
      primaryName: '老张',
      globalNames: ['老张'],
      groupAliases: [['group_xyz@chatroom', '张工']],
    });
    const resolver = makeResolver([id], { 'group_xyz@chatroom': '研发群' });
    const annotation = compactAnnotation(id, resolver);
    expect(annotation).toContain('研发群');
    expect(annotation).toContain('张工');
    expect(annotation).not.toContain('group_xyz@chatroom');
  });

  it('caps to 2 group aliases in compact form to avoid header bloat', () => {
    // Aliases use Chinese numerals so they don't collide with wxid/label text in the regex check
    const id = makeIdentity({
      wxid: 'wxid_busy',
      primaryName: '张三',
      globalNames: ['张三'],
      groupAliases: [
        ['g1@chatroom', '一号'],
        ['g2@chatroom', '二号'],
        ['g3@chatroom', '三号'],
        ['g4@chatroom', '四号'],
      ],
    });
    const resolver = makeResolver([id]);
    const annotation = compactAnnotation(id, resolver);
    // Only first 2 aliases should appear in the compact form
    const aliasMatches = (annotation.match(/[一二三四]号/g) ?? []).length;
    expect(aliasMatches).toBeLessThanOrEqual(2);
    // Positive check: at least one of the first two should be there
    expect(annotation).toMatch(/一号|二号/);
  });
});

describe('formatPersonInline', () => {
  it('returns plain name for single-alias person', () => {
    const id = makeIdentity({ wxid: 'wxid_x', primaryName: 'Alice', globalNames: ['Alice'] });
    const resolver = makeResolver([id]);
    const seen = new Set<string>();
    expect(formatPersonInline(id, resolver, seen)).toBe('Alice');
  });

  it('annotates first occurrence then uses plain name on subsequent calls', () => {
    const id = makeIdentity({
      wxid: 'wxid_abc',
      primaryName: '罗俊',
      globalNames: ['罗俊'],
      groupAliases: [['g1@chatroom', 'Dexter']],
      hasRemark: true,
    });
    const resolver = makeResolver([id], { 'g1@chatroom': '数字游民群' });
    const seen = new Set<string>();

    const first = formatPersonInline(id, resolver, seen);
    expect(first).not.toBe('罗俊');                // has annotation
    expect(first).toContain('罗俊');
    expect(first).toContain('wxid_abc');

    const second = formatPersonInline(id, resolver, seen);
    expect(second).toBe('罗俊');                   // plain on second
  });
});

describe('buildAliasIndex', () => {
  it('returns empty string when nobody has multiple aliases', () => {
    const id = makeIdentity({ wxid: 'wxid_x', primaryName: 'Alice', globalNames: ['Alice'] });
    const resolver = makeResolver([id]);
    expect(buildAliasIndex(['wxid_x'], resolver)).toBe('');
  });

  it('returns a markdown table when at least one person has multiple aliases', () => {
    const multi = makeIdentity({
      wxid: 'wxid_abc',
      primaryName: '罗俊',
      globalNames: ['罗俊'],
      groupAliases: [
        ['g1@chatroom', 'Dexter'],
        ['g2@chatroom', '罗舒杨爸爸'],
      ],
      hasRemark: true,
    });
    const single = makeIdentity({
      wxid: 'wxid_y',
      primaryName: 'Bob',
      globalNames: ['Bob'],
    });
    const resolver = makeResolver([multi, single], {
      'g1@chatroom': '数字游民群',
      'g2@chatroom': '家族群',
    });
    const table = buildAliasIndex(['wxid_abc', 'wxid_y'], resolver);
    expect(table).toContain('人物别名索引');
    expect(table).toContain('| 主名 |');
    expect(table).toContain('罗俊');
    expect(table).toContain('wxid_abc');
    expect(table).toContain('Dexter @ 数字游民群');
    expect(table).toContain('罗舒杨爸爸 @ 家族群');
    // Bob should NOT appear — they only have one alias
    expect(table).not.toContain('Bob');
  });

  it('excludes group entities even when they have multiple names', () => {
    const group = makeIdentity({
      wxid: 'group1@chatroom',
      primaryName: '数字游民群',
      globalNames: ['数字游民群', '游民'],
      isGroup: true,
      hasRemark: true,
    });
    const resolver = makeResolver([group]);
    expect(buildAliasIndex(['group1@chatroom'], resolver)).toBe('');
  });

  it('silently skips unknown wxids in the relevant list', () => {
    const id = makeIdentity({
      wxid: 'wxid_abc',
      primaryName: '罗俊',
      globalNames: ['罗俊'],
      groupAliases: [['g1@chatroom', 'Dexter']],
    });
    const resolver = makeResolver([id]);
    expect(() =>
      buildAliasIndex(['wxid_abc', 'wxid_does_not_exist'], resolver),
    ).not.toThrow();
  });

  it('marks remarked people with 📌', () => {
    const remarked = makeIdentity({
      wxid: 'wxid_1',
      primaryName: '老陈',
      globalNames: ['老陈'],
      groupAliases: [['g1@chatroom', '陈总']],
      hasRemark: true,
    });
    const resolver = makeResolver([remarked]);
    const table = buildAliasIndex(['wxid_1'], resolver);
    expect(table).toContain('📌');
  });
});
