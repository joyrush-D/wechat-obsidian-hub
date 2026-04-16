import { describe, it, expect } from 'vitest';
import { parseTextMessage } from '../../src/parser/text-parser';

describe('parseTextMessage', () => {
  it('returns empty strings for null input', () => {
    const result = parseTextMessage(null);
    expect(result.senderWxid).toBe('');
    expect(result.text).toBe('');
  });

  it('returns empty strings for empty string input', () => {
    const result = parseTextMessage('');
    expect(result.senderWxid).toBe('');
    expect(result.text).toBe('');
  });

  it('parses sender prefix with newline separator', () => {
    const result = parseTextMessage('wxid_abc:\nHello');
    expect(result.senderWxid).toBe('wxid_abc');
    expect(result.text).toBe('Hello');
  });

  it('parses sender prefix with CRLF', () => {
    const result = parseTextMessage('wxid_abc:\r\nHello World');
    expect(result.senderWxid).toBe('wxid_abc');
    expect(result.text).toBe('Hello World');
  });

  it('parses sender prefix with space separator', () => {
    const result = parseTextMessage('wxid_def456: Hello there');
    expect(result.senderWxid).toBe('wxid_def456');
    expect(result.text).toBe('Hello there');
  });

  it('parses multiline message content', () => {
    const result = parseTextMessage('wxid_xyz:\nLine one\nLine two\nLine three');
    expect(result.senderWxid).toBe('wxid_xyz');
    expect(result.text).toBe('Line one\nLine two\nLine three');
  });

  it('handles direct message (no sender prefix) - DM scenario', () => {
    const result = parseTextMessage('Just a plain message with no prefix');
    expect(result.senderWxid).toBe('');
    expect(result.text).toBe('Just a plain message with no prefix');
  });

  it('handles sender with underscores and hyphens', () => {
    const result = parseTextMessage('wxid_some-user_123:\nMessage text');
    expect(result.senderWxid).toBe('wxid_some-user_123');
    expect(result.text).toBe('Message text');
  });

  it('trims whitespace from parsed text', () => {
    const result = parseTextMessage('wxid_abc:   \n  Hello  ');
    expect(result.senderWxid).toBe('wxid_abc');
    expect(result.text).toBe('Hello');
  });

  it('does not match if content starts with Chinese characters (no prefix)', () => {
    const result = parseTextMessage('你好世界');
    expect(result.senderWxid).toBe('');
    expect(result.text).toBe('你好世界');
  });
});
