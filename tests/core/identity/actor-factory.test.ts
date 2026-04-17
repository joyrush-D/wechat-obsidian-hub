import { describe, it, expect } from 'vitest';
import { identityToActor, buildActorsFromResolver } from '../../../src/core/identity/actor-factory';
import type { Identity, IdentityResolver } from '../../../src/intel/identity-resolver';

function makeIdentity(overrides: Partial<Identity> = {}): Identity {
  return {
    wxid: 'wxid_x',
    primaryName: 'Alice',
    globalNames: new Set(['wxid_x', 'Alice']),
    groupAliases: new Map(),
    allNames: new Set(['wxid_x', 'Alice']),
    isGroup: false,
    hasRemark: false,
    ...overrides,
  };
}

describe('identityToActor', () => {
  it('produces an Actor with namespaced id and wxid as sourceId', () => {
    const a = identityToActor(makeIdentity(), { sourceAdapter: 'wechat' });
    expect(a.id).toBe('actor:wechat:wxid_x');
    expect(a.sourceId).toBe('wxid_x');
    expect(a.sourceAdapter).toBe('wechat');
    expect(a.type).toBe('actor');
  });

  it('copies primaryName and all aliases', () => {
    const id = makeIdentity({
      primaryName: '罗俊',
      allNames: new Set(['罗俊', 'Dexter', 'wxid_x']),
    });
    const a = identityToActor(id, { sourceAdapter: 'wechat' });
    expect(a.displayName).toBe('罗俊');
    expect(a.aliases).toContain('Dexter');
    expect(a.aliases).toContain('罗俊');
  });

  it('surfaces per-group aliases in profile.aliasesByContext', () => {
    const id = makeIdentity({
      primaryName: '罗俊',
      allNames: new Set(['罗俊', 'Dexter', '罗舒杨爸爸', 'wxid_x']),
      groupAliases: new Map([
        ['group_dev@chatroom', 'Dexter'],
        ['group_fam@chatroom', '罗舒杨爸爸'],
      ]),
      hasRemark: true,
    });
    const a = identityToActor(id, { sourceAdapter: 'wechat' });
    expect(a.profile?.aliasesByContext).toEqual({
      'group_dev@chatroom': 'Dexter',
      'group_fam@chatroom': '罗舒杨爸爸',
    });
    expect(a.profile?.hasRemark).toBe(true);
  });

  it('tags remarked identities with "remarked" label', () => {
    const a = identityToActor(makeIdentity({ hasRemark: true }), { sourceAdapter: 'wechat' });
    expect(a.labels).toContain('remarked');
  });

  it('no labels for un-remarked identities', () => {
    const a = identityToActor(makeIdentity({ hasRemark: false }), { sourceAdapter: 'wechat' });
    expect(a.labels).toBeUndefined();
  });

  it('marks groups via isGroup', () => {
    const a = identityToActor(
      makeIdentity({ wxid: 'g@chatroom', isGroup: true, primaryName: 'Team' }),
      { sourceAdapter: 'wechat' },
    );
    expect(a.isGroup).toBe(true);
  });

  it('uses provided createdAt when supplied', () => {
    const a = identityToActor(makeIdentity(), {
      sourceAdapter: 'wechat',
      createdAt: '2026-01-01T00:00:00Z',
    });
    expect(a.createdAt).toBe('2026-01-01T00:00:00Z');
  });
});

describe('buildActorsFromResolver', () => {
  it('produces one Actor per identity in the resolver', () => {
    const identities = [
      makeIdentity({ wxid: 'w1', primaryName: 'Alice' }),
      makeIdentity({ wxid: 'w2', primaryName: 'Bob' }),
      makeIdentity({ wxid: 'g1@chatroom', primaryName: 'Group', isGroup: true }),
    ];
    const resolver = { allIdentities: () => identities } as unknown as IdentityResolver;
    const actors = buildActorsFromResolver(resolver, { sourceAdapter: 'wechat' });
    expect(actors).toHaveLength(3);
    expect(actors.map(a => a.displayName)).toEqual(['Alice', 'Bob', 'Group']);
  });
});
