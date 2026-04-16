export interface OWHSettings {
  decryptedDbDir: string;
  wechatDataDir: string;
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
  real_sender_id: string;
  message_content: string | Uint8Array | null;
  compress_content: Uint8Array | null;
  packed_info_data: Uint8Array | null;
}
