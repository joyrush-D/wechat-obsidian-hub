/**
 * ActorFactory — convert existing Identity (from intel/identity-resolver.ts)
 * into domain-model Actor objects that can be persisted in EvidenceStore.
 *
 * This is the bridge between the WeChat-specific plumbing and the
 * domain-agnostic core. Future sources (Slack, GDELT, ...) will have their
 * own factories that emit the same Actor shape.
 */

import type { Actor } from '../types/domain';
import type { Identity, IdentityResolver } from '../../intel/identity-resolver';

export interface ActorFactoryOptions {
  /** Adapter id to stamp on every Actor (e.g. 'wechat'). */
  sourceAdapter: string;
  /** ISO timestamp to use as createdAt. Defaults to now. */
  createdAt?: string;
}

export function identityToActor(
  identity: Identity,
  opts: ActorFactoryOptions,
): Actor {
  const aliasesByContext: Record<string, string> = {};
  for (const [groupId, alias] of identity.groupAliases) {
    aliasesByContext[groupId] = alias;
  }

  return {
    id: `actor:${opts.sourceAdapter}:${identity.wxid}`,
    type: 'actor',
    createdAt: opts.createdAt ?? new Date().toISOString(),
    sourceAdapter: opts.sourceAdapter,
    sourceId: identity.wxid,
    displayName: identity.primaryName,
    aliases: [...identity.allNames],
    isGroup: identity.isGroup,
    profile: {
      nickName: findDistinct(identity.globalNames, identity.wxid, identity.primaryName),
      aliasesByContext: Object.keys(aliasesByContext).length > 0 ? aliasesByContext : undefined,
      hasRemark: identity.hasRemark,
    },
    labels: identity.hasRemark ? ['remarked'] : undefined,
  };
}

/** Given a resolver, emit all Actor entities for later persistence. */
export function buildActorsFromResolver(
  resolver: IdentityResolver,
  opts: ActorFactoryOptions,
): Actor[] {
  return resolver.allIdentities().map(id => identityToActor(id, opts));
}

/**
 * First entry in `set` that is neither `wxid` nor `primary`, or undefined.
 * Used to recover a nickname-ish value for the actor profile.
 */
function findDistinct(set: Set<string>, wxid: string, primary: string): string | undefined {
  for (const v of set) {
    if (v !== wxid && v !== primary) return v;
  }
  return undefined;
}
