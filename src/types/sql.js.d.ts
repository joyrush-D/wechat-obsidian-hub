declare module 'sql.js' {
  export interface Database {
    exec(sql: string, params?: any[]): QueryResults[];
    prepare(sql: string): Statement;
    close(): void;
    run(sql: string): void;
    export(): Uint8Array;
  }
  export interface QueryResults {
    columns: string[];
    values: any[][];
  }
  export interface Statement {
    bind(params?: any[]): boolean;
    step(): boolean;
    get(): any[];
    getAsObject(params?: any[]): Record<string, any>;
    free(): boolean;
  }
  export interface SqlJsStatic {
    Database: new (data?: Uint8Array | ArrayLike<number>) => Database;
  }
  export interface SqlJsConfig {
    locateFile?: (file: string) => string;
    wasmBinary?: ArrayBuffer | Uint8Array;
  }
  export default function initSqlJs(config?: SqlJsConfig): Promise<SqlJsStatic>;
}
