/**
 * SourceAdapter — abstracts a data source (WeChat, Slack, GDELT, SEC EDGAR, ...)
 * so the Agent can analyze any feed with the same SAT operators.
 *
 * Sources emit domain entities (Actor, WxObject, Event, Relationship) that
 * downstream consumers can reason over uniformly.
 */

import type { AnyDomainEntity } from '../types/domain';

export interface SourceFetchOptions {
  /** Only return entities that occurred at or after this ISO timestamp. */
  since?: string;
  /** Only return entities that occurred at or before this ISO timestamp. */
  until?: string;
  /** Optional per-adapter filter keys (group id, channel, keyword, ...). */
  filter?: Record<string, string | number>;
}

export interface SourceAdapter {
  /** Adapter identifier, e.g. 'wechat', 'slack'. */
  readonly id: string;

  /** Human-friendly display label. */
  readonly displayName: string;

  /** Is the adapter ready (connected, configured, authorized)? */
  isReady(): Promise<boolean>;

  /**
   * Fetch domain entities. Implementations SHOULD yield batches to keep
   * memory bounded for large feeds.
   */
  fetch(opts: SourceFetchOptions): AsyncIterable<AnyDomainEntity[]>;

  /**
   * Get adapter-specific capabilities (used for UI / Agent planning).
   * Not all sources support every modality.
   */
  capabilities(): {
    hasVoice: boolean;
    hasImage: boolean;
    hasVideo: boolean;
    supportsLiveStream: boolean;
  };
}
