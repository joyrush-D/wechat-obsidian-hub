/**
 * Domain model — STIX-inspired six-element ontology used across all
 * data sources (WeChat, Slack, GDELT, SEC EDGAR, etc.).
 *
 * Mapping for WeChat (v0.3.0 first domain):
 *   Actor        ← a WeChat user or group
 *   WxObject     ← a message / file / image / voice clip
 *   Event        ← a conversation, a day's activity, a named incident
 *   Relationship ← Actor→Actor (friend), Actor→WxObject (sent), Event→Actor (mentioned)
 *   Indicator    ← a signpost: "X has not messaged in 7 days", "new @ spike"
 *   Report       ← an analysis output with Findings + Evidence refs
 *
 * For future domains the shape stays identical; only the adapter that emits
 * these objects changes.
 */

export type DomainEntityType =
  | 'actor'
  | 'object'
  | 'event'
  | 'relationship'
  | 'indicator'
  | 'report';

/** Common fields every domain entity carries. */
export interface DomainEntity {
  id: string;                        // globally unique within the store
  type: DomainEntityType;
  createdAt: string;                 // ISO timestamp of when entity was ingested
  sourceAdapter: string;             // e.g. 'wechat', 'slack', 'gdelt'
  sourceId?: string;                 // native ID within source (wxid, Slack ID, ...)
  labels?: string[];                 // tags for filtering / search
}

/** A person, organization, account, or group. */
export interface Actor extends DomainEntity {
  type: 'actor';
  displayName: string;
  aliases: string[];                 // every alternate name / nickname
  isGroup: boolean;
  /** Optional rich profile the analyst can drill into. */
  profile?: {
    remark?: string;                 // user-assigned note
    nickName?: string;
    aliasesByContext?: Record<string, string>;  // e.g. groupId → group-specific alias
    [k: string]: unknown;
  };
}

/** A concrete informational object: message, file, image, link. */
export interface WxObject extends DomainEntity {
  type: 'object';
  kind: 'message' | 'file' | 'image' | 'voice' | 'video' | 'link' | 'other';
  /** Natural-language representation (transcript for voice, OCR for image, text for message). */
  text: string;
  /** Wall-clock time of the object (not ingestion time). */
  occurredAt: string;
  /** Author (for message-like objects) — references Actor.id. */
  authorId?: string;
  /** Where this object belongs (group/conversation). Actor.id of the container. */
  containerId?: string;
  /** Arbitrary typed metadata (md5, duration, url, ...). */
  metadata?: Record<string, string | number | boolean>;
}

/** A time-bound happening: a conversation, a decision, a named incident. */
export interface Event extends DomainEntity {
  type: 'event';
  title: string;
  occurredAt: string;
  endedAt?: string;
  /** Actor.id of the participants. */
  participantIds: string[];
  /** WxObject.id evidence attached to the event. */
  objectIds: string[];
  description?: string;
}

/** A typed edge between two entities. */
export interface Relationship extends DomainEntity {
  type: 'relationship';
  /** e.g. 'sent', 'mentioned', 'replied_to', 'joined', 'same_person'. */
  kind: string;
  fromId: string;
  toId: string;
  strength?: number;                 // 0..1 where applicable
  startedAt?: string;
  endedAt?: string;
}

/** A measurable signpost that triggers when a predicate matches. */
export interface Indicator extends DomainEntity {
  type: 'indicator';
  name: string;                      // human-readable
  description: string;
  /** Free-form DSL or description of the check (engine-specific). */
  predicate: string;
  /** Last-evaluated state. */
  currentValue?: number | boolean | string;
  lastEvaluatedAt?: string;
  triggered?: boolean;
}

/** An analysis output. Carries Findings + references back to evidence. */
export interface Report extends DomainEntity {
  type: 'report';
  title: string;
  generatedAt: string;
  coveringPeriodStart: string;
  coveringPeriodEnd: string;
  /** Reference to Findings by id (see finding.ts). */
  findingIds: string[];
  /** BLUF / tearline content — rendered markdown. */
  summary: string;
  /** Full markdown body for the report (what the user reads). */
  body: string;
}

export type AnyDomainEntity =
  | Actor | WxObject | Event | Relationship | Indicator | Report;

/**
 * Type guards — cheap narrowing helpers, kept here so they evolve with
 * the types themselves.
 */
export function isActor(e: DomainEntity): e is Actor { return e.type === 'actor'; }
export function isObject(e: DomainEntity): e is WxObject { return e.type === 'object'; }
export function isEvent(e: DomainEntity): e is Event { return e.type === 'event'; }
export function isRelationship(e: DomainEntity): e is Relationship { return e.type === 'relationship'; }
export function isIndicator(e: DomainEntity): e is Indicator { return e.type === 'indicator'; }
export function isReport(e: DomainEntity): e is Report { return e.type === 'report'; }
