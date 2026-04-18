/**
 * Mac E2E: invoke 'insert-briefing-into-daily-note' command and verify
 * the daily note file is created/updated correctly with the briefing
 * transclusion link.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { createRequire } from 'module';
import Module from 'module';

const require = createRequire(import.meta.url);
const HOME = process.env.HOME || '';
const PLUGIN_DIR = join(HOME, 'Documents/.obsidian/plugins/wechat-obsidian-hub');
const VAULT_DIR = join(HOME, 'Documents');
const TODAY = new Date().toISOString().slice(0, 10);
const DAILY_NOTE_PATH = join(VAULT_DIR, `${TODAY}.md`);

const capturedCommands = new Map();
class MockPlugin {
  constructor() { this.app = mockApp; this.manifest = { dir: '.obsidian/plugins/wechat-obsidian-hub' }; }
  async loadData() { const p = join(PLUGIN_DIR, 'data.json'); return existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : {}; }
  async saveData(d) { writeFileSync(join(PLUGIN_DIR, 'data.json'), JSON.stringify(d, null, 2)); }
  addCommand(c) { capturedCommands.set(c.id, c); }
  addSettingTab() {}
  registerEvent() {}
}
class MockNotice { constructor(m) { console.log('[Notice]', m); } }
class MockSetting { setName() { return this; } setDesc() { return this; } addText() { return this; } addToggle() { return this; } addDropdown() { return this; } addSlider() { return this; } addButton() { return this; } setDisabled() { return this; } }
class MockModal { constructor(app){this.app=app;this.contentEl={empty:()=>{},createEl:()=>({style:{},createEl:()=>({})})};} open(){} close(){} onOpen(){} onClose(){} }

const mockApp = {
  vault: {
    adapter: {
      basePath: VAULT_DIR,
      exists: async (p) => existsSync(join(VAULT_DIR, p)),
      list: async (folder) => {
        const full = join(VAULT_DIR, folder);
        if (!existsSync(full)) return { files: [], folders: [] };
        const entries = readdirSync(full);
        return {
          files: entries.filter(e => statSync(join(full, e)).isFile()).map(e => `${folder}/${e}`),
          folders: entries.filter(e => statSync(join(full, e)).isDirectory()).map(e => `${folder}/${e}`),
        };
      },
    },
    createFolder: async (folder) => mkdirSync(join(VAULT_DIR, folder), { recursive: true }),
    create: async (path, content) => {
      const full = join(VAULT_DIR, path);
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, content, 'utf-8');
      return { path };
    },
    modify: async (file, content) => writeFileSync(join(VAULT_DIR, file.path || file), content, 'utf-8'),
    read: async (file) => readFileSync(join(VAULT_DIR, file.path || file), 'utf-8'),
    getAbstractFileByPath: (p) => existsSync(join(VAULT_DIR, p)) ? { path: p } : null,
  },
  workspace: { on: () => ({ unsubscribe: () => {} }) },
  commands: { executeCommandById: () => {} },
};
const obsidianMock = { Plugin: MockPlugin, PluginSettingTab: class {}, Notice: MockNotice, Setting: MockSetting, Modal: MockModal, App: class {}, normalizePath: p => p };
const orig = Module._resolveFilename;
Module._resolveFilename = function(r, ...a) { if (r === 'obsidian') return '__o__'; return orig.call(this, r, ...a); };
require.cache['__o__'] = { id: '__o__', filename: '__o__', loaded: true, exports: obsidianMock };

const PluginClass = require(join(PLUGIN_DIR, 'main.js')).default || require(join(PLUGIN_DIR, 'main.js'));
const inst = new PluginClass();
await inst.onload();

console.log(`Today: ${TODAY}`);
console.log(`Daily note path: ${DAILY_NOTE_PATH}`);

// Pre-existing user content to verify preservation
const PREEXISTING = `# ${TODAY}\n\n## 个人日记\n今天有点累。\n\n- TODO: 跑步\n`;
writeFileSync(DAILY_NOTE_PATH, PREEXISTING, 'utf-8');
console.log('>>> Pre-seeded daily note with personal content');

const cmd = capturedCommands.get('insert-briefing-into-daily-note');
if (!cmd) { console.error('command missing'); process.exit(1); }

// First insertion
console.log('>>> First insertion');
await cmd.callback();
const v1 = readFileSync(DAILY_NOTE_PATH, 'utf-8');

// Second insertion (should replace, not duplicate)
console.log('>>> Second insertion (idempotency check)');
await cmd.callback();
const v2 = readFileSync(DAILY_NOTE_PATH, 'utf-8');

// Verify
const beginCount = (v2.match(/OWH-briefing-begin/g) || []).length;
const transclusionMatches = v2.match(/!\[\[WeChat-Briefings\/[^\]]+\]\]/g) || [];

console.log('\n=== VERIFICATION ===');
console.log(`Pre-existing "## 个人日记" preserved: ${v2.includes('## 个人日记') ? 'YES ✅' : 'NO ❌'}`);
console.log(`Pre-existing "TODO: 跑步" preserved: ${v2.includes('TODO: 跑步') ? 'YES ✅' : 'NO ❌'}`);
console.log(`Briefing transclusion present: ${transclusionMatches.length > 0 ? `YES ✅ (${transclusionMatches[0]})` : 'NO ❌'}`);
console.log(`OWH-briefing-begin marker count: ${beginCount} ${beginCount === 1 ? '✅ idempotent' : '❌ duplicated!'}`);

// Show last 30 lines of the daily note for visual confirmation
console.log('\n=== DAILY NOTE PREVIEW ===');
console.log(v2);
