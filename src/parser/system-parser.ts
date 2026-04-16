export interface SystemParseResult {
  text: string;
  extra: Record<string, string>;
}

export interface RevokeParseResult {
  revokerWxid: string;
  revokedMsgId: string;
  text: string;
}

export function parseSystemMessage(content: string | null): SystemParseResult {
  if (!content) return { text: '[system]', extra: {} };
  // Strip XML/HTML tags
  const text = content.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  return { text: text || '[system]', extra: {} };
}

export function parseRevokedMessage(content: string | null): RevokeParseResult {
  if (!content) return { revokerWxid: '', revokedMsgId: '', text: '[revoked]' };

  let revokerWxid = '';
  let revokedMsgId = '';

  // Try to extract revoker from <revoker> or <replacemsg>
  const revokerMatch = content.match(/<revoker>([^<]*)<\/revoker>/);
  if (revokerMatch) revokerWxid = revokerMatch[1];

  // Try to extract revoked message id
  const msgIdMatch = content.match(/<msgid>([^<]*)<\/msgid>/);
  if (msgIdMatch) revokedMsgId = msgIdMatch[1];
  const newMsgIdMatch = content.match(/<newmsgid>([^<]*)<\/newmsgid>/);
  if (newMsgIdMatch) revokedMsgId = newMsgIdMatch[1];

  // Extract human-readable text by stripping XML
  const text = content.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() || '[revoked]';

  return { revokerWxid, revokedMsgId, text };
}
