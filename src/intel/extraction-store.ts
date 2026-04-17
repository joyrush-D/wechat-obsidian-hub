/**
 * Extraction Store — persistent cache of per-conversation extractions.
 *
 * Why: re-running briefings repeatedly should NOT re-call LLM for conversations
 * we've already analyzed today. Persist extractions to ~/.wechat-hub/extractions/YYYY-MM-DD.json.
 *
 * Each entry is keyed by `${conversationName}:${msgCount}:${lastMsgTimestamp}` so that
 * re-extraction only happens when new messages arrive in that conversation.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

export interface ExtractionEntry {
  conversationName: string;
  conversationId: string;
  msgCount: number;
  lastMsgTimestamp: number;  // epoch seconds
  cacheKey: string;          // hash of identity for cheap comparison
  extracted: string;          // structured Markdown
  extractedAt: string;        // ISO datetime
}

export interface DailyExtractions {
  date: string;
  entries: ExtractionEntry[];
}

export class ExtractionStore {
  private storeDir: string;

  constructor(baseDir: string) {
    this.storeDir = join(baseDir, '.wechat-hub', 'extractions');
    mkdirSync(this.storeDir, { recursive: true });
  }

  private filePath(date: string): string {
    return join(this.storeDir, `${date}.json`);
  }

  /** Build a cache key from conversation identity + state. */
  static cacheKey(conversationName: string, msgCount: number, lastMsgTimestamp: number): string {
    return `${conversationName}|${msgCount}|${lastMsgTimestamp}`;
  }

  /** Load existing extractions for a date (empty if none). */
  load(date: string): DailyExtractions {
    const path = this.filePath(date);
    if (!existsSync(path)) return { date, entries: [] };
    try {
      const raw = readFileSync(path, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return { date, entries: [] };
    }
  }

  /** Save extractions for a date. */
  save(daily: DailyExtractions): void {
    writeFileSync(this.filePath(daily.date), JSON.stringify(daily, null, 2), 'utf-8');
  }

  /**
   * Look up cached extraction by cacheKey. Returns null if not found or stale.
   */
  lookup(date: string, cacheKey: string): ExtractionEntry | null {
    const daily = this.load(date);
    return daily.entries.find(e => e.cacheKey === cacheKey) || null;
  }

  /**
   * Add or update an extraction entry for a date.
   */
  upsert(date: string, entry: ExtractionEntry): void {
    const daily = this.load(date);
    const idx = daily.entries.findIndex(e => e.conversationName === entry.conversationName);
    if (idx >= 0) {
      daily.entries[idx] = entry;
    } else {
      daily.entries.push(entry);
    }
    this.save(daily);
  }

  /**
   * Bulk save (more efficient when many entries change).
   */
  saveAll(date: string, entries: ExtractionEntry[]): void {
    this.save({ date, entries });
  }

  /**
   * Load extractions across a date range (for weekly/monthly rollup).
   */
  loadRange(fromDate: string, toDate: string): DailyExtractions[] {
    const result: DailyExtractions[] = [];
    if (!existsSync(this.storeDir)) return result;

    for (const file of readdirSync(this.storeDir)) {
      if (!file.endsWith('.json')) continue;
      const date = file.slice(0, -5);  // strip .json
      if (date >= fromDate && date <= toDate) {
        result.push(this.load(date));
      }
    }
    return result.sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * List all stored dates (for debugging/UI).
   */
  listDates(): string[] {
    if (!existsSync(this.storeDir)) return [];
    return readdirSync(this.storeDir)
      .filter(f => f.endsWith('.json'))
      .map(f => f.slice(0, -5))
      .sort();
  }
}
