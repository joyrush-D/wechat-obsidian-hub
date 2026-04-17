/**
 * ObjectFactory — convert ParsedMessage (WeChat-specific) into domain
 * WxObject. One-way mapping: used during ingestion to produce entities
 * that live in EvidenceStore and can be cited by Findings.
 */

import type { WxObject } from '../types/domain';
import type { ParsedMessage, MessageCategory } from '../../types';

export interface ObjectFactoryOptions {
  sourceAdapter: string;
  createdAt?: string;
}

/** Map ParsedMessage.type → WxObject.kind. */
function kindForType(cat: MessageCategory): WxObject['kind'] {
  switch (cat) {
    case 'voice': return 'voice';
    case 'image': return 'image';
    case 'video': return 'video';
    case 'link': return 'link';
    case 'file': return 'file';
    case 'miniapp': return 'link';
    case 'text': return 'message';
    case 'quote': return 'message';
    case 'forward': return 'message';
    default: return 'other';
  }
}

/**
 * Build the canonical id for a message. The scheme is deterministic so
 * re-ingesting the same conversation produces identical ids (no duplicates).
 */
export function messageId(sourceAdapter: string, conversationId: string, localId: number): string {
  return `msg:${sourceAdapter}:${conversationId}:${localId}`;
}

export function messageToObject(
  msg: ParsedMessage,
  opts: ObjectFactoryOptions,
): WxObject {
  // Convert extra to metadata, coercing to primitive values.
  const metadata: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(msg.extra || {})) {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      metadata[k] = v;
    } else {
      metadata[k] = String(v);
    }
  }

  return {
    id: messageId(opts.sourceAdapter, msg.conversationId, msg.localId),
    type: 'object',
    createdAt: opts.createdAt ?? new Date().toISOString(),
    sourceAdapter: opts.sourceAdapter,
    sourceId: String(msg.localId),
    kind: kindForType(msg.type),
    text: msg.text,
    occurredAt: msg.time.toISOString(),
    authorId: msg.senderWxid
      ? `actor:${opts.sourceAdapter}:${msg.senderWxid}`
      : undefined,
    containerId: msg.conversationId
      ? `actor:${opts.sourceAdapter}:${msg.conversationId}`
      : undefined,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  };
}

/** Batch convert. */
export function messagesToObjects(
  msgs: ParsedMessage[],
  opts: ObjectFactoryOptions,
): WxObject[] {
  return msgs.map(m => messageToObject(m, opts));
}
