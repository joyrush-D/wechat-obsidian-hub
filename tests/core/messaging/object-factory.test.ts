import { describe, it, expect } from 'vitest';
import { messageToObject, messagesToObjects, messageId } from '../../../src/core/messaging/object-factory';
import type { ParsedMessage } from '../../../src/types';

function makeMsg(overrides: Partial<ParsedMessage> = {}): ParsedMessage {
  return {
    localId: 42,
    time: new Date('2026-04-18T09:30:00Z'),
    conversationId: 'group_abc@chatroom',
    conversationName: 'Dev',
    sender: 'Alice',
    senderWxid: 'wxid_alice',
    text: 'Hello team',
    type: 'text',
    extra: {},
    ...overrides,
  };
}

describe('messageId', () => {
  it('produces a deterministic id from (adapter, conversationId, localId)', () => {
    expect(messageId('wechat', 'g@chatroom', 1))
      .toBe('msg:wechat:g@chatroom:1');
  });

  it('different inputs produce different ids', () => {
    expect(messageId('wechat', 'a', 1)).not.toBe(messageId('wechat', 'a', 2));
    expect(messageId('wechat', 'a', 1)).not.toBe(messageId('slack', 'a', 1));
  });
});

describe('messageToObject', () => {
  it('maps basic fields correctly', () => {
    const o = messageToObject(makeMsg(), { sourceAdapter: 'wechat' });
    expect(o.id).toBe('msg:wechat:group_abc@chatroom:42');
    expect(o.type).toBe('object');
    expect(o.sourceAdapter).toBe('wechat');
    expect(o.sourceId).toBe('42');
    expect(o.text).toBe('Hello team');
    expect(o.kind).toBe('message');
    expect(o.occurredAt).toBe('2026-04-18T09:30:00.000Z');
  });

  it('produces authorId and containerId using the actor namespace', () => {
    const o = messageToObject(makeMsg(), { sourceAdapter: 'wechat' });
    expect(o.authorId).toBe('actor:wechat:wxid_alice');
    expect(o.containerId).toBe('actor:wechat:group_abc@chatroom');
  });

  it('maps message types to the correct kind', () => {
    expect(messageToObject(makeMsg({ type: 'voice' }), { sourceAdapter: 'wechat' }).kind).toBe('voice');
    expect(messageToObject(makeMsg({ type: 'image' }), { sourceAdapter: 'wechat' }).kind).toBe('image');
    expect(messageToObject(makeMsg({ type: 'video' }), { sourceAdapter: 'wechat' }).kind).toBe('video');
    expect(messageToObject(makeMsg({ type: 'link' }), { sourceAdapter: 'wechat' }).kind).toBe('link');
    expect(messageToObject(makeMsg({ type: 'file' }), { sourceAdapter: 'wechat' }).kind).toBe('file');
    expect(messageToObject(makeMsg({ type: 'miniapp' }), { sourceAdapter: 'wechat' }).kind).toBe('link');
    expect(messageToObject(makeMsg({ type: 'system' }), { sourceAdapter: 'wechat' }).kind).toBe('other');
    expect(messageToObject(makeMsg({ type: 'emoji' }), { sourceAdapter: 'wechat' }).kind).toBe('other');
  });

  it('preserves metadata from extra', () => {
    const o = messageToObject(
      makeMsg({ extra: { md5: 'abc', duration_ms: '5000', url: 'https://ex.com' } }),
      { sourceAdapter: 'wechat' },
    );
    expect(o.metadata).toMatchObject({ md5: 'abc', duration_ms: '5000', url: 'https://ex.com' });
  });

  it('omits metadata when extra is empty', () => {
    const o = messageToObject(makeMsg({ extra: {} }), { sourceAdapter: 'wechat' });
    expect(o.metadata).toBeUndefined();
  });

  it('omits authorId when senderWxid is empty', () => {
    const o = messageToObject(makeMsg({ senderWxid: '' }), { sourceAdapter: 'wechat' });
    expect(o.authorId).toBeUndefined();
  });
});

describe('messagesToObjects', () => {
  it('batch-converts an array preserving order', () => {
    const msgs = [
      makeMsg({ localId: 1, text: 'first' }),
      makeMsg({ localId: 2, text: 'second' }),
      makeMsg({ localId: 3, text: 'third' }),
    ];
    const objs = messagesToObjects(msgs, { sourceAdapter: 'wechat' });
    expect(objs).toHaveLength(3);
    expect(objs.map(o => o.text)).toEqual(['first', 'second', 'third']);
  });
});
