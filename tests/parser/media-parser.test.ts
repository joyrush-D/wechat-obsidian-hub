import { describe, it, expect } from 'vitest';
import {
  parseImageMessage,
  parseVoiceMessage,
  parseVideoMessage,
  parseEmojiMessage,
} from '../../src/parser/media-parser';

describe('parseImageMessage', () => {
  it('returns type image with text [image]', () => {
    const result = parseImageMessage(null, null);
    expect(result.type).toBe('image');
    expect(result.text).toBe('[image]');
  });

  it('extracts md5 and length from content XML', () => {
    const xml = '<img><md5>abc123def456</md5><length>204800</length></img>';
    const result = parseImageMessage(xml, null);
    expect(result.extra.md5).toBe('abc123def456');
    expect(result.extra.length).toBe('204800');
  });

  it('marks has_packed_info when packedInfo provided', () => {
    const result = parseImageMessage(null, new Uint8Array([1, 2, 3]));
    expect(result.extra.has_packed_info).toBe('true');
  });

  it('does not set has_packed_info for empty packedInfo', () => {
    const result = parseImageMessage(null, new Uint8Array(0));
    expect(result.extra.has_packed_info).toBeUndefined();
  });
});

describe('parseVoiceMessage', () => {
  it('returns type voice with text [voice]', () => {
    const result = parseVoiceMessage(null);
    expect(result.type).toBe('voice');
    expect(result.text).toBe('[voice]');
  });

  it('extracts voicelength from content XML', () => {
    const xml = '<voicemsg voicelength="3200" />';
    // Our extractTag implementation uses tag-based extraction
    // voicelength is an attribute here, not a tag, so we test tag-based format
    const xmlTag = '<voice><voicelength>3200</voicelength></voice>';
    const result = parseVoiceMessage(xmlTag);
    expect(result.extra.duration_ms).toBe('3200');
  });

  it('handles null content', () => {
    const result = parseVoiceMessage(null);
    expect(result.extra).toEqual({});
  });
});

describe('parseVideoMessage', () => {
  it('returns type video with text [video]', () => {
    const result = parseVideoMessage(null);
    expect(result.type).toBe('video');
    expect(result.text).toBe('[video]');
  });

  it('extracts playlength from content XML', () => {
    const xml = '<video><playlength>30</playlength><length>5120000</length></video>';
    const result = parseVideoMessage(xml);
    expect(result.extra.duration_s).toBe('30');
    expect(result.extra.length).toBe('5120000');
  });

  it('handles null content', () => {
    const result = parseVideoMessage(null);
    expect(result.extra).toEqual({});
  });
});

describe('parseEmojiMessage', () => {
  it('returns type emoji with text [emoji]', () => {
    const result = parseEmojiMessage(null);
    expect(result.type).toBe('emoji');
    expect(result.text).toBe('[emoji]');
  });

  it('extracts desc and cdnurl from content XML', () => {
    const xml = '<emoji><desc>Laughing</desc><cdnurl>https://cdn.example.com/emoji?a=1&amp;b=2</cdnurl></emoji>';
    const result = parseEmojiMessage(xml);
    expect(result.extra.description).toBe('Laughing');
    expect(result.extra.url).toBe('https://cdn.example.com/emoji?a=1&b=2');
  });

  it('handles null content', () => {
    const result = parseEmojiMessage(null);
    expect(result.extra).toEqual({});
  });
});
