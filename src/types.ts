export interface OWHSettings {
  decryptedDbDir: string;
  wechatDataDir: string;
  decryptKeyHex: string;           // 64-char hex SQLCipher key (manually provided)
  decryptMode: 'manual' | 'auto';  // manual = user triggers, auto = on briefing
  aiEndpoint: string;
  aiModel: string;
  briefingFolder: string;
  briefingTimeRangeHours: number;
  autoGenerate: boolean;
  maxMessagesPerConversation: number;
  skipEmoji: boolean;
  skipSystemMessages: boolean;
}

export const DEFAULT_SETTINGS: OWHSettings = {
  decryptedDbDir: '',
  wechatDataDir: '',
  decryptKeyHex: '',
  decryptMode: 'manual',
  aiEndpoint: 'http://localhost:1234/v1',
  aiModel: '',
  briefingFolder: 'WeChat-Briefings',
  briefingTimeRangeHours: 24,
  autoGenerate: false,
  maxMessagesPerConversation: 500,
  skipEmoji: true,
  skipSystemMessages: true,
};

export interface Contact {
  username: string;
  nickName: string;
  remark: string;
  isGroup: boolean;
}

export interface ParsedMessage {
  localId: number;
  time: Date;
  conversationId: string;
  conversationName: string;
  sender: string;
  senderWxid: string;
  text: string;
  type: MessageCategory;
  extra: Record<string, string>;
}

export type MessageCategory =
  | 'text'
  | 'image'
  | 'voice'
  | 'video'
  | 'emoji'
  | 'link'
  | 'file'
  | 'miniapp'
  | 'quote'
  | 'forward'
  | 'announcement'
  | 'system'
  | 'other';

export interface RawMessage {
  local_id: number;
  local_type: number;
  create_time: number;
  real_sender_id: number | string;  // integer on Mac (Name2Id rowid), wxid string on Windows
  message_content: string | Uint8Array | null;
  compress_content: Uint8Array | null;
  packed_info_data: Uint8Array | null;
  wcdb_ct_message_content?: number;  // WCDB compression type: 0=none, 4=zstd
}
