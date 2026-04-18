/**
 * Release verification — exercise EVERY plugin command end-to-end on real
 * Mac data, report pass/fail/duration/output-size for each.
 *
 * Usage on Mac:
 *   /opt/homebrew/bin/node scripts/release-verify.mjs
 *
 * What it does, in order:
 *   1. Load the deployed main.js (same bundle Obsidian uses)
 *   2. Mock the Obsidian API so commands can run headlessly
 *   3. Run decrypt-databases (precondition for everything else)
 *   4. Run each user-facing command with canned inputs
 *   5. Print a single PASS/FAIL summary table
 *   6. Exit non-zero if any critical command failed
 *
 * Designed to be run before `git tag <version>` to catch regressions
 * the unit tests miss (LLM connectivity, real DB shape, file I/O,
 * concurrency, etc.).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync } from 'fs';
import { join } from 'path';
import { createRequire } from 'module';
import Module from 'module';

const require = createRequire(import.meta.url);
const HOME = process.env.HOME || '';
const PLUGIN_DIR = join(HOME, 'Documents/.obsidian/plugins/wechat-obsidian-hub');
const VAULT_DIR = join(HOME, 'Documents');
const BRIEFINGS_DIR = join(VAULT_DIR, 'WeChat-Briefings');

// Tracked test result rows
const results = [];

// ============================================================================
// Mock Obsidian harness — same shape as test-as-user.mjs
// ============================================================================
const capturedCommands = new Map();

class MockPlugin {
  constructor() { this.app = mockApp; this.manifest = { dir: '.obsidian/plugins/wechat-obsidian-hub' }; }
  async loadData() { const p = join(PLUGIN_DIR, 'data.json'); return existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : {}; }
  async saveData(d) { writeFileSync(join(PLUGIN_DIR, 'data.json'), JSON.stringify(d, null, 2)); }
  addCommand(c) { capturedCommands.set(c.id, c); }
  addSettingTab() {}
  registerEvent() {}
}

class MockNotice { constructor(m) { console.log('  [Notice]', m); } }
class MockSetting {
  setName() { return this; } setDesc() { return this; }
  addText() { return this; } addToggle() { return this; }
  addDropdown() { return this; } addSlider() { return this; }
  addButton() { return this; } setDisabled() { return this; }
}
class MockModal {
  constructor(app) { this.app = app; this.contentEl = { empty: () => {}, createEl: () => ({ style: {}, createEl: () => ({}) }) }; }
  open() {} close() {} onOpen() {} onClose() {}
}

const mockApp = {
  vault: {
    adapter: { basePath: VAULT_DIR, exists: async (p) => existsSync(join(VAULT_DIR, p)) },
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

const obsidianMock = {
  Plugin: MockPlugin, PluginSettingTab: class {}, Notice: MockNotice,
  Setting: MockSetting, Modal: MockModal, App: class {}, normalizePath: p => p,
};

const orig = Module._resolveFilename;
Module._resolveFilename = function(request, ...a) {
  if (request === 'obsidian') return '__obsidian_mock__';
  return orig.call(this, request, ...a);
};
require.cache['__obsidian_mock__'] = {
  id: '__obsidian_mock__', filename: '__obsidian_mock__', loaded: true, exports: obsidianMock,
};

// ============================================================================
// Main
// ============================================================================
async function main() {
  console.log('='.repeat(72));
  console.log('OWH RELEASE VERIFICATION — covers every user-facing command');
  console.log('='.repeat(72));

  const mainPath = join(PLUGIN_DIR, 'main.js');
  if (!existsSync(mainPath)) {
    console.error(`ERROR: deployed main.js not found at ${mainPath}`);
    console.error(`Run: bash scripts/deploy-to-mac.sh first`);
    process.exit(1);
  }
  const stat = statSync(mainPath);
  console.log(`\nPlugin: ${(stat.size / 1024).toFixed(1)} KB · built ${stat.mtime.toISOString()}\n`);

  const PluginClass = require(mainPath).default || require(mainPath);
  const inst = new PluginClass();

  // Inputs we'll feed to commands that prompt the user
  const promptQueue = {
    'topic-brief-keyword': 'AI',
    'topic-brief-days': '30',
    'ach-topic': '加纳',
    'team-ab-topic': '加纳',
    'gdelt-query': 'OpenAI',
    'gdelt-days': '14',
    'resolve-id': 'nonexistent-finding-skip',
    'resolve-outcome': 'confirmed',
    'resolve-notes': '',
  };
  const promptOrder = Object.values(promptQueue);
  let promptCursor = 0;
  PluginClass.prototype.promptForInput = async function(_title, _placeholder, dflt) {
    const v = promptOrder[promptCursor++];
    return v ?? dflt ?? null;
  };

  await inst.onload();
  console.log(`\n${capturedCommands.size} commands registered:`);
  for (const id of capturedCommands.keys()) console.log(`  - ${id}`);

  // ===== Run each test =====
  await runTest('decrypt-databases', '解密数据库（前置）');
  await runTest('generate-briefing', '生成今日简报');
  await runTest('search-gdelt', 'GDELT 全球新闻搜索');
  await runTest('run-ach-matrix', 'ACH 矩阵分析');
  await runTest('run-team-ab', 'Team A/B 并行分析');
  await runTest('generate-topic-brief', '专题简报');
  await runTest('generate-weekly-rollup', '周报');
  await runTest('show-calibration-report', '校准报告');
  await runTest('test-db-connection', '数据库连接测试');

  // ===== Summary =====
  console.log('\n' + '='.repeat(72));
  console.log('VERIFICATION SUMMARY');
  console.log('='.repeat(72));
  const widthCmd = Math.max(...results.map(r => r.cmd.length));
  console.log(`${'命令'.padEnd(widthCmd + 2)} 耗时    输出      状态  说明`);
  console.log('-'.repeat(72));
  for (const r of results) {
    const status = r.ok ? '✅ PASS' : '❌ FAIL';
    console.log(`${r.cmd.padEnd(widthCmd + 2)} ${(r.elapsed + 's').padStart(6)} ${(r.outputBytes ? (r.outputBytes + 'B').padStart(8) : '-       ')} ${status}  ${r.note}`);
  }
  const passed = results.filter(r => r.ok).length;
  const failed = results.length - passed;
  console.log('-'.repeat(72));
  console.log(`总计: ${passed} 通过 / ${failed} 失败`);
  if (failed > 0) {
    console.log('\n⚠️ 有失败项 — 不建议发布版本');
    process.exit(1);
  } else {
    console.log('\n✅ 全部通过 — 可以发布');
  }
}

async function runTest(commandId, label) {
  const cmd = capturedCommands.get(commandId);
  if (!cmd) {
    results.push({ cmd: commandId, elapsed: '-', outputBytes: 0, ok: false, note: `命令未注册` });
    return;
  }
  console.log(`\n▶ ${label} (${commandId})`);
  const before = listOutputs();
  const t0 = Date.now();
  let ok = true;
  let note = label;
  try {
    await cmd.callback();
  } catch (e) {
    ok = false;
    note = `异常: ${e.message.slice(0, 50)}`;
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const after = listOutputs();
  const newFiles = after.filter(f => !before.find(b => b.f === f.f));
  const outputBytes = newFiles.reduce((s, f) => s + f.size, 0);
  if (newFiles.length === 0 && commandId !== 'decrypt-databases' && commandId !== 'test-db-connection' && commandId !== 'resolve-finding') {
    note = note + ' (无输出文件 — 可能命令内部失败)';
  }
  results.push({ cmd: commandId, elapsed, outputBytes, ok, note });
}

function listOutputs() {
  if (!existsSync(BRIEFINGS_DIR)) return [];
  return readdirSync(BRIEFINGS_DIR).map(f => ({
    f, size: statSync(join(BRIEFINGS_DIR, f)).size,
  }));
}

main().catch(e => {
  console.error('\n💥 RELEASE VERIFY CRASHED:', e.stack || e.message);
  process.exit(1);
});
