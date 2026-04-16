import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import type OWHPlugin from './main';

/**
 * Auto-detect WeChat data directory on macOS.
 * WeChat 4.x stores data at:
 *   ~/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/<user>/db_storage/
 */
function autoDetectWeChatDbDir(): string | null {
  const home = process.env.HOME || '';
  const base = join(home, 'Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files');
  if (!existsSync(base)) return null;

  try {
    const entries = readdirSync(base);
    for (const entry of entries) {
      if (entry === 'all_users') continue;
      const dbStorage = join(base, entry, 'db_storage');
      if (existsSync(dbStorage)) {
        const contactDb = join(dbStorage, 'contact', 'contact.db');
        const messageDb = join(dbStorage, 'message', 'message_0.db');
        if (existsSync(contactDb) && existsSync(messageDb)) {
          return dbStorage;
        }
      }
    }
  } catch { /* ignore */ }
  return null;
}

export class OWHSettingTab extends PluginSettingTab {
  plugin: OWHPlugin;

  constructor(app: App, plugin: OWHPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'WeChat Obsidian Hub 设置' });

    // --- Section: Database ---
    containerEl.createEl('h3', { text: '数据库' });

    // Auto-detect status
    const detected = autoDetectWeChatDbDir();
    const currentDir = this.plugin.settings.decryptedDbDir;

    if (detected && !currentDir) {
      // Auto-fill on first use
      this.plugin.settings.wechatDataDir = detected;
    }

    const dbDesc = detected
      ? `已检测到微信数据目录：${detected}\n⚠️ 注意：原始数据库是加密的，需要先解密才能使用。`
      : '未检测到微信数据目录。请确认 Mac 版微信已登录。';

    // Decrypted DB directory
    new Setting(containerEl)
      .setName('解密后的数据库目录')
      .setDesc('解密后的 SQLite 数据库存放路径（包含 contact.db、message_0.db）')
      .addText(text => text
        .setPlaceholder(join(process.env.HOME || '~', '.wechat-hub/decrypted'))
        .setValue(this.plugin.settings.decryptedDbDir)
        .onChange(async (value) => {
          this.plugin.settings.decryptedDbDir = value.trim();
          await this.plugin.saveSettings();
        }));

    // Auto-detect info
    const infoEl = containerEl.createEl('div', { cls: 'setting-item-description' });
    infoEl.style.marginTop = '-10px';
    infoEl.style.marginBottom = '12px';
    infoEl.style.fontSize = '12px';
    infoEl.style.color = detected ? 'var(--text-muted)' : 'var(--text-error)';
    infoEl.textContent = dbDesc;

    // WeChat original data dir (auto-detected, read-only display)
    if (detected) {
      new Setting(containerEl)
        .setName('微信原始数据目录（自动检测）')
        .setDesc(detected)
        .setDisabled(true);
    }

    // Decrypt key
    new Setting(containerEl)
      .setName('解密密钥')
      .setDesc('64位十六进制 SQLCipher 密钥。可通过 wechat-decrypt 工具获取。')
      .addText(text => text
        .setPlaceholder('留空则需要先手动运行解密脚本')
        .setValue(this.plugin.settings.decryptKeyHex)
        .onChange(async (value) => {
          this.plugin.settings.decryptKeyHex = value.trim();
          await this.plugin.saveSettings();
        }));

    // Decrypt mode
    new Setting(containerEl)
      .setName('解密模式')
      .setDesc('手动 = 你自己控制何时刷新解密；自动 = 每次生成简报前自动解密最新数据')
      .addDropdown(drop => drop
        .addOption('manual', '手动解密')
        .addOption('auto', '自动解密（生成简报时）')
        .setValue(this.plugin.settings.decryptMode)
        .onChange(async (value) => {
          this.plugin.settings.decryptMode = value as 'manual' | 'auto';
          await this.plugin.saveSettings();
        }));

    // Manual decrypt button
    new Setting(containerEl)
      .setName('立即解密')
      .setDesc('手动触发一次数据库解密（需要已配置密钥）')
      .addButton(button => button
        .setButtonText('解密')
        .onClick(async () => {
          (this.app as any).commands.executeCommandById('wechat-obsidian-hub:decrypt-databases');
        }));

    // Test connection button
    new Setting(containerEl)
      .setName('测试数据库连接')
      .setDesc('验证能否正确读取解密后的数据库')
      .addButton(button => button
        .setButtonText('测试连接')
        .onClick(async () => {
          (this.app as any).commands.executeCommandById('wechat-obsidian-hub:test-db-connection');
        }));

    // --- Section: AI ---
    containerEl.createEl('h3', { text: 'AI 模型' });

    new Setting(containerEl)
      .setName('AI 服务地址')
      .setDesc('LM Studio 或 OpenAI 兼容的 API 地址')
      .addText(text => text
        .setPlaceholder('http://localhost:1234/v1')
        .setValue(this.plugin.settings.aiEndpoint)
        .onChange(async (value) => {
          this.plugin.settings.aiEndpoint = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('模型名称')
      .setDesc('留空则自动使用 LM Studio 当前加载的模型')
      .addText(text => text
        .setPlaceholder('自动检测')
        .setValue(this.plugin.settings.aiModel)
        .onChange(async (value) => {
          this.plugin.settings.aiModel = value.trim();
          await this.plugin.saveSettings();
        }));

    // Test AI connection
    new Setting(containerEl)
      .setName('测试 AI 连接')
      .setDesc('检查 LM Studio 是否在运行并已加载模型')
      .addButton(button => button
        .setButtonText('测试')
        .onClick(async () => {
          try {
            const resp = await fetch(`${this.plugin.settings.aiEndpoint}/models`);
            if (resp.ok) {
              const data = await resp.json();
              const models = data.data?.map((m: any) => m.id).join(', ') || '无';
              new Notice(`AI 连接成功！已加载模型: ${models}`, 5000);
            } else {
              new Notice(`AI 连接失败: HTTP ${resp.status}`);
            }
          } catch (e) {
            new Notice(`AI 连接失败: ${(e as Error).message}\n请确认 LM Studio 已启动`);
          }
        }));

    // --- Section: Briefing ---
    containerEl.createEl('h3', { text: '简报设置' });

    new Setting(containerEl)
      .setName('简报存放文件夹')
      .setDesc('生成的简报笔记保存在 Vault 的哪个文件夹')
      .addText(text => text
        .setPlaceholder('WeChat-Briefings')
        .setValue(this.plugin.settings.briefingFolder)
        .onChange(async (value) => {
          this.plugin.settings.briefingFolder = value.trim() || 'WeChat-Briefings';
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('消息时间范围（小时）')
      .setDesc(`简报包含最近多少小时的消息（当前: ${this.plugin.settings.briefingTimeRangeHours}小时）`)
      .addSlider(slider => slider
        .setLimits(1, 72, 1)
        .setValue(this.plugin.settings.briefingTimeRangeHours)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.briefingTimeRangeHours = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('过滤表情消息')
      .setDesc('简报中排除纯表情/贴纸消息')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.skipEmoji)
        .onChange(async (value) => {
          this.plugin.settings.skipEmoji = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('过滤系统消息')
      .setDesc('排除入群/退群/改名等系统通知')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.skipSystemMessages)
        .onChange(async (value) => {
          this.plugin.settings.skipSystemMessages = value;
          await this.plugin.saveSettings();
        }));

    // --- Quick Actions ---
    containerEl.createEl('h3', { text: '快速操作' });

    new Setting(containerEl)
      .setName('生成简报')
      .setDesc('立即根据当前设置生成微信消息简报')
      .addButton(button => button
        .setButtonText('生成简报')
        .setCta()
        .onClick(async () => {
          (this.app as any).commands.executeCommandById('wechat-obsidian-hub:generate-briefing');
        }));
  }
}
