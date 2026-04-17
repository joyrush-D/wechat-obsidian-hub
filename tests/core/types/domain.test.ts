/**
 * Tests for domain type guards.
 */
import { describe, it, expect } from 'vitest';
import {
  isActor, isObject, isEvent, isRelationship, isIndicator, isReport,
  type Actor, type WxObject, type Event, type Relationship, type Indicator, type Report,
} from '../../../src/core/types/domain';

const BASE = {
  createdAt: '2026-04-18T00:00:00Z',
  sourceAdapter: 'wechat',
};

describe('type guards', () => {
  const actor: Actor = {
    ...BASE, id: 'a1', type: 'actor', displayName: 'Alice',
    aliases: ['Alice', 'wxid_a'], isGroup: false,
  };
  const obj: WxObject = {
    ...BASE, id: 'o1', type: 'object', kind: 'message',
    text: 'hi', occurredAt: '2026-04-18T01:00:00Z',
  };
  const event: Event = {
    ...BASE, id: 'e1', type: 'event', title: 'meeting',
    occurredAt: '2026-04-18T02:00:00Z', participantIds: ['a1'], objectIds: ['o1'],
  };
  const rel: Relationship = {
    ...BASE, id: 'r1', type: 'relationship', kind: 'sent',
    fromId: 'a1', toId: 'o1',
  };
  const ind: Indicator = {
    ...BASE, id: 'i1', type: 'indicator', name: 'no-message-7d',
    description: '7-day silence', predicate: 'daysSinceLastMessage > 7',
  };
  const rep: Report = {
    ...BASE, id: 'p1', type: 'report', title: 'brief',
    generatedAt: '2026-04-18T03:00:00Z',
    coveringPeriodStart: '2026-04-18T00:00:00Z',
    coveringPeriodEnd: '2026-04-18T23:59:59Z',
    findingIds: ['f1'], summary: '', body: '',
  };

  it('isActor returns true only for actor entities', () => {
    expect(isActor(actor)).toBe(true);
    expect(isActor(obj)).toBe(false);
    expect(isActor(event)).toBe(false);
  });

  it('isObject returns true only for object entities', () => {
    expect(isObject(obj)).toBe(true);
    expect(isObject(actor)).toBe(false);
    expect(isObject(rel)).toBe(false);
  });

  it('isEvent returns true only for event entities', () => {
    expect(isEvent(event)).toBe(true);
    expect(isEvent(actor)).toBe(false);
  });

  it('isRelationship returns true only for relationship entities', () => {
    expect(isRelationship(rel)).toBe(true);
    expect(isRelationship(event)).toBe(false);
  });

  it('isIndicator returns true only for indicator entities', () => {
    expect(isIndicator(ind)).toBe(true);
    expect(isIndicator(rep)).toBe(false);
  });

  it('isReport returns true only for report entities', () => {
    expect(isReport(rep)).toBe(true);
    expect(isReport(actor)).toBe(false);
  });
});
