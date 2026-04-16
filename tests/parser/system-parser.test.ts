import { describe, it, expect } from 'vitest';
import { parseSystemMessage, parseRevokedMessage } from '../../src/parser/system-parser';

describe('parseSystemMessage', () => {
  it('returns [system] for null input', () => {
    const result = parseSystemMessage(null);
    expect(result.text).toBe('[system]');
    expect(result.extra).toEqual({});
  });

  it('returns [system] for empty string', () => {
    const result = parseSystemMessage('');
    expect(result.text).toBe('[system]');
  });

  it('strips XML tags from content', () => {
    const xml = '<sysmsg type="text"><content>Alice joined the group</content></sysmsg>';
    const result = parseSystemMessage(xml);
    expect(result.text).toBe('Alice joined the group');
    expect(result.text).not.toContain('<');
    expect(result.text).not.toContain('>');
  });

  it('strips multiple nested XML tags', () => {
    const xml = '<msg><a href="#">Link text</a> and <b>bold</b></msg>';
    const result = parseSystemMessage(xml);
    expect(result.text).toBe('Link text and bold');
  });

  it('handles plain text without XML tags', () => {
    const result = parseSystemMessage('Simple system message');
    expect(result.text).toBe('Simple system message');
  });

  it('collapses whitespace in result', () => {
    const xml = '<msg>  lots   of   spaces  </msg>';
    const result = parseSystemMessage(xml);
    expect(result.text).toBe('lots of spaces');
  });
});

describe('parseRevokedMessage', () => {
  it('returns empty strings and [revoked] for null input', () => {
    const result = parseRevokedMessage(null);
    expect(result.revokerWxid).toBe('');
    expect(result.revokedMsgId).toBe('');
    expect(result.text).toBe('[revoked]');
  });

  it('extracts revoker wxid', () => {
    const xml = '<sysmsg><revoker>wxid_alice</revoker><newmsgid>99887766</newmsgid></sysmsg>';
    const result = parseRevokedMessage(xml);
    expect(result.revokerWxid).toBe('wxid_alice');
  });

  it('extracts revoked message id via newmsgid', () => {
    const xml = '<sysmsg><revoker>wxid_bob</revoker><newmsgid>12345678</newmsgid></sysmsg>';
    const result = parseRevokedMessage(xml);
    expect(result.revokedMsgId).toBe('12345678');
  });

  it('extracts revoked message id via msgid', () => {
    const xml = '<sysmsg><revoker>wxid_charlie</revoker><msgid>9999</msgid></sysmsg>';
    const result = parseRevokedMessage(xml);
    expect(result.revokedMsgId).toBe('9999');
  });

  it('strips XML tags from text', () => {
    const xml = '<sysmsg><content>"Alice" recalled a message.</content></sysmsg>';
    const result = parseRevokedMessage(xml);
    expect(result.text).not.toContain('<');
    expect(result.text).toContain('recalled a message');
  });

  it('handles content with no XML structure', () => {
    const result = parseRevokedMessage('You recalled a message.');
    expect(result.text).toBe('You recalled a message.');
  });
});
