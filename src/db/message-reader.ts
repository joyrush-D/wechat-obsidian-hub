import type { Database } from 'sql.js';
import type { RawMessage } from '../types';

export class MessageReader {
  constructor(private db: Database) {}

  getConversationTables(): string[] {
    const results = this.db.exec(
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'Msg_%'"
    );
    if (results.length === 0) return [];
    return results[0].values.map(row => row[0] as string);
  }

  getMessages(tableName: string, since?: Date, limit?: number): RawMessage[] {
    let query = `SELECT local_id, local_type, create_time, real_sender_id,
                        message_content, compress_content, packed_info_data
                 FROM [${tableName}]`;
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
        real_sender_id: (row[3] as string) || '',
        message_content: row[4] as string | null,
        compress_content: row[5] as Uint8Array | null,
        packed_info_data: row[6] as Uint8Array | null,
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
