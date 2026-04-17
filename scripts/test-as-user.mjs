/**
 * Test the plugin EXACTLY as an end-user would experience it.
 * Load the REAL main.js (same bundle deployed to Obsidian),
 * mock the Obsidian API, invoke the "generate-briefing" command.
 *
 * Usage on Mac: /opt/homebrew/bin/node scripts/test-as-user.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { createRequire } from 'module';
import Module from 'module';

const require = createRequire(import.meta.url);

const HOME = process.env.HOME || '';
const PLUGIN_DIR = join(HOME, 'Documents/.obsidian/plugins/wechat-obsidian-hub');
const VAULT_DIR = join(HOME, 'Documents');
const TODAY = new Date().toISOString().slice(0, 10);

// ============================================================================
// Mock Obsidian API — matches the subset main.js uses
// ============================================================================
const capturedCommands = new Map();

class MockPlugin {
  constructor() {
    this.app = mockApp;
    this.manifest = {
      id: 'wechat-obsidian-hub',
      dir: '.obsidian/plugins/wechat-obsidian-hub',
    };
  }
  async loadData() {
    const p = join(PLUGIN_DIR, 'data.json');
    return existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : {};
  }
  async saveData(d) {
    writeFileSync(join(PLUGIN_DIR, 'data.json'), JSON.stringify(d, null, 2));
  }
  addCommand(cmd) {
    capturedCommands.set(cmd.id, cmd);
    console.log(`[mock] Plugin registered command: ${cmd.id}`);
  }
  addSettingTab() {}
  registerEvent() {}
}

class MockNotice {
  constructor(msg) {
    console.log(`[Notice] ${msg}`);
  }
}

class MockSettingTab {}
class MockSetting {
  setName() { return this; }
  setDesc() { return this; }
  addText() { return this; }
  addToggle() { return this; }
  addDropdown() { return this; }
  addSlider() { return this; }
  addButton() { return this; }
  setDisabled() { return this; }
}

class MockModal {
  constructor(app) { this.app = app; this.contentEl = { empty: () => {}, createEl: () => ({ style: {}, createEl: () => ({}) }) }; }
  open() {}
  close() {}
  onOpen() {}
  onClose() {}
}

const mockApp = {
  vault: {
    adapter: {
      basePath: VAULT_DIR,
      exists: async (p) => existsSync(join(VAULT_DIR, p)),
    },
    createFolder: async (folder) => mkdirSync(join(VAULT_DIR, folder), { recursive: true }),
    create: async (path, content) => {
      const full = join(VAULT_DIR, path);
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, content, 'utf-8');
      return { path };
    },
    modify: async (file, content) => {
      const full = join(VAULT_DIR, file.path || file);
      writeFileSync(full, content, 'utf-8');
    },
    read: async (file) => {
      const full = join(VAULT_DIR, file.path || file);
      return existsSync(full) ? readFileSync(full, 'utf-8') : '';
    },
    getAbstractFileByPath: (p) => existsSync(join(VAULT_DIR, p)) ? { path: p } : null,
  },
  workspace: {
    on: () => ({ unsubscribe: () => {} }),
  },
  commands: { executeCommandById: () => {} },
};

const obsidianMock = {
  Plugin: MockPlugin,
  PluginSettingTab: MockSettingTab,
  Notice: MockNotice,
  Setting: MockSetting,
  Modal: MockModal,
  App: class {},
  normalizePath: p => p,
};

// ============================================================================
// Inject obsidian mock into require chain
// ============================================================================
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function(request, ...args) {
  if (request === 'obsidian') return '__obsidian_mock__';
  return originalResolve.call(this, request, ...args);
};
require.cache['__obsidian_mock__'] = {
  id: '__obsidian_mock__',
  filename: '__obsidian_mock__',
  loaded: true,
  exports: obsidianMock,
};

// ============================================================================
// Run: load plugin, invoke generate-briefing exactly like user does
// ============================================================================
async function main() {
  console.log('=== Loading plugin main.js (same bundle deployed to Obsidian) ===');
  const mainPath = join(PLUGIN_DIR, 'main.js');
  if (!existsSync(mainPath)) {
    console.error(`ERROR: ${mainPath} not found`);
    process.exit(1);
  }

  const stat = statSync(mainPath);
  console.log(`Plugin build time: ${stat.mtime.toISOString()}`);
  console.log(`Plugin size: ${(stat.size / 1024).toFixed(1)} KB`);

  const pluginModule = require(mainPath);
  const PluginClass = pluginModule.default || pluginModule;
  const instance = new PluginClass();

  console.log('\n=== Calling plugin.onload() ===');
  await instance.onload();

  console.log(`\n=== Captured ${capturedCommands.size} commands ===`);
  for (const id of capturedCommands.keys()) console.log(`  - ${id}`);

  const cmd = capturedCommands.get('generate-briefing');
  if (!cmd) {
    console.error('ERROR: generate-briefing command not found');
    process.exit(1);
  }

  console.log('\n=== Invoking "Generate WeChat Briefing" (end-user flow) ===');
  const startTime = Date.now();
  await cmd.callback();
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n=== Done in ${elapsed}s ===`);

  // Check output
  const briefingsDir = join(VAULT_DIR, 'WeChat-Briefings');
  if (existsSync(briefingsDir)) {
    const { readdirSync } = await import('fs');
    const todayFiles = readdirSync(briefingsDir).filter(f => f.includes(TODAY));
    for (const f of todayFiles.slice(-3)) {
      const size = statSync(join(briefingsDir, f)).size;
      console.log(`  ${f}: ${size} bytes`);
    }
  }

  // === SECOND TEST: simulate clicking a [[WeChat-Groups/xxx]] wikilink ===
  console.log('\n=== Testing lazy group dossier population ===');
  const groupsDir = join(VAULT_DIR, 'WeChat-Groups');
  mkdirSync(groupsDir, { recursive: true });

  // Change this to a real group name from your own data when testing locally.
  // Default is left generic to avoid exposing anything specific in public repo.
  const testGroup = process.env.OWH_TEST_GROUP || '<YOUR_GROUP_NAME>';
  const dossierPath = join(groupsDir, `${testGroup}.md`);

  // Step 1: simulate Obsidian creating an empty note when user clicks wikilink
  writeFileSync(dossierPath, '', 'utf-8');
  console.log(`Created empty note: ${dossierPath}`);

  // Step 2: simulate the file-open event — call plugin's populateGroupDossier directly
  const mockFile = { path: `WeChat-Groups/${testGroup}.md`, basename: testGroup };
  const start2 = Date.now();
  await instance.populateGroupDossier(mockFile);
  const elapsed2 = ((Date.now() - start2) / 1000).toFixed(1);

  const size = statSync(dossierPath).size;
  console.log(`Dossier generated in ${elapsed2}s, ${size} bytes`);

  // Show the first 30 lines of the dossier
  console.log('\n--- DOSSIER PREVIEW ---');
  const content = readFileSync(dossierPath, 'utf-8');
  console.log(content.split('\n').slice(0, 30).join('\n'));
}

main().catch(e => {
  console.error('FAILED:', e.stack || e.message);
  process.exit(1);
});
