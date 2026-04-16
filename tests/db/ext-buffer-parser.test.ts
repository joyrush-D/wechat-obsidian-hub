import { describe, it, expect } from 'vitest';
import { parseExtBufferNicknames } from '../../src/db/ext-buffer-parser';

// ---------------------------------------------------------------------------
// Helpers to build minimal protobuf bytes
// ---------------------------------------------------------------------------

function encodeVarint(value: number): number[] {
  const bytes: number[] = [];
  while (value > 0x7f) {
    bytes.push((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  bytes.push(value & 0x7f);
  return bytes;
}

function encodeLengthDelimited(fieldNumber: number, data: Uint8Array): number[] {
  const tag = (fieldNumber << 3) | 2; // wire type 2
  return [...encodeVarint(tag), ...encodeVarint(data.length), ...Array.from(data)];
}

function encodeStringField(fieldNumber: number, text: string): number[] {
  const bytes = new TextEncoder().encode(text);
  return encodeLengthDelimited(fieldNumber, bytes);
}

/**
 * Build a minimal ext_buffer containing one chat-room member entry.
 * Top-level field 4 (length-delimited) wraps:
 *   field 1 = wxid  (string)
 *   field 2 = nickname (string)
 */
function buildExtBuffer(members: Array<{ wxid: string; nickname: string }>): Uint8Array {
  const outer: number[] = [];
  for (const { wxid, nickname } of members) {
    const inner: number[] = [
      ...encodeStringField(1, wxid),
      ...encodeStringField(2, nickname),
    ];
    outer.push(...encodeLengthDelimited(4, new Uint8Array(inner)));
  }
  return new Uint8Array(outer);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parseExtBufferNicknames', () => {
  it('returns empty map for null input', () => {
    const result = parseExtBufferNicknames(null);
    expect(result.size).toBe(0);
  });

  it('returns empty map for empty buffer', () => {
    const result = parseExtBufferNicknames(new Uint8Array(0));
    expect(result.size).toBe(0);
  });

  it('does not crash on malformed/random bytes', () => {
    const malformed = new Uint8Array([0xff, 0xfe, 0xfd, 0x00, 0x01, 0x02]);
    expect(() => parseExtBufferNicknames(malformed)).not.toThrow();
  });

  it('does not crash on truncated protobuf', () => {
    // A length-delimited field tag (0x22 = field 4, wire 2) followed by
    // a length that exceeds remaining buffer.
    const truncated = new Uint8Array([0x22, 0xff, 0x01]); // says 255 bytes follow, but only 0 do
    expect(() => parseExtBufferNicknames(truncated)).not.toThrow();
    const result = parseExtBufferNicknames(truncated);
    expect(result.size).toBe(0);
  });

  it('parses a single member entry', () => {
    const buf = buildExtBuffer([{ wxid: 'wxid_alice', nickname: 'Alice' }]);
    const result = parseExtBufferNicknames(buf);
    expect(result.size).toBe(1);
    expect(result.get('wxid_alice')).toBe('Alice');
  });

  it('parses multiple member entries', () => {
    const buf = buildExtBuffer([
      { wxid: 'wxid_alice', nickname: 'Alice' },
      { wxid: 'wxid_bob',   nickname: 'Bob'   },
      { wxid: 'wxid_carol', nickname: 'Carol' },
    ]);
    const result = parseExtBufferNicknames(buf);
    expect(result.size).toBe(3);
    expect(result.get('wxid_alice')).toBe('Alice');
    expect(result.get('wxid_bob')).toBe('Bob');
    expect(result.get('wxid_carol')).toBe('Carol');
  });

  it('ignores entries where wxid is missing', () => {
    // Build inner with only field 2 (nickname), no field 1 (wxid)
    const inner = encodeStringField(2, 'Ghost');
    const outer = encodeLengthDelimited(4, new Uint8Array(inner));
    const result = parseExtBufferNicknames(new Uint8Array(outer));
    // No wxid → entry should be skipped
    expect(result.size).toBe(0);
  });

  it('ignores entries where nickname is missing', () => {
    // Build inner with only field 1 (wxid), no field 2 (nickname)
    const inner = encodeStringField(1, 'wxid_ghost');
    const outer = encodeLengthDelimited(4, new Uint8Array(inner));
    const result = parseExtBufferNicknames(new Uint8Array(outer));
    expect(result.size).toBe(0);
  });

  it('handles UTF-8 nicknames (Chinese characters)', () => {
    const buf = buildExtBuffer([{ wxid: 'wxid_zh', nickname: '张三' }]);
    const result = parseExtBufferNicknames(buf);
    expect(result.get('wxid_zh')).toBe('张三');
  });

  it('returns a plain Map (not mutated by repeated calls)', () => {
    const buf = buildExtBuffer([{ wxid: 'wxid_x', nickname: 'X' }]);
    const r1 = parseExtBufferNicknames(buf);
    const r2 = parseExtBufferNicknames(buf);
    r1.set('extra', 'val');
    expect(r2.has('extra')).toBe(false);
  });
});
