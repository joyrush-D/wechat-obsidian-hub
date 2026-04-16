import { describe, it, expect, beforeAll } from 'vitest';
import { DbConnector } from '../../src/db/connector';
import { ContactReader } from '../../src/db/contact-reader';
import type { Database } from 'sql.js';

let db: Database;

beforeAll(async () => {
  const connector = new DbConnector();
  await connector.init();
  db = connector.createMemoryDb();
  db.run(`CREATE TABLE contact (
    username TEXT,
    nick_name TEXT,
    remark TEXT
  )`);
  db.run("INSERT INTO contact VALUES ('wxid_abc123', 'Alice', 'My Alice')");
  db.run("INSERT INTO contact VALUES ('wxid_def456', 'Bob', '')");
  db.run("INSERT INTO contact VALUES ('group123@chatroom', 'Dev Team', '')");
  db.run("INSERT INTO contact VALUES (NULL, 'Ghost', '')");
});

describe('ContactReader', () => {
  it('loads contacts from the DB (excluding NULL username)', () => {
    const reader = new ContactReader(db);
    expect(reader.count()).toBe(3);
  });

  it('getAllContacts returns all loaded contacts', () => {
    const reader = new ContactReader(db);
    const all = reader.getAllContacts();
    expect(all).toHaveLength(3);
    const usernames = all.map(c => c.username);
    expect(usernames).toContain('wxid_abc123');
    expect(usernames).toContain('wxid_def456');
    expect(usernames).toContain('group123@chatroom');
  });

  it('getContact returns the correct contact', () => {
    const reader = new ContactReader(db);
    const c = reader.getContact('wxid_abc123');
    expect(c).toBeDefined();
    expect(c!.nickName).toBe('Alice');
    expect(c!.remark).toBe('My Alice');
  });

  it('getContact returns undefined for unknown username', () => {
    const reader = new ContactReader(db);
    expect(reader.getContact('unknown_wxid')).toBeUndefined();
  });

  it('getDisplayName prefers remark over nickName', () => {
    const reader = new ContactReader(db);
    expect(reader.getDisplayName('wxid_abc123')).toBe('My Alice');
  });

  it('getDisplayName falls back to nickName when remark is empty', () => {
    const reader = new ContactReader(db);
    expect(reader.getDisplayName('wxid_def456')).toBe('Bob');
  });

  it('getDisplayName falls back to username when both are empty', () => {
    const connectorTmp = new DbConnector();
    // Use the existing db but create a contact with empty nickName and remark
    const reader = new ContactReader(db);
    // wxid_def456 has Bob as nickName, test a scenario with empty nickName
    // Insert an extra contact for this case
    db.run("INSERT INTO contact VALUES ('wxid_noname', '', '')");
    const reader2 = new ContactReader(db);
    expect(reader2.getDisplayName('wxid_noname')).toBe('wxid_noname');
  });

  it('getDisplayName returns username for unknown contact', () => {
    const reader = new ContactReader(db);
    expect(reader.getDisplayName('unknown_person')).toBe('unknown_person');
  });

  it('detects group contacts via @chatroom suffix', () => {
    const reader = new ContactReader(db);
    const group = reader.getContact('group123@chatroom');
    expect(group!.isGroup).toBe(true);
  });

  it('marks non-group contacts as not group', () => {
    const reader = new ContactReader(db);
    const c = reader.getContact('wxid_abc123');
    expect(c!.isGroup).toBe(false);
  });
});
