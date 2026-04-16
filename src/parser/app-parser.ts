import type { MessageCategory } from '../types';

export interface AppParseResult {
  type: MessageCategory;
  text: string;
  extra: Record<string, string>;
}

function extractTag(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return match ? match[1] : '';
}

export function parseAppMessage(xml: string | null): AppParseResult {
  const result: AppParseResult = { type: 'other', text: '[app]', extra: {} };
  if (!xml) return result;

  const typeMatch = xml.match(/<type>(\d+)<\/type>/);
  const subType = typeMatch ? parseInt(typeMatch[1], 10) : 0;
  const title = extractTag(xml, 'title');
  const des = extractTag(xml, 'des');
  const rawUrl = extractTag(xml, 'url');
  const url = rawUrl.replace(/&amp;/g, '&');
  const source = extractTag(xml, 'sourcedisplayname');

  result.extra.sub_type = String(subType);

  switch (subType) {
    case 5: // Link
      result.type = 'link';
      result.text = `[link] ${title}`;
      if (des) result.extra.description = des;
      if (url) result.extra.url = url;
      if (source) result.extra.source = source;
      break;
    case 6: { // File
      result.type = 'file';
      result.text = `[file] ${title || 'unknown file'}`;
      const sizeMatch = xml.match(/<totallen>(\d+)<\/totallen>/);
      if (sizeMatch) {
        const sizeKb = parseInt(sizeMatch[1], 10) / 1024;
        result.extra.file_size = sizeKb < 1024 ? `${sizeKb.toFixed(1)} KB` : `${(sizeKb / 1024).toFixed(1)} MB`;
      }
      break;
    }
    case 33: case 36: // Mini-program
      result.type = 'miniapp';
      result.text = `[miniapp] ${source || title}`;
      if (url) result.extra.url = url;
      break;
    case 57: { // Quote/Reply
      result.type = 'quote';
      result.text = `[reply] ${title}`;
      const referMatch = xml.match(/<refermsg>([\s\S]*?)<\/refermsg>/);
      if (referMatch) {
        const refXml = referMatch[1];
        const refTitle = extractTag(refXml, 'title');
        const refName = extractTag(refXml, 'displayname');
        if (refName) result.extra.reply_to = refName;
        if (refTitle) result.extra.reply_content = refTitle.slice(0, 50);
      }
      break;
    }
    case 19: // Merged forward
      result.type = 'forward';
      result.text = `[chat-history] ${title}`;
      break;
    case 87: // Group announcement
      result.type = 'announcement';
      result.text = `[announcement] ${title}`;
      break;
    case 4: case 51: case 63: case 88: // Video channel
      result.type = 'other';
      result.text = `[video-channel] ${title}`;
      if (url) result.extra.url = url;
      break;
    default:
      result.type = 'other';
      result.text = title ? `[app-${subType}] ${title}` : '[app]';
      if (url) result.extra.url = url;
  }
  return result;
}
