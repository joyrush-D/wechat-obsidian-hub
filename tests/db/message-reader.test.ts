import { describe, it, expect, beforeAll } from 'vitest';
import { DbConnector } from '../../src/db/connector';
import { MessageReader } from '../../src/db/message-reader';
import type { Database } from 'sql.js';

let db: Database;
const TABLE = 'Msg_abc123';

beforeAll(async () => {
  const connector = new DbConnector();
  await connector.init();
  db = connector.createMemoryDb();

  db.run(`CREATE TABLE [${TABLE}] (
    local_id INTEGER PRIMARY KEY,
    local_type INTEGER,
    create_time INTEGER,
    real_sender_id TEXT,
    message_content TEXT,
    compress_content BLOB,
    packed_info_data BLOB
  )`);

  // Timestamps: Jan 1 2024 00:00:00 UTC = 1704067200
  db.run(`INSERT INTO [${TABLE}] VALUES (1, 1, 1704067200, 'wxid_alice', 'Hello', NULL, NULL)`);
  db.run(`INSERT INTO [${TABLE}] VALUES (2, 1, 1704067260, 'wxid_bob',   'Hi',    NULL, NULL)`);
  db.run(`INSERT INTO [${TABLE}] VALUES (3, 1, 1704067320, 'wxid_alice', 'Bye',   NULL, NULL)`);

  // Also create a second Msg table to test listing
  db.run('CREATE TABLE [Msg_xyz789] (local_id INTEGER)');
  // And a non-Msg table that should not appear
  db.run('CREATE TABLE other_table (id INTEGER)');
});

describe('MessageReader', () => {
  it('getConversationTables returns only Msg_ prefixed tables', () => {
    const reader = new MessageReader(db);
    const tables = reader.getConversationTables();
    expect(tables).toContain(TABLE);
    expect(tables).toContain('Msg_xyz789');
    expect(tables).not.toContain('other_table');
  });

  it('getMessages returns all messages ordered by create_time', () => {
    const reader = new MessageReader(db);
    const msgs = reader.getMessages(TABLE);
    expect(msgs).toHaveLength(3);
    expect(msgs[0].local_id).toBe(1);
    expect(msgs[1].local_id).toBe(2);
    expect(msgs[2].local_id).toBe(3);
  });

  it('getMessages maps fields correctly', () => {
    const reader = new MessageReader(db);
    const msgs = reader.getMessages(TABLE);
    expect(msgs[0].local_type).toBe(1);
    expect(msgs[0].create_time).toBe(1704067200);
    expect(msgs[0].real_sender_id).toBe('wxid_alice');
    expect(msgs[0].message_content).toBe('Hello');
    expect(msgs[0].compress_content).toBeNull();
    expect(msgs[0].packed_info_data).toBeNull();
  });

  it('getMessages filters by since date', () => {
    const reader = new MessageReader(db);
    // since = 1704067260 (second message timestamp)
    const since = new Date(1704067260 * 1000);
    const msgs = reader.getMessages(TABLE, since);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].local_id).toBe(2);
    expect(msgs[1].local_id).toBe(3);
  });

  it('getMessages respects limit', () => {
    const reader = new MessageReader(db);
    const msgs = reader.getMessages(TABLE, undefined, 2);
    expect(msgs).toHaveLength(2);
  });

  it('getMessages with since and limit combined', () => {
    const reader = new MessageReader(db);
    const since = new Date(1704067200 * 1000);
    const msgs = reader.getMessages(TABLE, since, 1);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].local_id).toBe(1);
  });

  it('getMessageCount returns correct count', () => {
    const reader = new MessageReader(db);
    expect(reader.getMessageCount(TABLE)).toBe(3);
  });

  it('getMessageCount returns 0 for empty table', () => {
    db.run('CREATE TABLE [Msg_empty] (local_id INTEGER)');
    const reader = new MessageReader(db);
    expect(reader.getMessageCount('Msg_empty')).toBe(0);
  });
});
