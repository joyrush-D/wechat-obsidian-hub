import { describe, it, expect } from 'vitest';
import { parseMessage } from '../../src/parser/index';
import type { RawMessage } from '../../src/types';

function makeRaw(overrides: Partial<RawMessage> = {}): RawMessage {
  return {
    local_id: 1,
    local_type: 1,
    create_time: 1700000000,
    real_sender_id: 'wxid_sender',
    message_content: null,
    compress_content: null,
    packed_info_data: null,
    ...overrides,
  };
}

describe('parseMessage dispatcher', () => {
  describe('type 1 — text', () => {
    it('dispatches plain text content', () => {
      const result = parseMessage(makeRaw({ local_type: 1, message_content: 'Hello world' }));
      expect(result.type).toBe('text');
      expect(result.text).toBe('Hello world');
    });

    it('extracts senderWxid from group message prefix', () => {
      const result = parseMessage(makeRaw({
        local_type: 1,
        message_content: 'wxid_groupmember:\nHello everyone',
        real_sender_id: '',
      }));
      expect(result.type).toBe('text');
      expect(result.senderWxid).toBe('wxid_groupmember');
      expect(result.text).toBe('Hello everyone');
    });

    it('uses real_sender_id when no prefix in content', () => {
      const result = parseMessage(makeRaw({
        local_type: 1,
        message_content: 'Direct message',
        real_sender_id: 'wxid_dm_user',
      }));
      expect(result.senderWxid).toBe('wxid_dm_user');
    });

    it('prefers content sender over real_sender_id', () => {
      const result = parseMessage(makeRaw({
        local_type: 1,
        message_content: 'wxid_override:\nHi',
        real_sender_id: 'wxid_original',
      }));
      expect(result.senderWxid).toBe('wxid_override');
    });
  });

  describe('type 3 — image', () => {
    it('returns image type', () => {
      const result = parseMessage(makeRaw({ local_type: 3, message_content: '<msg><md5>abc</md5></msg>' }));
      expect(result.type).toBe('image');
      expect(result.text).toBe('[image]');
    });

    it('carries extra.md5 from content', () => {
      const result = parseMessage(makeRaw({ local_type: 3, message_content: '<img><md5>deadbeef</md5></img>' }));
      expect(result.extra.md5).toBe('deadbeef');
    });
  });

  describe('type 34 — voice', () => {
    it('returns voice type', () => {
      const result = parseMessage(makeRaw({ local_type: 34, message_content: null }));
      expect(result.type).toBe('voice');
      expect(result.text).toBe('[voice]');
    });

    it('carries duration from voicelength', () => {
      const result = parseMessage(makeRaw({ local_type: 34, message_content: '<msg><voicelength>3000</voicelength></msg>' }));
      expect(result.extra.duration_ms).toBe('3000');
    });
  });

  describe('type 43 — video', () => {
    it('returns video type', () => {
      const result = parseMessage(makeRaw({ local_type: 43, message_content: null }));
      expect(result.type).toBe('video');
      expect(result.text).toBe('[video]');
    });
  });

  describe('type 47 — emoji', () => {
    it('returns emoji type', () => {
      const result = parseMessage(makeRaw({ local_type: 47, message_content: null }));
      expect(result.type).toBe('emoji');
      expect(result.text).toBe('[emoji]');
    });

    it('carries emoji description', () => {
      const result = parseMessage(makeRaw({ local_type: 47, message_content: '<msg><emoji><desc>laugh</desc></emoji></msg>' }));
      expect(result.extra.description).toBe('laugh');
    });
  });

  describe('type 49 — app/link', () => {
    it('returns link type for sub_type 5', () => {
      const xml = '<msg><appmsg><type>5</type><title>Test Link</title><url>https://example.com</url></appmsg></msg>';
      const result = parseMessage(makeRaw({ local_type: 49, message_content: xml }));
      expect(result.type).toBe('link');
      expect(result.text).toContain('Test Link');
    });

    it('falls back to content when compress_content is null', () => {
      const xml = '<msg><appmsg><type>5</type><title>Fallback</title><url>https://fb.com</url></appmsg></msg>';
      const result = parseMessage(makeRaw({ local_type: 49, message_content: xml, compress_content: null }));
      expect(result.type).toBe('link');
    });
  });

  describe('type 10000 — system', () => {
    it('returns system type', () => {
      const result = parseMessage(makeRaw({ local_type: 10000, message_content: '<sysmsg>You joined the group</sysmsg>' }));
      expect(result.type).toBe('system');
      expect(result.text).toBe('You joined the group');
    });

    it('returns [system] for null content', () => {
      const result = parseMessage(makeRaw({ local_type: 10000, message_content: null }));
      expect(result.type).toBe('system');
      expect(result.text).toBe('[system]');
    });
  });

  describe('type 10002 — revoked', () => {
    it('returns system type with revoke info', () => {
      const xml = '<sysmsg><revokemsg><revoker>wxid_abc</revoker><newmsgid>99999</newmsgid></revokemsg></sysmsg>';
      const result = parseMessage(makeRaw({ local_type: 10002, message_content: xml }));
      expect(result.type).toBe('system');
      expect(result.extra.revoker).toBe('wxid_abc');
      expect(result.extra.revoked_msg_id).toBe('99999');
    });
  });

  describe('bitmask extraction', () => {
    it('extracts baseType from composed local_type via & 0xFFFF', () => {
      // 0x00010001 has lower 16 bits = 1 → text
      const result = parseMessage(makeRaw({ local_type: 0x00010001, message_content: 'Bitmask test' }));
      expect(result.type).toBe('text');
    });

    it('extracts type 3 from high+low composed value', () => {
      // 0x00050003 & 0xFFFF = 3 → image
      const result = parseMessage(makeRaw({ local_type: 0x00050003, message_content: null }));
      expect(result.type).toBe('image');
    });

    it('extracts type 34 from composed value', () => {
      // 0x00070022 & 0xFFFF = 34 → voice
      const result = parseMessage(makeRaw({ local_type: 0x00070022, message_content: null }));
      expect(result.type).toBe('voice');
    });
  });

  describe('unknown types', () => {
    it('returns other for unknown type with content snippet', () => {
      const result = parseMessage(makeRaw({ local_type: 9999, message_content: 'Raw content here' }));
      expect(result.type).toBe('other');
      expect(result.text).toBe('Raw content here');
    });

    it('returns placeholder for unknown type with null content', () => {
      const result = parseMessage(makeRaw({ local_type: 8888, message_content: null }));
      expect(result.type).toBe('other');
      expect(result.text).toBe('[type-8888]');
    });

    it('truncates long content for unknown type to 100 chars', () => {
      const longContent = 'x'.repeat(200);
      const result = parseMessage(makeRaw({ local_type: 7777, message_content: longContent }));
      expect(result.text.length).toBe(100);
    });
  });

  describe('senderWxid passthrough', () => {
    it('passes real_sender_id through for all non-text types', () => {
      const result = parseMessage(makeRaw({ local_type: 3, real_sender_id: 'wxid_imguser', message_content: null }));
      expect(result.senderWxid).toBe('wxid_imguser');
    });

    it('passes empty string when real_sender_id is absent', () => {
      const result = parseMessage(makeRaw({ local_type: 3, real_sender_id: '', message_content: null }));
      expect(result.senderWxid).toBe('');
    });
  });
});
