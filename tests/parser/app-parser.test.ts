import { describe, it, expect } from 'vitest';
import { parseAppMessage } from '../../src/parser/app-parser';

describe('parseAppMessage', () => {
  it('returns default other for null input', () => {
    const result = parseAppMessage(null);
    expect(result.type).toBe('other');
    expect(result.text).toBe('[app]');
  });

  it('returns default other for empty string', () => {
    const result = parseAppMessage('');
    expect(result.type).toBe('other');
    expect(result.text).toBe('[app]');
  });

  it('parses link message (sub-type 5)', () => {
    const xml = `<appmsg><type>5</type><title>Cool Article</title><des>A great read</des><url>https://example.com/article</url><sourcedisplayname>Example Site</sourcedisplayname></appmsg>`;
    const result = parseAppMessage(xml);
    expect(result.type).toBe('link');
    expect(result.text).toBe('[link] Cool Article');
    expect(result.extra.description).toBe('A great read');
    expect(result.extra.url).toBe('https://example.com/article');
    expect(result.extra.source).toBe('Example Site');
    expect(result.extra.sub_type).toBe('5');
  });

  it('parses file message (sub-type 6)', () => {
    const xml = `<appmsg><type>6</type><title>document.pdf</title><totallen>2048</totallen></appmsg>`;
    const result = parseAppMessage(xml);
    expect(result.type).toBe('file');
    expect(result.text).toBe('[file] document.pdf');
    expect(result.extra.file_size).toBe('2.0 KB');
  });

  it('parses large file size in MB', () => {
    const xml = `<appmsg><type>6</type><title>bigfile.zip</title><totallen>${2 * 1024 * 1024}</totallen></appmsg>`;
    const result = parseAppMessage(xml);
    expect(result.type).toBe('file');
    expect(result.extra.file_size).toBe('2.0 MB');
  });

  it('parses file with no title as unknown file', () => {
    const xml = `<appmsg><type>6</type><totallen>512</totallen></appmsg>`;
    const result = parseAppMessage(xml);
    expect(result.text).toBe('[file] unknown file');
  });

  it('parses mini-program message (sub-type 33)', () => {
    const xml = `<appmsg><type>33</type><title>My App</title><sourcedisplayname>SuperApp</sourcedisplayname><url>https://mp.weixin.qq.com/app</url></appmsg>`;
    const result = parseAppMessage(xml);
    expect(result.type).toBe('miniapp');
    expect(result.text).toBe('[miniapp] SuperApp');
    expect(result.extra.url).toBe('https://mp.weixin.qq.com/app');
  });

  it('parses mini-program sub-type 36', () => {
    const xml = `<appmsg><type>36</type><title>Another App</title><sourcedisplayname></sourcedisplayname></appmsg>`;
    const result = parseAppMessage(xml);
    expect(result.type).toBe('miniapp');
    expect(result.text).toBe('[miniapp] Another App');
  });

  it('parses quote/reply message (sub-type 57)', () => {
    const xml = `<appmsg><type>57</type><title>Sure, sounds good</title><refermsg><displayname>Alice</displayname><title>Can we meet tomorrow?</title></refermsg></appmsg>`;
    const result = parseAppMessage(xml);
    expect(result.type).toBe('quote');
    expect(result.text).toBe('[reply] Sure, sounds good');
    expect(result.extra.reply_to).toBe('Alice');
    expect(result.extra.reply_content).toBe('Can we meet tomorrow?');
  });

  it('parses forward/merged chat history (sub-type 19)', () => {
    const xml = `<appmsg><type>19</type><title>Chat History</title></appmsg>`;
    const result = parseAppMessage(xml);
    expect(result.type).toBe('forward');
    expect(result.text).toBe('[chat-history] Chat History');
  });

  it('parses group announcement (sub-type 87)', () => {
    const xml = `<appmsg><type>87</type><title>Please read the group rules</title></appmsg>`;
    const result = parseAppMessage(xml);
    expect(result.type).toBe('announcement');
    expect(result.text).toBe('[announcement] Please read the group rules');
  });

  it('parses video channel (sub-type 4)', () => {
    const xml = `<appmsg><type>4</type><title>Funny Video</title><url>https://channels.weixin.qq.com/v/123</url></appmsg>`;
    const result = parseAppMessage(xml);
    expect(result.type).toBe('other');
    expect(result.text).toBe('[video-channel] Funny Video');
  });

  it('handles &amp; in URL', () => {
    const xml = `<appmsg><type>5</type><title>Test</title><url>https://example.com/?a=1&amp;b=2</url></appmsg>`;
    const result = parseAppMessage(xml);
    expect(result.extra.url).toBe('https://example.com/?a=1&b=2');
  });

  it('handles unknown sub-type with title', () => {
    const xml = `<appmsg><type>99</type><title>Some Unknown App</title></appmsg>`;
    const result = parseAppMessage(xml);
    expect(result.type).toBe('other');
    expect(result.text).toBe('[app-99] Some Unknown App');
  });

  it('handles unknown sub-type without title', () => {
    const xml = `<appmsg><type>99</type></appmsg>`;
    const result = parseAppMessage(xml);
    expect(result.text).toBe('[app]');
  });
});
