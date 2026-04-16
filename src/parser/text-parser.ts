const SENDER_PATTERN = /^([a-zA-Z0-9_-]+):\s*([\s\S]*)$/;

export interface TextParseResult {
  senderWxid: string;
  text: string;
}

export function parseTextMessage(content: string | null): TextParseResult {
  if (!content) return { senderWxid: '', text: '' };
  const match = content.match(SENDER_PATTERN);
  if (match) return { senderWxid: match[1], text: match[2].trim() };
  return { senderWxid: '', text: content };
}
