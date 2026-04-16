import { Plugin, Notice } from 'obsidian';
import { readFileSync, existsSync, readdirSync, mkdirSync, copyFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { OWHSettings, DEFAULT_SETTINGS } from './types';
import { OWHSettingTab } from './settings';
import { DbConnector } from './db/connector';
import { ContactReader } from './db/contact-reader';
import { MessageReader } from './db/message-reader';
import { parseMessage } from './parser/index';
import { LlmClient } from './ai/llm-client';
import { BriefingGenerator } from './ai/briefing-generator';
import type { ParsedMessage } from './types';

export default class OWHPlugin extends Plugin {
  settings: OWHSettings = DEFAULT_SETTINGS;
  private dbConnector: DbConnector = new DbConnector();

  async onload() {
    await this.loadSettings();

    // Pass plugin directory to DB connector for WASM file location
    // In Obsidian, this.manifest.dir is the plugin's directory path
    const pluginDir = (this.manifest as any).dir
      ? join((this.app.vault.adapter as any).basePath || '', (this.manifest as any).dir)
      : '';
    this.dbConnector.setPluginDir(pluginDir);

    // Don't init sql.js here — defer to first use to avoid blocking plugin load
    this.addSettingTab(new OWHSettingTab(this.app, this));

    // Command: Generate AI briefing
    this.addCommand({
      id: 'generate-briefing',
      name: 'Generate WeChat Briefing',
      callback: async () => {
        try {
          // Auto-detect decrypted DB directory if not configured
          if (!this.settings.decryptedDbDir) {
            const defaultDir = join(process.env.HOME || '', '.wechat-hub', 'decrypted');
            if (existsSync(join(defaultDir, 'contact.db'))) {
              this.settings.decryptedDbDir = defaultDir;
              await this.saveSettings();
              new Notice(`OWH: 已自动检测到解密数据库: ${defaultDir}`);
            }
          }

          const dbDir = this.settings.decryptedDbDir;
          const hasDecryptedDb = dbDir && existsSync(join(dbDir, 'contact.db'));

          if (!hasDecryptedDb) {
            new Notice('OWH: 未找到解密数据库。请先在终端运行：\ncd ~/wechat-decrypt && python3 decrypt_db.py', 8000);
            return;
          }

          if (this.settings.decryptMode === 'auto') {
            new Notice('OWH: 正在解密最新数据...');
            await this.decryptDatabases();
          }

          new Notice('OWH: 正在读取消息...');
          const messages = await this.loadAndParseMessages();
          if (messages.length === 0) {
            new Notice('OWH: No messages found in the configured time range.');
            return;
          }

          new Notice(`OWH: Generating briefing from ${messages.length} messages…`);
          const llmClient = new LlmClient(this.settings.aiEndpoint, this.settings.aiModel);
          const available = await llmClient.isAvailable();
          if (!available) {
            new Notice('OWH: AI endpoint is not available. Check Settings → AI Endpoint.');
            return;
          }

          const generator = new BriefingGenerator({
            skipEmoji: this.settings.skipEmoji,
            skipSystemMessages: this.settings.skipSystemMessages,
          });

          const today = new Date().toISOString().slice(0, 10);
          const briefing = await generator.generate(messages, llmClient, today);

          await this.saveBriefing(today, briefing);
          new Notice(`OWH: Briefing saved to ${this.settings.briefingFolder}/${today}.md`);
        } catch (err) {
          console.error('OWH: Error generating briefing', err);
          new Notice(`OWH: Error — ${(err as Error).message}`);
        }
      },
    });

    // Command: Decrypt databases
    this.addCommand({
      id: 'decrypt-databases',
      name: 'Decrypt WeChat Databases',
      callback: async () => {
        await this.decryptDatabases();
      },
    });

    // Command: Test DB connection
    this.addCommand({
      id: 'test-db-connection',
      name: 'Test WeChat DB Connection',
      callback: async () => {
        try {
          await this.ensureDbReady();
          const dir = this.settings.decryptedDbDir;
          if (!dir) {
            new Notice('OWH: No DB directory configured. Go to Settings → Decrypted DB Directory.');
            return;
          }

          const contactPath = join(dir, 'contact.db');
          const contactData = readFileSync(contactPath);
          const contactDb = this.dbConnector.loadFromBytes(new Uint8Array(contactData));
          const contactReader = new ContactReader(contactDb);
          const contactCount = contactReader.count();

          // Find all message DBs
          const { readdirSync } = await import('fs');
          const files = readdirSync(dir);
          const msgFiles = files.filter(f => f.startsWith('message_') && f.endsWith('.db'));

          const tableSummaries: string[] = [];
          for (const file of msgFiles.slice(0, 5)) {
            const msgPath = join(dir, file);
            const msgData = readFileSync(msgPath);
            const msgDb = this.dbConnector.loadFromBytes(new Uint8Array(msgData));
            const msgReader = new MessageReader(msgDb);
            const tables = msgReader.getConversationTables();
            tableSummaries.push(`${file}: ${tables.length} tables`);
          }

          const summary = [
            `Contacts: ${contactCount}`,
            `Message DB files: ${msgFiles.length}`,
            ...tableSummaries,
          ].join('\n');

          new Notice(`OWH DB Test:\n${summary}`, 8000);
          console.log('OWH DB Test:\n' + summary);
        } catch (err) {
          console.error('OWH: DB connection test failed', err);
          new Notice(`OWH: DB test failed — ${(err as Error).message}`);
        }
      },
    });

    console.log('OWH: WeChat Obsidian Hub loaded');
  }

  onunload() {
    console.log('OWH: WeChat Obsidian Hub unloaded');
  }

  /** Lazy-init the DB connector on first use */
  private async ensureDbReady(): Promise<void> {
    if (!this.dbConnector.isReady()) {
      await this.dbConnector.init();
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  /**
   * Auto-detect WeChat db_storage directory on macOS.
   */
  private detectWeChatDataDir(): string | null {
    const home = process.env.HOME || '';
    const base = join(home, 'Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files');
    if (!existsSync(base)) return null;
    try {
      for (const entry of readdirSync(base)) {
        if (entry === 'all_users') continue;
        const dbStorage = join(base, entry, 'db_storage');
        if (existsSync(dbStorage)) return dbStorage;
      }
    } catch { /* ignore */ }
    return null;
  }

  /**
   * Extract the SQLCipher key from the running WeChat process.
   * Uses ~/wechat-decrypt/find_all_keys_macos (must be compiled first).
   * Requires WeChat to be re-signed (codesign --force --deep --sign -).
   */
  private extractKeyFromWeChat(): string | null {
    const home = process.env.HOME || '';
    const toolPath = join(home, 'wechat-decrypt', 'find_all_keys_macos');

    if (!existsSync(toolPath)) {
      console.log('OWH: Key extraction tool not found at', toolPath);
      return null;
    }

    try {
      // Run the key extractor — it outputs keys to stdout and saves to all_keys.json
      const output = execSync(`"${toolPath}" 2>/dev/null`, {
        timeout: 15000,
        cwd: join(home, 'wechat-decrypt'),
      }).toString();

      // Parse the output for hex keys (64-char hex strings)
      const keyMatch = output.match(/[0-9a-f]{64}/i);
      if (keyMatch) {
        console.log('OWH: Key extracted successfully');
        return keyMatch[0].toLowerCase();
      }

      // Try reading all_keys.json as fallback
      const keysFile = join(home, 'wechat-decrypt', 'all_keys.json');
      if (existsSync(keysFile)) {
        const keysData = JSON.parse(readFileSync(keysFile, 'utf-8'));
        // all_keys.json format varies; look for hex key strings
        const jsonStr = JSON.stringify(keysData);
        const jsonKeyMatch = jsonStr.match(/[0-9a-f]{64}/i);
        if (jsonKeyMatch) {
          console.log('OWH: Key found in all_keys.json');
          return jsonKeyMatch[0].toLowerCase();
        }
      }
    } catch (e) {
      console.error('OWH: Key extraction failed:', (e as Error).message);
      // Common failure: WeChat not re-signed or not running
      if (String(e).includes('attach') || String(e).includes('permission')) {
        new Notice('OWH: 密钥提取失败——请先对微信重签名：\nsudo codesign --force --deep --sign - /Applications/WeChat.app\n然后重启微信', 10000);
      }
    }

    return null;
  }

  /**
   * Decrypt WeChat databases.
   * Automatically extracts key if not configured.
   * Uses sqlcipher CLI or Python fallback.
   */
  async decryptDatabases(): Promise<boolean> {
    let key = this.settings.decryptKeyHex;

    // Auto-extract key if not configured
    if (!key || key.length !== 64) {
      new Notice('OWH: 正在自动提取解密密钥...');
      const extractedKey = this.extractKeyFromWeChat();
      if (extractedKey) {
        key = extractedKey;
        this.settings.decryptKeyHex = key;
        await this.saveSettings();
        new Notice(`OWH: 密钥提取成功 (${key.slice(0, 8)}...${key.slice(-8)})`);
      } else {
        new Notice('OWH: 自动提取密钥失败。\n请确认：\n1. 微信正在运行\n2. 已执行重签名\n3. 或手动在设置中填入密钥', 8000);
        return false;
      }
    }

    const wechatDir = this.settings.wechatDataDir || this.detectWeChatDataDir();
    if (!wechatDir) {
      new Notice('OWH: 未找到微信数据目录，请确认微信已登录');
      return false;
    }

    const outputDir = this.settings.decryptedDbDir || join(process.env.HOME || '', '.wechat-hub/decrypted');
    mkdirSync(outputDir, { recursive: true });

    // Save detected paths
    this.settings.wechatDataDir = wechatDir;
    if (!this.settings.decryptedDbDir) {
      this.settings.decryptedDbDir = outputDir;
    }
    await this.saveSettings();

    const dbPairs = [
      { src: join(wechatDir, 'contact', 'contact.db'), dest: 'contact.db' },
      { src: join(wechatDir, 'message', 'message_0.db'), dest: 'message_0.db' },
    ];

    // Also include any additional message_N.db files
    const msgDir = join(wechatDir, 'message');
    if (existsSync(msgDir)) {
      try {
        for (const f of readdirSync(msgDir)) {
          if (f.match(/^message_\d+\.db$/) && f !== 'message_0.db') {
            dbPairs.push({ src: join(msgDir, f), dest: f });
          }
        }
      } catch { /* ignore */ }
    }

    let successCount = 0;
    new Notice('OWH: 开始解密数据库...');

    for (const { src, dest } of dbPairs) {
      if (!existsSync(src)) {
        console.log(`OWH: Skip ${dest} (not found)`);
        continue;
      }

      const destPath = join(outputDir, dest);

      try {
        // Try using sqlcipher CLI (most reliable)
        execSync(
          `sqlcipher "${src}" "PRAGMA key = \\"x'${key}'\\"; PRAGMA cipher_compatibility = 4; ATTACH DATABASE '${destPath}' AS plaintext KEY ''; SELECT sqlcipher_export('plaintext'); DETACH DATABASE plaintext;"`,
          { timeout: 30000, stdio: 'pipe' }
        );
        successCount++;
        console.log(`OWH: Decrypted ${dest}`);
      } catch {
        // Fallback: try Python script
        try {
          const scriptPath = join(__dirname, '..', 'scripts', 'decrypt.py');
          if (existsSync(scriptPath)) {
            execSync(
              `python3 "${scriptPath}" --key "${key}" --db-storage "${wechatDir}" --output "${outputDir}"`,
              { timeout: 60000, stdio: 'pipe' }
            );
            successCount++;
          } else {
            console.error(`OWH: decrypt.py not found at ${scriptPath}, and sqlcipher CLI failed`);
          }
        } catch (e2) {
          console.error(`OWH: Failed to decrypt ${dest}:`, e2);
        }
      }
    }

    if (successCount > 0) {
      new Notice(`OWH: 成功解密 ${successCount} 个数据库 → ${outputDir}`);
      return true;
    } else {
      new Notice('OWH: 解密失败。请检查密钥是否正确，或安装 sqlcipher CLI (brew install sqlcipher)');
      return false;
    }
  }

  private async loadAndParseMessages(): Promise<ParsedMessage[]> {
    await this.ensureDbReady();
    const dir = this.settings.decryptedDbDir;
    if (!dir) throw new Error('No DB directory configured.');

    // Load contacts
    const contactPath = join(dir, 'contact.db');
    const contactData = readFileSync(contactPath);
    const contactDb = this.dbConnector.loadFromBytes(new Uint8Array(contactData));
    const contactReader = new ContactReader(contactDb);

    // Time range cutoff
    const since = new Date(Date.now() - this.settings.briefingTimeRangeHours * 3600 * 1000);

    // Find all message DBs
    const { readdirSync } = await import('fs');
    const files = readdirSync(dir);
    const msgFiles = files.filter(f => f.startsWith('message_') && f.endsWith('.db'));

    const allMessages: ParsedMessage[] = [];

    for (const file of msgFiles) {
      const msgPath = join(dir, file);
      const msgData = readFileSync(msgPath);
      const msgDb = this.dbConnector.loadFromBytes(new Uint8Array(msgData));
      const msgReader = new MessageReader(msgDb);
      const tables = msgReader.getConversationTables();

      for (const table of tables) {
        // Derive conversation ID from table name (e.g. Msg_abc123 → abc123)
        const conversationId = table.replace(/^Msg_/, '');
        const contact = contactReader.getContact(conversationId);
        const conversationName = contact
          ? (contact.remark || contact.nickName || conversationId)
          : conversationId;

        const rawMessages = msgReader.getMessages(
          table,
          since,
          this.settings.maxMessagesPerConversation,
        );

        for (const raw of rawMessages) {
          const parsed = parseMessage(raw);
          const senderWxid = parsed.senderWxid || raw.real_sender_id || '';
          const senderContact = contactReader.getContact(senderWxid);
          const sender = senderContact
            ? (senderContact.remark || senderContact.nickName || senderWxid)
            : senderWxid || conversationName;

          allMessages.push({
            localId: raw.local_id,
            time: new Date(raw.create_time * 1000),
            conversationId,
            conversationName,
            sender,
            senderWxid,
            text: parsed.text,
            type: parsed.type,
            extra: parsed.extra,
          });
        }
      }
    }

    // Sort by time ascending
    allMessages.sort((a, b) => a.time.getTime() - b.time.getTime());
    return allMessages;
  }

  private async saveBriefing(date: string, content: string): Promise<void> {
    const folder = this.settings.briefingFolder;
    // Ensure the folder exists
    const folderExists = await this.app.vault.adapter.exists(folder);
    if (!folderExists) {
      await this.app.vault.createFolder(folder);
    }
    const filePath = `${folder}/${date}.md`;
    const header = `# WeChat Briefing — ${date}\n\n`;
    const existing = await this.app.vault.adapter.exists(filePath);
    if (existing) {
      const file = this.app.vault.getAbstractFileByPath(filePath);
      if (file) {
        await this.app.vault.modify(file as any, header + content);
      }
    } else {
      await this.app.vault.create(filePath, header + content);
    }
  }
}
