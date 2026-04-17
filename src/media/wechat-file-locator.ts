/**
 * WeChatFileLocator — resolve voice/image files on disk from message metadata.
 *
 * WeChat 4.x for Mac stores media under various subdirs of the xwechat_files
 * data directory. Layout observed in the wild (varies by WeChat version):
 *   <root>/msg_attach/voice/msg_<localId>.silk   # typical voice
 *   <root>/msg_attach/image/<md5>.jpg            # full-quality image
 *   <root>/msg_attach/image/<md5>.th.jpg         # thumbnail (skip)
 *   <root>/Image/<date>/msg_<localId>.png        # some variants
 *   <root>/Voice/<date>/msg_<localId>.silk
 *
 * Rather than hard-coding exact paths (which change across versions), we
 * **scan recursively** under a media root for files matching hints
 * (localId substring, md5, etc.). This is O(filesystem) which is OK because:
 *   - we only run it for voice/image messages (a few dozen per day)
 *   - results are cached by content hash downstream
 *   - users can tune the `wechatMediaRoot` setting to a narrow subdir
 *
 * Policy:
 *   - Empty root → return null (feature effectively disabled)
 *   - Missing root dir → return null (don't throw, fail soft)
 *   - Thumbnail (.th.) never returned — we want original quality
 *   - For voice, .wav > .silk > .amr (prefer pre-decoded if cached)
 *   - For image, original > thumbnail > null
 */

import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

export interface VoiceHints {
  localId?: number;
  md5?: string;
}

export interface ImageHints {
  localId?: number;
  md5?: string;
}

const VOICE_EXT_PRIORITY = ['.wav', '.silk', '.amr'];
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'];
const MAX_SCAN_DEPTH = 10;

export class WeChatFileLocator {
  constructor(private root: string) {}

  findVoice(hints: VoiceHints): string | null {
    if (!this.root || !existsSync(this.root)) return null;
    const needles = this.buildVoiceNeedles(hints);
    if (needles.length === 0) return null;
    const candidates = this.scan(this.root, (name, path) => {
      const lower = name.toLowerCase();
      if (!VOICE_EXT_PRIORITY.some(ext => lower.endsWith(ext))) return false;
      if (!this.isMediaPath(path)) return false;
      return needles.some(n => lower.includes(n));
    });
    if (candidates.length === 0) return null;
    return this.pickBestByExtension(candidates, VOICE_EXT_PRIORITY);
  }

  findImage(hints: ImageHints): string | null {
    if (!this.root || !existsSync(this.root)) return null;
    const needles = this.buildImageNeedles(hints);
    if (needles.length === 0) return null;
    const candidates = this.scan(this.root, (name, path) => {
      const lower = name.toLowerCase();
      if (!IMAGE_EXTS.some(ext => lower.endsWith(ext))) return false;
      if (!this.isMediaPath(path)) return false;
      // Skip thumbnail variants — we want full quality for OCR/VLM
      if (/\.th\.(jpe?g|png|webp)$/i.test(lower)) return false;
      return needles.some(n => lower.includes(n));
    });
    if (candidates.length === 0) return null;
    // Among surviving candidates, prefer one that does NOT look like a thumbnail
    return candidates[0];
  }

  private buildVoiceNeedles(h: VoiceHints): string[] {
    const out: string[] = [];
    if (typeof h.localId === 'number' && h.localId > 0) out.push(`msg_${h.localId}`.toLowerCase());
    if (typeof h.localId === 'number' && h.localId > 0) out.push(`_${h.localId}.`.toLowerCase());
    if (h.md5) out.push(h.md5.toLowerCase());
    return out;
  }

  private buildImageNeedles(h: ImageHints): string[] {
    const out: string[] = [];
    if (h.md5) out.push(h.md5.toLowerCase());
    if (typeof h.localId === 'number' && h.localId > 0) out.push(`msg_${h.localId}`.toLowerCase());
    return out;
  }

  private isMediaPath(fullPath: string): boolean {
    const lower = fullPath.toLowerCase();
    // Explicitly exclude DB and log directories
    if (lower.includes('/db_storage/')) return false;
    if (lower.includes('/logs/')) return false;
    // Accept anything that has 'voice', 'image', 'audio', 'media', 'msg_attach', 'attach'
    return /voice|image|audio|media|attach/.test(lower);
  }

  private scan(dir: string, matcher: (name: string, path: string) => boolean, depth = 0): string[] {
    if (depth > MAX_SCAN_DEPTH) return [];
    if (!existsSync(dir)) return [];
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return [];
    }
    const out: string[] = [];
    for (const entry of entries) {
      const full = join(dir, entry);
      let s;
      try { s = statSync(full); } catch { continue; }
      if (s.isDirectory()) {
        out.push(...this.scan(full, matcher, depth + 1));
      } else if (s.isFile()) {
        if (matcher(entry, full)) out.push(full);
      }
    }
    return out;
  }

  private pickBestByExtension(paths: string[], priority: string[]): string {
    for (const ext of priority) {
      const match = paths.find(p => p.toLowerCase().endsWith(ext));
      if (match) return match;
    }
    return paths[0];
  }
}
