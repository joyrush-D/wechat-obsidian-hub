import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';

export class DbConnector {
  private SQL: SqlJsStatic | null = null;

  async init(): Promise<void> {
    if (!this.SQL) {
      this.SQL = await initSqlJs();
    }
  }

  isReady(): boolean {
    return this.SQL !== null;
  }

  createMemoryDb(): Database {
    if (!this.SQL) throw new Error('DbConnector not initialized. Call init() first.');
    return new this.SQL.Database();
  }

  loadFromBytes(data: Uint8Array): Database {
    if (!this.SQL) throw new Error('DbConnector not initialized. Call init() first.');
    return new this.SQL.Database(data);
  }

  async loadFromFile(filePath: string, readFile: (path: string) => Promise<ArrayBuffer>): Promise<Database> {
    if (!this.SQL) throw new Error('DbConnector not initialized. Call init() first.');
    const buffer = await readFile(filePath);
    return new this.SQL.Database(new Uint8Array(buffer));
  }
}
