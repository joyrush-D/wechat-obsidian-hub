import type { RawMessage, MessageCategory } from '../types';
import { parseTextMessage } from './text-parser';
import { parseAppMessage } from './app-parser';
import { parseImageMessage, parseVoiceMessage, parseVideoMessage, parseEmojiMessage } from './media-parser';
import { parseSystemMessage, parseRevokedMessage } from './system-parser';
import { decompressContent } from './decompressor';

export interface ParseResult {
  type: MessageCategory;
  text: string;
  senderWxid: string;
  extra: Record<string, string>;
}

export function parseMessage(raw: RawMessage): ParseResult {
  const baseType = raw.local_type & 0xFFFF;
  const content = typeof raw.message_content === 'string' ? raw.message_content : null;
  let senderWxid = raw.real_sender_id || '';

  switch (baseType) {
    case 1: {
      const parsed = parseTextMessage(content);
      if (parsed.senderWxid) senderWxid = parsed.senderWxid;
      return { type: 'text', text: parsed.text, senderWxid, extra: {} };
    }
    case 3: {
      const parsed = parseImageMessage(content, raw.packed_info_data);
      return { ...parsed, senderWxid };
    }
    case 34: {
      const parsed = parseVoiceMessage(content);
      return { ...parsed, senderWxid };
    }
    case 43: {
      const parsed = parseVideoMessage(content);
      return { ...parsed, senderWxid };
    }
    case 47: {
      const parsed = parseEmojiMessage(content);
      return { ...parsed, senderWxid };
    }
    case 49: {
      let xml: string | null = null;
      if (raw.compress_content) xml = decompressContent(raw.compress_content);
      if (!xml && content) xml = content;
      const parsed = parseAppMessage(xml);
      return { ...parsed, senderWxid };
    }
    case 10000: {
      const parsed = parseSystemMessage(content);
      return { ...parsed, type: 'system' as MessageCategory, senderWxid };
    }
    case 10002: {
      const parsed = parseRevokedMessage(content);
      return { type: 'system', text: parsed.text, senderWxid, extra: { revoker: parsed.revokerWxid, revoked_msg_id: parsed.revokedMsgId } };
    }
    default:
      return { type: 'other', text: content ? content.slice(0, 100) : `[type-${baseType}]`, senderWxid, extra: {} };
  }
}
