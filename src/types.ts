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

  // v0.3.0 — Multimodal: voice transcription (whisper.cpp)
  enableVoiceTranscription: boolean;
  whisperEndpoint: string;
  whisperLanguage: string;

  // v0.3.0 — Multimodal: image analysis (OCR + VLM)
  enableImageOcr: boolean;
  enableImageVlm: boolean;
  ocrEndpoint: string;
  ocrLanguage: string;
  vlmEndpoint: string;             // empty = reuse aiEndpoint
  vlmModel: string;

  // Shared media cache
  mediaCacheDir: string;           // ~/.wechat-hub/media-cache by default

  // WeChat media root (for voice/image file resolution)
  wechatMediaRoot: string;         // auto-detected from wechatDataDir if empty

  // v0.8.1 — Devil's Advocate (multi-agent adversarial reasoning)
  enableDevilsAdvocate: boolean;   // default off (extra LLM call per finding)
  devilsAdvocateTopN: number;      // how many top findings get a DA pass
}

export const DEFAULT_SETTINGS: OWHSettings = {
  decryptedDbDir: '',
  wechatDataDir: '',
  decryptKeyHex: '',
  decryptMode: 'manual',
  aiEndpoint: 'http://localhost:1234/v1',
  aiModel: '',  // empty = use whichever model is currently loaded in LM Studio
  briefingFolder: 'WeChat-Briefings',
  briefingTimeRangeHours: 24,
  autoGenerate: false,
  maxMessagesPerConversation: 500,
  skipEmoji: true,
  skipSystemMessages: true,

  enableVoiceTranscription: false,
  whisperEndpoint: 'http://localhost:8081',
  whisperLanguage: 'zh',

  enableImageOcr: false,
  enableImageVlm: false,
  ocrEndpoint: 'http://localhost:8090',
  ocrLanguage: 'ch',
  vlmEndpoint: '',                 // empty = reuse aiEndpoint
  vlmModel: '',

  mediaCacheDir: '',               // empty = default to ~/.wechat-hub/media-cache
  wechatMediaRoot: '',

  enableDevilsAdvocate: false,
  devilsAdvocateTopN: 3,
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
