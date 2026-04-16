import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { join, dirname } from 'path';
import { existsSync } from 'fs';

export class DbConnector {
  private SQL: SqlJsStatic | null = null;
  private pluginDir: string = '';

  setPluginDir(dir: string): void {
    this.pluginDir = dir;
  }

  async init(): Promise<void> {
    if (this.SQL) return;

    // Check if WASM file exists in the plugin directory (Obsidian environment)
    const wasmPath = this.pluginDir ? join(this.pluginDir, 'sql-wasm.wasm') : '';
    const hasWasm = wasmPath && existsSync(wasmPath);

    if (hasWasm) {
      // Obsidian environment: use the WASM file from plugin directory
      this.SQL = await initSqlJs({
        locateFile: () => wasmPath,
      });
    } else {
      // Node.js / test environment: let sql.js find its own WASM
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
