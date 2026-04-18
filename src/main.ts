import { Plugin, Notice, Modal, App, Setting, TFile } from 'obsidian';
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
import { ExtractionStore } from './intel/extraction-store';
import { generateWeeklyRollup, generateTopicBrief, runACHAnalysis } from './intel/retrospective';
import { buildGroupDossier } from './intel/group-dossier';
import { IdentityResolver } from './intel/identity-resolver';
import { MediaEnhancer } from './media/media-enhancer';
import { WhisperClient } from './media/whisper-client';
import { OcrClient } from './media/ocr-client';
import { VlmClient } from './media/vlm-client';
import { VoiceCache } from './media/voice-cache';
import { VoiceProcessor } from './media/voice-processor';
import { ImageProcessor } from './media/image-processor';
import { WeChatFileLocator } from './media/wechat-file-locator';
import { SilkDecoder } from './media/silk-decoder';
import { EvidenceStore } from './core/storage/evidence-store';
import { buildFindingsExtractionPrompt, parseFindings } from './core/sat/finding-extractor';
import { identityToActor } from './core/identity/actor-factory';
import { messageToObject } from './core/messaging/object-factory';
import { collectEvidence, runAch } from './core/sat/ach-runner';
import { generateDissentingView } from './core/sat/devils-advocate';
import { KENT_ZH_LABEL } from './core/types/finding';
import type { ParsedMessage } from './types';

export default class OWHPlugin extends Plugin {
  settings: OWHSettings = DEFAULT_SETTINGS;
  private dbConnector: DbConnector = new DbConnector();
  /** Set during generate-briefing — used by loadAndParseMessages for canonical names */
  private identityResolver: IdentityResolver | null = null;

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
            if (existsSync(join(defaultDir, 'contact', 'contact.db'))) {
              this.settings.decryptedDbDir = defaultDir;
              await this.saveSettings();
              new Notice(`OWH: 已自动检测到解密数据库: ${defaultDir}`);
            }
          }

          // Always refresh decrypted DBs to capture latest messages
          // (skip if user explicitly set decryptMode='manual')
          if (this.settings.decryptMode !== 'manual') {
            const ok = await this.decryptDatabases();
            if (!ok) {
              const dbDir = this.settings.decryptedDbDir;
              const hasOld = dbDir && existsSync(join(dbDir, 'contact', 'contact.db'));
              if (!hasOld) return;  // no old data either, give up
              new Notice('OWH: 解密失败，使用上次的旧数据继续...', 5000);
            }
          }

          const dbDir = this.settings.decryptedDbDir;
          const hasDecryptedDb = dbDir && existsSync(join(dbDir, 'contact', 'contact.db'));
          if (!hasDecryptedDb) {
            new Notice('OWH: 未找到解密数据库。请运行一次性设置：\ncd ~/wechat-obsidian-plugin/scripts && sudo bash owh-extract-key.sh', 12000);
            return;
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

          // Detect user identity from WeChat data folder name (e.g. "joyrush_2ffc" → "joyrush")
          const wechatDir = this.settings.wechatDataDir || this.detectWeChatDataDir() || '';
          const folderName = wechatDir.split('/').filter(Boolean).slice(-2, -1)[0] || '';
          const userAlias = folderName.replace(/_[a-f0-9]+$/, '');

          // Build authoritative IdentityResolver — indexes every wxid with
          // all names (contact, nickname, remark, per-group aliases).
          // Used everywhere: @ detection, Pattern of Life dedup, dossiers, etc.
          let userIdsList: string[] = [userAlias];
          let identityResolver: IdentityResolver | null = null;
          try {
            const dbDir = this.settings.decryptedDbDir;
            if (dbDir) {
              const contactPath = join(dbDir, 'contact', 'contact.db');
              if (existsSync(contactPath)) {
                const cdb = this.dbConnector.loadFromBytes(new Uint8Array(readFileSync(contactPath)));
                const tmpReader = new ContactReader(cdb);
                identityResolver = new IdentityResolver(tmpReader);
                const stats = identityResolver.stats();
                console.log(`OWH: IdentityResolver — ${stats.identities} identities, ${stats.aliases} aliases (${stats.withRemark} with remark)`);

                // Collect all names the user is known by
                const userIdentity = identityResolver.findByName(userAlias);
                if (userIdentity) {
                  userIdsList = [...userIdentity.allNames];
                  console.log(`OWH: User identities (${userIdsList.length}): ${userIdsList.slice(0, 10).join(', ')}${userIdsList.length > 10 ? '...' : ''}`);
                }
                cdb.close();
              }
            }
          } catch (e) {
            console.error('OWH: Failed to build identity resolver:', e);
          }
          // Stash resolver on the plugin instance so loadAndParseMessages + group dossier can use it
          this.identityResolver = identityResolver;

          const extractionStore = new ExtractionStore(process.env.HOME || '');
          const generator = new BriefingGenerator({
            skipEmoji: this.settings.skipEmoji,
            skipSystemMessages: this.settings.skipSystemMessages,
            userWxid: userAlias,
            userIdentities: userIdsList,
            extractionStore,
            identityResolver: identityResolver ?? undefined,
          });

          // Filename includes timestamp so multiple runs per day don't overwrite
          const now = new Date();
          const today = now.toISOString().slice(0, 10);
          const hhmm = now.toTimeString().slice(0, 5).replace(':', '');
          const fileSlug = `${today}-${hhmm}`;
          const dateLabel = `${today} ${now.toTimeString().slice(0, 5)}`;

          // Progressive generation: update the note in real-time
          const briefing = await generator.generateProgressive(
            messages, llmClient, dateLabel,
            async (content: string, done: boolean) => {
              await this.saveBriefing(fileSlug, content);
              if (done) {
                new Notice(`OWH: 简报已生成 → ${this.settings.briefingFolder}/${fileSlug}.md`);
              }
            },
          );

          // v0.5.0/v0.5.1 — Persist evidence chain:
          // (1) Actors involved in the window (from resolver, only those seen)
          // (2) WxObjects for substantive messages in the window
          // (3) Findings extracted from the briefing (by a 2nd LLM call)
          // Findings can cite real `msg:wechat:<convoId>:<localId>` ids because
          // the briefing now preserves them (see prompt-templates §7).
          try {
            await this.persistEvidenceAndFindings(
              messages, identityResolver, briefing, llmClient, fileSlug,
            );
          } catch (e) {
            console.error('OWH: Evidence + finding persistence failed (non-fatal):', e);
          }
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

    // Command: Generate Weekly Rollup
    this.addCommand({
      id: 'generate-weekly-rollup',
      name: 'Generate Weekly Rollup (last 7 days)',
      callback: async () => {
        try {
          const llmClient = new LlmClient(this.settings.aiEndpoint, this.settings.aiModel);
          if (!(await llmClient.isAvailable())) {
            new Notice('OWH: LM Studio 不可用');
            return;
          }
          const store = new ExtractionStore(process.env.HOME || '');
          new Notice('OWH: 正在生成周报...');
          const resolver = await this.ensureIdentityResolver();
          const brief = await generateWeeklyRollup(store, llmClient, 7, resolver ?? undefined);
          const now = new Date();
          const slug = `weekly-${now.toISOString().slice(0, 10)}-${now.toTimeString().slice(0, 5).replace(':', '')}`;
          await this.saveBriefing(slug, brief);
          new Notice(`OWH: 周报已生成 → ${this.settings.briefingFolder}/${slug}.md`, 6000);
        } catch (err) {
          console.error('OWH: weekly rollup failed', err);
          new Notice(`OWH: Error — ${(err as Error).message}`);
        }
      },
    });

    // Command: Topic Brief (Target-Centric)
    this.addCommand({
      id: 'generate-topic-brief',
      name: 'Generate Topic Brief (cross-time deep-dive)',
      callback: async () => {
        try {
          // Use Obsidian's prompt to ask for keyword
          const topic = await this.promptForInput('专题分析关键词', '例如：M9 成本 / 领克项目 / AI 编程');
          if (!topic) return;
          const days = await this.promptForInput('时间范围（天）', '默认 30', '30');
          const daysNum = parseInt(days || '30', 10) || 30;

          const llmClient = new LlmClient(this.settings.aiEndpoint, this.settings.aiModel);
          if (!(await llmClient.isAvailable())) {
            new Notice('OWH: LM Studio 不可用');
            return;
          }
          const store = new ExtractionStore(process.env.HOME || '');
          new Notice(`OWH: 正在生成"${topic}"专题简报 (过去 ${daysNum} 天)...`);
          const resolver = await this.ensureIdentityResolver();
          const brief = await generateTopicBrief(store, llmClient, topic, daysNum, resolver ?? undefined);
          const safeName = topic.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40);
          const now = new Date();
          const slug = `topic-${safeName}-${now.toISOString().slice(0, 10)}-${now.toTimeString().slice(0, 5).replace(':', '')}`;
          await this.saveBriefing(slug, brief);
          new Notice(`OWH: 专题简报已生成 → ${this.settings.briefingFolder}/${slug}.md`, 6000);
        } catch (err) {
          console.error('OWH: topic brief failed', err);
          new Notice(`OWH: Error — ${(err as Error).message}`);
        }
      },
    });

    // Command: ACH Analysis (legacy single-prompt version, kept for fallback
    // when user has ExtractionStore data but no EvidenceStore yet)
    this.addCommand({
      id: 'run-ach-analysis',
      name: 'Run ACH Analysis (legacy, single-prompt)',
      callback: async () => {
        try {
          const topic = await this.promptForInput(
            'ACH 争议主题',
            '例如：M9 制造成本到底是多少 / 京东 CEO 变动的真正原因',
          );
          if (!topic) return;
          const days = await this.promptForInput('时间范围（天）', '默认 14', '14');
          const daysNum = parseInt(days || '14', 10) || 14;

          const llmClient = new LlmClient(this.settings.aiEndpoint, this.settings.aiModel);
          if (!(await llmClient.isAvailable())) {
            new Notice('OWH: LM Studio 不可用');
            return;
          }
          const store = new ExtractionStore(process.env.HOME || '');
          new Notice(`OWH: 正在对"${topic}"做 ACH 矩阵分析...`);
          const resolver = await this.ensureIdentityResolver();
          const brief = await runACHAnalysis(store, llmClient, topic, daysNum, resolver ?? undefined);
          const safeName = topic.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40);
          const now = new Date();
          const slug = `ach-${safeName}-${now.toISOString().slice(0, 10)}-${now.toTimeString().slice(0, 5).replace(':', '')}`;
          await this.saveBriefing(slug, brief);
          new Notice(`OWH: ACH 分析已生成 → ${this.settings.briefingFolder}/${slug}.md`, 6000);
        } catch (err) {
          console.error('OWH: ACH analysis failed', err);
          new Notice(`OWH: Error — ${(err as Error).message}`);
        }
      },
    });

    // Command: ACH Matrix (v0.6.0 — proper Heuer matrix with separate LLM
    // calls for hypothesis generation and evidence marking, then mechanical
    // diagnosticity + inconsistency scoring)
    this.addCommand({
      id: 'run-ach-matrix',
      name: 'Run ACH Matrix (proper Heuer, from EvidenceStore)',
      callback: async () => {
        try {
          const topic = await this.promptForInput(
            'ACH 主题关键词（将用于检索 EvidenceStore）',
            '例如：DeepSeek / 领克 / 加纳',
          );
          if (!topic) return;

          const llmClient = new LlmClient(this.settings.aiEndpoint, this.settings.aiModel);
          if (!(await llmClient.isAvailable())) {
            new Notice('OWH: LM Studio 不可用');
            return;
          }

          const storeDir = join(process.env.HOME || '', '.wechat-hub', 'evidence-store');
          const store = new EvidenceStore(storeDir);
          const evidence = collectEvidence(store, topic);
          if (evidence.length < 3) {
            new Notice(
              `OWH: 未找到足够证据（找到 ${evidence.length} 条，需要 ≥3）。先跑一次"Generate WeChat Briefing"让 EvidenceStore 积累数据。`,
              10000,
            );
            return;
          }

          new Notice(`OWH: ACH 矩阵分析"${topic}" — ${evidence.length} 条证据，开始生成假设...`);
          const result = await runAch(topic, evidence, llmClient);
          const safeName = topic.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40);
          const now = new Date();
          const slug = `ach-matrix-${safeName}-${now.toISOString().slice(0, 10)}-${now.toTimeString().slice(0, 5).replace(':', '')}`;

          const fullDoc = `> 🕐 生成时间: ${now.toLocaleString('zh-CN', { hour12: false })}\n> 📊 证据库: ${evidence.length} 条\n\n${result.markdown}`;
          await this.saveBriefing(slug, fullDoc);
          const best = result.analysis.ranking[0];
          const bestHyp = result.analysis.matrix.hypotheses.find(h => h.id === best.hypothesisId);
          new Notice(
            `OWH: ACH 完成 → 最可信假设: "${bestHyp?.statement.slice(0, 40)}" (不一致分数 ${best.inconsistencyScore})`,
            8000,
          );
        } catch (err) {
          console.error('OWH: ACH matrix analysis failed', err);
          new Notice(`OWH: ACH 矩阵分析失败 — ${(err as Error).message}`);
        }
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

          const contactPath = join(dir, 'contact', 'contact.db');
          const contactData = readFileSync(contactPath);
          const contactDb = this.dbConnector.loadFromBytes(new Uint8Array(contactData));
          const contactReader = new ContactReader(contactDb);
          const contactCount = contactReader.count();

          // Find all message DBs
          const msgDirPath = join(dir, 'message');
          const files = readdirSync(msgDirPath);
          const msgFiles = files.filter((f: string) => f.endsWith('.db') && (f.startsWith('message_') || f.startsWith('biz_message_')) && !f.includes('fts') && !f.includes('resource'));

          const tableSummaries: string[] = [];
          for (const file of msgFiles.slice(0, 5)) {
            const msgPath = join(msgDirPath, file);
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

    // Lazy group-dossier generation: when user clicks [[WeChat-Groups/xxx]]
    // Obsidian auto-creates the empty note, we detect the open and populate it.
    this.registerEvent(this.app.workspace.on('file-open', async (file: TFile | null) => {
      if (!file) return;
      if (!file.path.startsWith('WeChat-Groups/')) return;
      try {
        const existing = await this.app.vault.read(file);
        if (existing.trim().length > 200) return;  // already populated
        await this.populateGroupDossier(file);
      } catch (e) {
        console.error('OWH: group-dossier populate failed', e);
      }
    }));

    console.log('OWH: WeChat Obsidian Hub loaded');
  }

  onunload() {
    console.log('OWH: WeChat Obsidian Hub unloaded');
  }

  /** Show a modal prompting for text input. Returns null if user cancels. */
  private async promptForInput(title: string, placeholder: string, defaultValue: string = ''): Promise<string | null> {
    return new Promise(resolve => {
      const modal = new InputModal(this.app, title, placeholder, defaultValue, resolve);
      modal.open();
    });
  }

  /**
   * Populate a [[WeChat-Groups/xxx]] note on-demand when user opens it.
   * The note filename corresponds to the group's display name.
   */
  private async populateGroupDossier(file: TFile): Promise<void> {
    // Note name = group display name (from briefing wikilink)
    const displayName = file.basename;

    await this.ensureDbReady();
    const dir = this.settings.decryptedDbDir;
    if (!dir) {
      await this.app.vault.modify(file, `# ${displayName}\n\n> 未配置解密数据库目录，无法生成档案。`);
      return;
    }

    new Notice(`OWH: 正在为群 "${displayName}" 生成档案...`);

    // Load contacts + messages
    const contactData = readFileSync(join(dir, 'contact', 'contact.db'));
    const contactDb = this.dbConnector.loadFromBytes(new Uint8Array(contactData));
    const contactReader = new ContactReader(contactDb);

    // Find the group wxid whose display name matches (fuzzy: trim + case-insensitive)
    const target = displayName.trim().toLowerCase();
    let groupWxid = '';
    let matchedName = '';
    for (const c of contactReader.getAllContacts()) {
      const name = (c.remark || c.nickName || c.username).trim().toLowerCase();
      if (name === target) {
        groupWxid = c.username;
        matchedName = c.remark || c.nickName || c.username;
        break;
      }
    }
    // Fall back to partial match (in case file name got truncated or slightly modified)
    if (!groupWxid) {
      for (const c of contactReader.getAllContacts()) {
        const name = (c.remark || c.nickName || c.username).trim().toLowerCase();
        if (name.includes(target) || target.includes(name)) {
          groupWxid = c.username;
          matchedName = c.remark || c.nickName || c.username;
          break;
        }
      }
    }

    if (!groupWxid) {
      await this.app.vault.modify(file, `# ${displayName}\n\n> 未在联系人表中找到名为 "${displayName}" 的群/联系人。\n> 请确认群名拼写正确。\n\n**调试信息**：\n- 已查询 ${contactReader.count()} 个联系人\n- 尝试过精确匹配 + 模糊匹配（trim + 大小写不敏感）\n- 如果群名字里包含特殊字符（如 emoji），可能需要手动在 Obsidian 中重命名这个笔记`);
      contactDb.close();
      return;
    }
    console.log(`OWH: group dossier matched "${displayName}" → "${matchedName}" (${groupWxid})`);

    // Find message DB
    const msgDir = join(dir, 'message');
    const msgFiles = readdirSync(msgDir).filter((f: string) => f.endsWith('.db') && (f.startsWith('message_') || f.startsWith('biz_message_')) && !f.includes('fts') && !f.includes('resource'));

    // Resolve user identities for @ detection
    const wechatDir = this.settings.wechatDataDir || this.detectWeChatDataDir() || '';
    const folderName = wechatDir.split('/').filter(Boolean).slice(-2, -1)[0] || '';
    const userAlias = folderName.replace(/_[a-f0-9]+$/, '');
    const userIdentities: string[] = [userAlias];
    try {
      const res = contactDb.exec(
        `SELECT nick_name, remark, alias FROM contact WHERE alias = '${userAlias.replace(/'/g, "''")}' LIMIT 1`
      );
      if (res.length > 0 && res[0].values.length > 0) {
        for (const v of res[0].values[0]) {
          if (v && typeof v === 'string' && v.trim()) userIdentities.push(v.trim());
        }
      }
    } catch { /* ignore */ }

    // Build dossier from the right message DB (scan all)
    let content = '';
    for (const f of msgFiles) {
      const msgData = readFileSync(join(msgDir, f));
      const msgDb = this.dbConnector.loadFromBytes(new Uint8Array(msgData));
      const msgReader = new MessageReader(msgDb);
      // Test if this DB contains the target group's table
      const { createHash } = await import('crypto');
      const hash = createHash('md5').update(groupWxid).digest('hex');
      const tables = msgReader.getConversationTables();
      if (tables.includes(`Msg_${hash}`)) {
        // Build resolver on-demand if not already built
        const resolver = this.identityResolver ?? new IdentityResolver(contactReader);
        content = buildGroupDossier({
          groupWxid,
          groupName: displayName,
          contactReader,
          messageReader: msgReader,
          daysBack: 7,
          userIdentities,
          identityResolver: resolver,
        });
        msgDb.close();
        break;
      }
      msgDb.close();
    }

    contactDb.close();

    if (!content) {
      content = `# ${displayName}\n\n> wxid: \`${groupWxid}\`\n> 未找到该群的消息数据表`;
    }

    await this.app.vault.modify(file, content);
    new Notice(`OWH: 档案已生成 ${displayName}`, 4000);
  }

  /**
   * Build (or reuse) the IdentityResolver from current decrypted contact.db.
   * Called on-demand by any command that needs canonical identity.
   */
  private async ensureIdentityResolver(): Promise<IdentityResolver | null> {
    if (this.identityResolver) return this.identityResolver;
    const dbDir = this.settings.decryptedDbDir;
    if (!dbDir) return null;
    const contactPath = join(dbDir, 'contact', 'contact.db');
    if (!existsSync(contactPath)) return null;
    try {
      await this.ensureDbReady();
      const cdb = this.dbConnector.loadFromBytes(new Uint8Array(readFileSync(contactPath)));
      const reader = new ContactReader(cdb);
      this.identityResolver = new IdentityResolver(reader);
      cdb.close();
      return this.identityResolver;
    } catch (e) {
      console.error('OWH: ensureIdentityResolver failed:', e);
      return null;
    }
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
   * Daily decryption (no sudo needed).
   * Uses cached keys from ~/all_keys.json + wechat-decrypt's Python script.
   * If keys are missing, instruct user to run one-time setup.
   */
  async decryptDatabases(): Promise<boolean> {
    const home = process.env.HOME || '';
    const keysFile = join(home, 'all_keys.json');
    const decryptScript = join(home, 'wechat-decrypt', 'decrypt_db.py');
    const configFile = join(home, 'wechat-decrypt', 'config.json');

    // Check prerequisites
    if (!existsSync(keysFile)) {
      new Notice(
        'OWH: 未找到密钥缓存。请先运行一次性设置脚本：\n\n' +
        'cd ~/wechat-obsidian-plugin/scripts && sudo bash owh-extract-key.sh\n\n' +
        '完成后再生成简报。',
        15000,
      );
      return false;
    }

    if (!existsSync(decryptScript)) {
      new Notice('OWH: 未找到 decrypt_db.py，请确认 ~/wechat-decrypt/ 已克隆', 8000);
      return false;
    }

    // Ensure config.json points at the right paths
    const wechatDir = this.settings.wechatDataDir || this.detectWeChatDataDir() || '';
    const outputDir = this.settings.decryptedDbDir || join(home, '.wechat-hub/decrypted');
    if (wechatDir) {
      const config = {
        db_dir: wechatDir,
        keys_file: keysFile,
        decrypted_dir: outputDir,
        wechat_process: 'WeChat',
      };
      try {
        require('fs').writeFileSync(configFile, JSON.stringify(config, null, 2));
      } catch (e) {
        console.error('OWH: Failed to write config.json:', e);
      }
    }

    // Run daily decryption
    new Notice('OWH: 正在用缓存密钥解密最新数据库...');
    try {
      const output = execSync(
        `cd ${JSON.stringify(join(home, 'wechat-decrypt'))} && python3 decrypt_db.py 2>&1 | tail -5`,
        { timeout: 120000, encoding: 'utf-8' },
      );
      console.log('OWH decrypt output:', output);

      // Persist paths
      this.settings.wechatDataDir = wechatDir;
      this.settings.decryptedDbDir = outputDir;
      await this.saveSettings();

      new Notice(`OWH: 解密完成 → ${outputDir}`);
      return true;
    } catch (e) {
      const errMsg = (e as Error).message;
      console.error('OWH decrypt failed:', errMsg);
      new Notice(`OWH: 解密失败 — ${errMsg.slice(0, 200)}`, 10000);
      return false;
    }
  }

  /** @deprecated kept for backward compat — use decryptDatabases() */
  async decryptDatabasesLegacy(): Promise<boolean> {
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

    // Load contacts (in contact/ subdirectory)
    const contactPath = join(dir, 'contact', 'contact.db');
    if (!existsSync(contactPath)) {
      throw new Error(`contact.db not found at ${contactPath}`);
    }
    const contactData = readFileSync(contactPath);
    const contactDb = this.dbConnector.loadFromBytes(new Uint8Array(contactData));
    const contactReader = new ContactReader(contactDb);

    // Time range cutoff.
    // If briefingTimeRangeHours == 24, treat as "today only" (since local midnight).
    // Otherwise use rolling window.
    let since: Date;
    if (this.settings.briefingTimeRangeHours === 24) {
      // Today since 00:00 local time
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      since = today;
    } else {
      since = new Date(Date.now() - this.settings.briefingTimeRangeHours * 3600 * 1000);
    }
    console.log(`OWH: Loading messages since ${since.toISOString()}`);

    // Find all message DBs (in message/ subdirectory)
    const msgDir = join(dir, 'message');
    if (!existsSync(msgDir)) {
      throw new Error(`message directory not found at ${msgDir}`);
    }
    const files = readdirSync(msgDir);
    const msgFiles = files.filter((f: string) => f.endsWith('.db') && (f.startsWith('message_') || f.startsWith('biz_message_')) && !f.includes('fts') && !f.includes('resource'));

    const allMessages: ParsedMessage[] = [];

    for (const file of msgFiles) {
      const msgPath = join(msgDir, file);
      const msgData = readFileSync(msgPath);
      const msgDb = this.dbConnector.loadFromBytes(new Uint8Array(msgData));
      const msgReader = new MessageReader(msgDb);
      const tables = msgReader.getConversationTables();

      for (const table of tables) {
        // Table names are Msg_<md5(real_username)>, so we must reverse-lookup
        // the hash to get the real chatroom/contact wxid, then fetch its display name.
        const tableHash = table.replace(/^Msg_/, '');
        const resolved = contactReader.resolveHashToDisplayName(tableHash);
        const conversationId = resolved.username || tableHash;  // real wxid if found
        const conversationName = resolved.name;                  // real display name

        const rawMessages = msgReader.getMessages(
          table,
          since,
          this.settings.maxMessagesPerConversation,
        );

        for (const raw of rawMessages) {
          const parsed = parseMessage(raw);
          // Resolve sender: parser may extract wxid from content, or use Name2Id mapping
          let senderWxid = parsed.senderWxid || '';
          if (!senderWxid || /^\d+$/.test(senderWxid)) {
            // Integer sender ID → resolve via Name2Id
            senderWxid = msgReader.resolveSenderId(raw.real_sender_id);
          }
          // Canonical name from IdentityResolver (knows ALL aliases per wxid).
          // Falls back to ContactReader if resolver not built.
          let sender: string;
          if (this.identityResolver) {
            const ident = this.identityResolver.get(senderWxid);
            sender = ident?.primaryName || senderWxid || conversationName;
          } else {
            const senderContact = contactReader.getContact(senderWxid);
            sender = senderContact
              ? (senderContact.remark || senderContact.nickName || senderWxid)
              : senderWxid || conversationName;
          }

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

    // Multimodal enhancement: voice → transcript, image → OCR/VLM description.
    // Best-effort — placeholders preserved on any failure.
    try {
      const enhancer = this.buildMediaEnhancer();
      if (enhancer) {
        const voiceCount = allMessages.filter(m => m.type === 'voice').length;
        const imageCount = allMessages.filter(m => m.type === 'image').length;
        if (voiceCount + imageCount > 0) {
          new Notice(`OWH: 处理多模态 (${voiceCount} 语音 / ${imageCount} 图片)…`);
          const stats = await enhancer.enhance(allMessages);
          console.log('OWH: media enhancement stats', stats);
          if (stats.errors.length > 0) {
            console.warn('OWH: media enhancement partial failures:', stats.errors.slice(0, 10));
          }
        }
      }
    } catch (e) {
      console.error('OWH: media enhancement failed entirely, keeping placeholders:', e);
    }

    return allMessages;
  }

  /**
   * Build a MediaEnhancer from current settings. Returns null if all modalities
   * are disabled, or if no wechatMediaRoot is configured (can't locate files).
   */
  private buildMediaEnhancer(): MediaEnhancer | null {
    const s = this.settings;
    const voiceOn = s.enableVoiceTranscription;
    const imageOn = s.enableImageOcr || s.enableImageVlm;
    if (!voiceOn && !imageOn) return null;

    const mediaRoot = s.wechatMediaRoot || this.autoDetectMediaRoot();
    if (!mediaRoot) {
      console.warn('OWH: multimodal enabled but no wechatMediaRoot configured');
      return null;
    }

    const cacheDir = s.mediaCacheDir || join(process.env.HOME || '', '.wechat-hub', 'media-cache');
    const locator = new WeChatFileLocator(mediaRoot);

    let voiceProcessor = null;
    let silkDecoder = null;
    if (voiceOn) {
      const whisper = new WhisperClient(s.whisperEndpoint);
      const voiceCache = new VoiceCache(join(cacheDir, 'voice'));
      voiceProcessor = new VoiceProcessor(whisper, voiceCache);
      silkDecoder = new SilkDecoder();
    }

    let imageProcessor = null;
    if (imageOn) {
      const ocr = new OcrClient(s.ocrEndpoint);
      const vlmEndpoint = s.vlmEndpoint || s.aiEndpoint;
      const vlm = new VlmClient(vlmEndpoint, s.vlmModel);
      const imageCache = new VoiceCache(join(cacheDir, 'image'));
      imageProcessor = new ImageProcessor(ocr, vlm, imageCache);
    }

    return new MediaEnhancer({
      voiceProcessor,
      imageProcessor,
      locator,
      silkDecoder,
      voiceLanguage: s.whisperLanguage,
      ocrLanguage: s.ocrLanguage,
      concurrency: 4,
    });
  }

  /**
   * v0.5.0 + v0.5.1 — Populate the EvidenceStore for this briefing run.
   *   1. Actors involved (authors + conversation containers) from the resolver
   *   2. WxObject entities for substantive messages (text >= 10 chars,
   *      not emoji / system / voice / image placeholders)
   *   3. Findings extracted from the briefing markdown via a 2nd LLM call
   *
   * Steps 1+2 happen BEFORE step 3 so Finding.evidenceRefs can cite real
   * entity ids that already exist in the store. Uses allowOverwrite: true
   * because entity content (e.g. text / aliases) can legitimately evolve.
   */
  private async persistEvidenceAndFindings(
    messages: ParsedMessage[],
    identityResolver: IdentityResolver | null,
    briefing: string,
    llmClient: LlmClient,
    reportSlug: string,
  ): Promise<void> {
    const storeDir = join(process.env.HOME || '', '.wechat-hub', 'evidence-store');
    const store = new EvidenceStore(storeDir);
    const nowIso = new Date().toISOString();

    // 1. Actors — only ones that appear as sender or conversation in this window,
    //    so we don't flood the store with all 28k contacts on every run.
    let actorCount = 0;
    if (identityResolver) {
      const seenWxids = new Set<string>();
      for (const m of messages) {
        if (m.senderWxid) seenWxids.add(m.senderWxid);
        if (m.conversationId) seenWxids.add(m.conversationId);
      }
      for (const wxid of seenWxids) {
        const id = identityResolver.get(wxid);
        if (!id) continue;
        try {
          store.put(identityToActor(id, { sourceAdapter: 'wechat', createdAt: nowIso }), { allowOverwrite: true });
          actorCount++;
        } catch (e) {
          console.warn(`OWH: failed to persist actor ${wxid}:`, e);
        }
      }
    }

    // 2. WxObjects — substantive messages only
    let objectCount = 0;
    for (const m of messages) {
      const txt = (m.text || '').trim();
      if (m.type === 'emoji' || m.type === 'system') continue;
      if (txt.length < 10) continue;
      // Keep voice/image placeholders only when their text was already replaced
      // by the MediaEnhancer (i.e. not still "[voice]" / "[image]").
      if (txt === '[voice]' || txt === '[image]' || txt === '[video]') continue;
      try {
        store.put(messageToObject(m, { sourceAdapter: 'wechat', createdAt: nowIso }), { allowOverwrite: true });
        objectCount++;
      } catch (e) {
        console.warn(`OWH: failed to persist object ${m.localId}:`, e);
      }
    }

    console.log(`OWH: persisted ${actorCount} actors + ${objectCount} objects`);

    // 3. Findings via LLM
    new Notice('OWH: 正在抽取结构化判断...');
    const extractionPrompt = buildFindingsExtractionPrompt(briefing);
    let rawJson: string;
    try {
      rawJson = await llmClient.complete(extractionPrompt);
    } catch (e) {
      console.error('OWH: Finding extraction LLM call failed:', e);
      new Notice(`OWH: 判断抽取失败 (LLM): ${(e as Error).message.slice(0, 80)}`, 6000);
      return;
    }

    const { findings, errors } = parseFindings(rawJson, {
      reportId: `report:wechat:${reportSlug}`,
      createdAt: nowIso,
    });
    if (errors.length > 0) {
      console.warn('OWH: Finding extraction partial errors:', errors.slice(0, 8));
    }

    for (const f of findings) {
      try {
        store.putFinding(f, { allowOverwrite: true });
      } catch (e) {
        console.warn(`OWH: failed to persist finding ${f.id}:`, e);
      }
    }

    // v0.8.1 — Devil's Advocate pass on top-N findings (opt-in)
    if (this.settings.enableDevilsAdvocate && findings.length > 0) {
      try {
        await this.runDevilsAdvocate(findings, llmClient, store, reportSlug);
      } catch (e) {
        console.error('OWH: Devil\'s Advocate pass failed (non-fatal):', e);
      }
    }

    const stats = store.stats();
    console.log(`OWH: EvidenceStore — ${stats.actors} actors, ${stats.objects} objects, ${stats.findings} findings`);
    new Notice(
      `OWH: 抽取 ${findings.length} 条判断${errors.length ? `（${errors.length} 条忽略）` : ''}，累计 ${stats.findings} 条 | 证据库 ${stats.actors} actors · ${stats.objects} objects`,
      6000,
    );
  }

  /**
   * v0.8.1 — Run Devil's Advocate on the top-N highest-confidence findings,
   * attach DissentingView to each, re-persist, and append a structured
   * dissent section to the briefing file.
   */
  private async runDevilsAdvocate(
    findings: import('./core/types/finding').Finding[],
    llmClient: LlmClient,
    store: EvidenceStore,
    reportSlug: string,
  ): Promise<void> {
    const topN = Math.max(1, this.settings.devilsAdvocateTopN || 3);
    // Rank by probability midpoint × evidence count (more confident + better-
    // supported judgments are more important to challenge)
    const scored = findings.map(f => {
      const mid = (f.probRange[0] + f.probRange[1]) / 2;
      return { f, score: mid * Math.max(1, f.evidenceRefs.length) };
    });
    scored.sort((a, b) => b.score - a.score);
    const targets = scored.slice(0, topN).map(x => x.f);

    new Notice(`OWH: Devil's Advocate 对 top ${targets.length} 判断生成反方视角...`);
    const llmAdapter = { complete: (p: string) => llmClient.complete(p) };
    const sections: string[] = [];
    let withDissent = 0;

    for (const f of targets) {
      const dv = await generateDissentingView(f, llmAdapter);
      if (dv) {
        const updated = { ...f, dissentingView: dv };
        try { store.putFinding(updated, { allowOverwrite: true }); } catch { /* ignore */ }
        sections.push(this.formatDissentSection(updated, dv));
        withDissent++;
      } else {
        sections.push(`### ❌ DA 失败: ${f.judgment.slice(0, 50)}...\n\n*Devil's Advocate 未能生成结构化反方（LLM 输出无效或为空）*\n`);
      }
    }

    if (sections.length > 0) {
      const folder = this.settings.briefingFolder;
      const filePath = `${folder}/${reportSlug}.md`;
      try {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (file) {
          const existing = await this.app.vault.read(file as any);
          const appendix = '\n\n---\n\n## 🤔 Devil\'s Advocate 详细（v0.8.1）\n\n' +
            '> 对置信度最高的 ' + targets.length + ' 条判断，独立 LLM context 强制生成反方视角（Heuer "第十人" 原则）。\n\n' +
            sections.join('\n');
          await this.app.vault.modify(file as any, existing + appendix);
        }
      } catch (e) {
        console.error('OWH: failed to append DA appendix:', e);
      }
    }

    new Notice(`OWH: Devil's Advocate ${withDissent}/${targets.length} 条判断有反方`, 4000);
  }

  private formatDissentSection(
    finding: import('./core/types/finding').Finding,
    dv: NonNullable<import('./core/types/finding').Finding['dissentingView']>,
  ): string {
    const origLabel = KENT_ZH_LABEL[finding.kentPhrase] || finding.kentPhrase;
    const dvLabel = KENT_ZH_LABEL[dv.kentPhrase] || dv.kentPhrase;
    const lines: string[] = [];
    lines.push(`### ${finding.judgment}`);
    lines.push('');
    lines.push(`**原判断**: ${origLabel} (${finding.probRange[0]}%-${finding.probRange[1]}%) [${finding.sourceGrade}]`);
    lines.push('');
    lines.push(`**🤔 反方 (Devil's Advocate)**: ${dvLabel} (${dv.probRange[0]}%-${dv.probRange[1]}%)`);
    lines.push('');
    lines.push(`> ${dv.statement}`);
    lines.push('');
    if (dv.keyEvidenceRefs.length > 0) {
      lines.push('**反方引用的证据**:');
      for (const r of dv.keyEvidenceRefs) {
        const stanceLabel = r.stance === 'contradicts' ? '反驳原判断' : r.stance === 'supports' ? '支持反方' : '中性';
        const quote = r.quote ? ` — "${r.quote}"` : '';
        lines.push(`- \`${r.entityId}\` [${r.grade}] (${stanceLabel})${quote}`);
      }
    }
    return lines.join('\n');
  }

  /** Best-effort detection of the WeChat media root (Mac-only, xwechat_files layout). */
  private autoDetectMediaRoot(): string {
    const home = process.env.HOME || '';
    const base = join(home, 'Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files');
    if (!existsSync(base)) return '';
    try {
      const entries = readdirSync(base);
      for (const entry of entries) {
        if (entry === 'all_users') continue;
        const userRoot = join(base, entry);
        if (existsSync(join(userRoot, 'msg_attach')) || existsSync(join(userRoot, 'msg'))) {
          return userRoot;
        }
      }
    } catch { /* ignore */ }
    return '';
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

/** Simple text-input modal. */
class InputModal extends Modal {
  private value: string;
  private resolved = false;

  constructor(
    app: App,
    private title: string,
    private placeholder: string,
    defaultValue: string,
    private onResolve: (value: string | null) => void,
  ) {
    super(app);
    this.value = defaultValue;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h3', { text: this.title });

    new Setting(contentEl)
      .addText(text => {
        text.setPlaceholder(this.placeholder).setValue(this.value);
        text.onChange(v => { this.value = v; });
        text.inputEl.style.width = '100%';
        text.inputEl.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            this.confirm();
          }
        });
        // Auto-focus
        setTimeout(() => text.inputEl.focus(), 50);
      });

    new Setting(contentEl)
      .addButton(btn => btn.setButtonText('确定').setCta().onClick(() => this.confirm()))
      .addButton(btn => btn.setButtonText('取消').onClick(() => this.cancel()));
  }

  private confirm(): void {
    this.resolved = true;
    this.onResolve(this.value.trim() || null);
    this.close();
  }

  private cancel(): void {
    this.resolved = true;
    this.onResolve(null);
    this.close();
  }

  onClose(): void {
    if (!this.resolved) this.onResolve(null);
    this.contentEl.empty();
  }
}
