/**
 * HostAdapter — abstracts the runtime environment so agent-core can run in
 * Obsidian, a CLI, a web app, or a VS Code extension without code changes.
 *
 * Methods map to the minimal surface the agent needs: read/write files,
 * show messages to the user, and open UI.
 */

export interface HostAdapter {
  /** Read a file (as UTF-8 text) from the host filesystem or vault. */
  readFile(path: string): Promise<string>;

  /** Write text to a file, creating it if needed. */
  writeFile(path: string, content: string): Promise<void>;

  /** Check whether a file exists. */
  fileExists(path: string): Promise<boolean>;

  /** Show a transient notification to the user. */
  showNotice(message: string, durationMs?: number): void;

  /** Show a modal with a message and wait for the user to acknowledge. */
  showModal?(title: string, body: string): Promise<void>;

  /** Open / focus a file in the host's main view. Optional (CLI may no-op). */
  openFile?(path: string): Promise<void>;

  /** Return the base directory for user data (vault root, cwd, etc.). */
  getBaseDir(): string;
}

/**
 * In-memory reference implementation, useful for tests and CLI tools.
 */
export class InMemoryHostAdapter implements HostAdapter {
  private files: Map<string, string> = new Map();
  public notices: Array<{ message: string; durationMs?: number }> = [];
  private baseDir: string;

  constructor(baseDir = '/tmp/in-memory-host') {
    this.baseDir = baseDir;
  }

  async readFile(path: string): Promise<string> {
    const v = this.files.get(path);
    if (v === undefined) throw new Error(`File not found: ${path}`);
    return v;
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async fileExists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  showNotice(message: string, durationMs?: number): void {
    this.notices.push({ message, durationMs });
  }

  getBaseDir(): string {
    return this.baseDir;
  }
}
