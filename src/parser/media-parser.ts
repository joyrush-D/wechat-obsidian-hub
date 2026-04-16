import type { MessageCategory } from '../types';

export interface MediaParseResult {
  type: MessageCategory;
  text: string;
  extra: Record<string, string>;
}

function extractTag(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return match ? match[1] : '';
}

export function parseImageMessage(content: string | null, packedInfo: Uint8Array | null): MediaParseResult {
  const extra: Record<string, string> = {};
  if (content) {
    const md5 = extractTag(content, 'md5');
    if (md5) extra.md5 = md5;
    const length = extractTag(content, 'length');
    if (length) extra.length = length;
  }
  if (packedInfo && packedInfo.length > 0) {
    extra.has_packed_info = 'true';
  }
  return { type: 'image', text: '[image]', extra };
}

export function parseVoiceMessage(content: string | null): MediaParseResult {
  const extra: Record<string, string> = {};
  if (content) {
    const length = extractTag(content, 'length');
    if (length) extra.duration_ms = length;
    const voiceLength = extractTag(content, 'voicelength');
    if (voiceLength) extra.duration_ms = voiceLength;
  }
  return { type: 'voice', text: '[voice]', extra };
}

export function parseVideoMessage(content: string | null): MediaParseResult {
  const extra: Record<string, string> = {};
  if (content) {
    const length = extractTag(content, 'length');
    if (length) extra.length = length;
    const playLength = extractTag(content, 'playlength');
    if (playLength) extra.duration_s = playLength;
  }
  return { type: 'video', text: '[video]', extra };
}

export function parseEmojiMessage(content: string | null): MediaParseResult {
  const extra: Record<string, string> = {};
  if (content) {
    const desc = extractTag(content, 'desc');
    if (desc) extra.description = desc;
    const cdnUrl = extractTag(content, 'cdnurl');
    if (cdnUrl) extra.url = cdnUrl.replace(/&amp;/g, '&');
  }
  return { type: 'emoji', text: '[emoji]', extra };
}
