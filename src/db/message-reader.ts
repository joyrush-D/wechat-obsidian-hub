import type { Database } from 'sql.js';
import type { RawMessage } from '../types';

export class MessageReader {
  private name2id: Map<number, string> = new Map();

  constructor(private db: Database) {
    this.loadName2Id();
  }

  /**
   * Load Name2Id mapping table (Mac WeChat 4.x).
   * Maps integer rowid → wxid string.
   */
  private loadName2Id(): void {
    try {
      const results = this.db.exec('SELECT rowid, user_name FROM Name2Id');
      if (results.length > 0) {
        for (const row of results[0].values) {
          const rowid = row[0] as number;
          const name = row[1] as string;
          if (name) this.name2id.set(rowid, name);
        }
      }
    } catch {
      // Name2Id table may not exist (Windows format)
    }
  }

  /**
   * Resolve a sender ID to wxid string.
   * On Mac, real_sender_id is an integer referencing Name2Id.
   * On Windows, it's already a wxid string.
   */
  resolveSenderId(senderId: number | string): string {
    if (typeof senderId === 'number') {
      return this.name2id.get(senderId) || String(senderId);
    }
    return senderId || '';
  }

  getConversationTables(): string[] {
    const results = this.db.exec(
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'Msg_%'"
    );
    if (results.length === 0) return [];
    return results[0].values.map(row => row[0] as string);
  }

  /**
   * Check if a column exists in the table (for WCDB_CT_message_content).
   */
  private hasColumn(tableName: string, columnName: string): boolean {
    try {
      const results = this.db.exec(`PRAGMA table_info([${tableName}])`);
      if (results.length === 0) return false;
      return results[0].values.some(row => row[1] === columnName);
    } catch {
      return false;
    }
  }

  getMessages(tableName: string, since?: Date, limit?: number): RawMessage[] {
    const hasWcdbCt = this.hasColumn(tableName, 'WCDB_CT_message_content');

    const selectCols = [
      'local_id', 'local_type', 'create_time', 'real_sender_id',
      'message_content', 'compress_content', 'packed_info_data',
    ];
    if (hasWcdbCt) {
      selectCols.push('WCDB_CT_message_content');
    }

    let query = `SELECT ${selectCols.join(', ')} FROM [${tableName}]`;
    const params: (number | string)[] = [];
    if (since) {
      query += ' WHERE create_time >= ?';
      params.push(Math.floor(since.getTime() / 1000));
    }
    query += ' ORDER BY create_time ASC';
    if (limit) { query += ' LIMIT ?'; params.push(limit); }

    const stmt = this.db.prepare(query);
    stmt.bind(params);
    const messages: RawMessage[] = [];
    while (stmt.step()) {
      const row = stmt.get();
      messages.push({
        local_id: row[0] as number,
        local_type: row[1] as number,
        create_time: row[2] as number,
        real_sender_id: row[3] as number | string,
        message_content: row[4] as string | Uint8Array | null,
        compress_content: row[5] as Uint8Array | null,
        packed_info_data: row[6] as Uint8Array | null,
        wcdb_ct_message_content: hasWcdbCt ? (row[7] as number) : undefined,
      });
    }
    stmt.free();
    return messages;
  }

  getMessageCount(tableName: string): number {
    const result = this.db.exec(`SELECT count(*) FROM [${tableName}]`);
    if (result.length === 0) return 0;
    return result[0].values[0][0] as number;
  }
}
