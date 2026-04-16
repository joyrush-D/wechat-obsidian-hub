import { describe, it, expect, beforeAll } from 'vitest';
import { DbConnector } from '../../src/db/connector';

describe('DbConnector', () => {
  let connector: DbConnector;

  beforeAll(async () => {
    connector = new DbConnector();
    await connector.init();
  });

  it('should not be ready before init', async () => {
    const fresh = new DbConnector();
    expect(fresh.isReady()).toBe(false);
  });

  it('should be ready after init', () => {
    expect(connector.isReady()).toBe(true);
  });

  it('init is idempotent (calling twice does not throw)', async () => {
    await expect(connector.init()).resolves.toBeUndefined();
    expect(connector.isReady()).toBe(true);
  });

  it('should throw if createMemoryDb called before init', () => {
    const fresh = new DbConnector();
    expect(() => fresh.createMemoryDb()).toThrow('DbConnector not initialized');
  });

  it('should throw if loadFromBytes called before init', () => {
    const fresh = new DbConnector();
    expect(() => fresh.loadFromBytes(new Uint8Array())).toThrow('DbConnector not initialized');
  });

  it('should create an in-memory DB and perform insert/query', () => {
    const db = connector.createMemoryDb();
    db.run('CREATE TABLE test (id INTEGER, val TEXT)');
    db.run("INSERT INTO test VALUES (1, 'hello')");
    db.run("INSERT INTO test VALUES (2, 'world')");
    const result = db.exec('SELECT * FROM test ORDER BY id');
    expect(result).toHaveLength(1);
    expect(result[0].values).toEqual([[1, 'hello'], [2, 'world']]);
    db.close();
  });

  it('should load a DB from bytes (roundtrip)', () => {
    const db1 = connector.createMemoryDb();
    db1.run('CREATE TABLE items (name TEXT)');
    db1.run("INSERT INTO items VALUES ('alpha')");
    const bytes = db1.export();
    db1.close();

    const db2 = connector.loadFromBytes(bytes);
    const result = db2.exec('SELECT name FROM items');
    expect(result[0].values[0][0]).toBe('alpha');
    db2.close();
  });

  it('loadFromFile uses the provided readFile function', async () => {
    // Create a real DB and export its bytes, then simulate readFile
    const db1 = connector.createMemoryDb();
    db1.run('CREATE TABLE t (v INTEGER)');
    db1.run('INSERT INTO t VALUES (42)');
    const bytes = db1.export();
    db1.close();

    const mockReadFile = async (_path: string): Promise<ArrayBuffer> => {
      return bytes.buffer as ArrayBuffer;
    };

    const db2 = await connector.loadFromFile('/fake/path.db', mockReadFile);
    const result = db2.exec('SELECT v FROM t');
    expect(result[0].values[0][0]).toBe(42);
    db2.close();
  });
});
