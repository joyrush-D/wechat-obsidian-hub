/**
 * Standalone test of the plugin's actual compiled JavaScript logic.
 * Mocks the Obsidian API and runs the same code path as in Obsidian.
 *
 * Usage on Mac: /opt/homebrew/bin/node scripts/test-plugin-logic.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOME = process.env.HOME || '';
const PLUGIN_DIR = join(HOME, 'Documents/.obsidian/plugins/wechat-obsidian-hub');
const VAULT_DIR = join(HOME, 'Documents');
const OUTPUT_FOLDER = 'WeChat-Briefings';
const TODAY = new Date().toISOString().slice(0, 10);

// Mock Obsidian module
const obsidianMock = {
  Plugin: class {
    constructor() { this.app = mockApp; this.manifest = { dir: '.obsidian/plugins/wechat-obsidian-hub' }; }
    async loadData() {
      const dataPath = join(PLUGIN_DIR, 'data.json');
      return existsSync(dataPath) ? JSON.parse(readFileSync(dataPath, 'utf-8')) : {};
    }
    async saveData(d) { writeFileSync(join(PLUGIN_DIR, 'data.json'), JSON.stringify(d, null, 2)); }
    addCommand() {}
    addSettingTab() {}
  },
  PluginSettingTab: class {},
  Notice: class { constructor(msg) { console.log('[Notice]', msg); } },
  normalizePath: p => p,
};

const mockApp = {
  vault: {
    adapter: {
      basePath: VAULT_DIR,
      exists: async (p) => existsSync(join(VAULT_DIR, p)),
    },
    createFolder: async (folder) => mkdirSync(join(VAULT_DIR, folder), { recursive: true }),
    create: async (path, content) => writeFileSync(join(VAULT_DIR, path), content, 'utf-8'),
    modify: async (file, content) => writeFileSync(join(VAULT_DIR, file.path || file), content, 'utf-8'),
    getAbstractFileByPath: (p) => existsSync(join(VAULT_DIR, p)) ? { path: p } : null,
  },
  commands: { executeCommandById: () => {} },
};

// Inject obsidian mock into require cache
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
require.cache[require.resolve.paths('obsidian')?.[0] + '/obsidian'] = { exports: obsidianMock };

// Hack: monkey-patch module loading for "obsidian"
const Module = require('module');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function(request, ...args) {
  if (request === 'obsidian') return 'obsidian-mock';
  return originalResolve.call(this, request, ...args);
};
require.cache['obsidian-mock'] = { exports: obsidianMock, loaded: true, id: 'obsidian-mock' };

// Load the plugin
console.log(`Loading plugin from ${join(PLUGIN_DIR, 'main.js')}...`);
const plugin = require(join(PLUGIN_DIR, 'main.js'));
const PluginClass = plugin.default || plugin;

const instance = new PluginClass();

// Run the briefing generation
async function runTest() {
  await instance.onload?.();
  console.log('\n=== Plugin loaded ===');
  console.log(`Settings:`, instance.settings);

  // Manually call the briefing generation method
  console.log('\n=== Running generateBriefing... ===');

  // Find the generate-briefing command callback
  // Since we mocked addCommand, we need to capture commands during onload
  // Let's just call the methods directly
  if (typeof instance.loadAndParseMessages === 'function') {
    const messages = await instance.loadAndParseMessages();
    console.log(`Loaded ${messages.length} parsed messages`);

    if (messages.length === 0) {
      console.log('METRIC:0 (no messages)');
      return;
    }

    // Sample
    console.log('\nFirst 3 messages:');
    for (const m of messages.slice(0, 3)) {
      console.log(`  [${m.time.toTimeString().slice(0,5)}] ${m.sender} (${m.conversationName}): ${m.text.slice(0, 80)}`);
    }

    // Run AI generation
    const { LlmClient } = require(join(PLUGIN_DIR, 'main.js'));
    // We need to access internal classes - they're not exported from main.js bundle
    // So just check the message reading worked

    const briefingPath = join(VAULT_DIR, OUTPUT_FOLDER, `${TODAY}.md`);
    if (existsSync(briefingPath)) {
      const size = readFileSync(briefingPath).length;
      console.log(`METRIC:${size} (briefing already exists)`);
    } else {
      console.log('METRIC:0 (no briefing file - need to trigger via Obsidian)');
    }
  } else {
    console.log('METRIC:0 (loadAndParseMessages not exposed)');
  }
}

runTest().catch(e => {
  console.error('ERROR:', e.stack || e.message);
  console.log('METRIC:0');
});
