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
      .setDesc('64位十六进制 SQLCipher 密钥。留空则点击"解密"时自动从微信进程提取。')
      .addText(text => text
        .setPlaceholder('留空 = 自动提取（需要微信已重签名）')
        .setValue(this.plugin.settings.decryptKeyHex)
        .onChange(async (value) => {
          this.plugin.settings.decryptKeyHex = value.trim();
          await this.plugin.saveSettings();
        }));

    // First-time setup hint
    const hintEl = containerEl.createEl('div', { cls: 'setting-item-description' });
    hintEl.style.marginTop = '-10px';
    hintEl.style.marginBottom = '12px';
    hintEl.style.fontSize = '12px';
    hintEl.style.padding = '8px';
    hintEl.style.background = 'var(--background-modifier-form-field)';
    hintEl.style.borderRadius = '4px';
    hintEl.innerHTML = `<strong>首次使用前：</strong>需要在终端执行一次微信重签名，否则无法自动提取密钥：<br>
<code>sudo codesign --force --deep --sign - /Applications/WeChat.app</code><br>
然后重启微信。此操作不影响微信正常使用。`;

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

    // --- Section: Multimodal (v0.3.0) ---
    containerEl.createEl('h3', { text: '多模态处理（语音 / 图片）' });

    const mmHint = containerEl.createEl('div', { cls: 'setting-item-description' });
    mmHint.style.marginBottom = '12px';
    mmHint.style.padding = '8px';
    mmHint.style.fontSize = '12px';
    mmHint.style.background = 'var(--background-modifier-form-field)';
    mmHint.style.borderRadius = '4px';
    mmHint.innerHTML = `<strong>首次使用前需安装:</strong><br>
<code>brew install whisper-cpp ffmpeg</code> — 语音转写<br>
<code>brew tap kn007/silk-v3-decoder && brew install silk-v3-decoder</code> — .silk 解码<br>
然后下载模型并启动服务：<br>
<code>bash scripts/start-whisper-server.sh</code><br>
图片 OCR 推荐 <a href="https://github.com/hiroi-sora/RapidOCR-json">RapidOCR-json</a>，VLM 在 LM Studio 里加载 <code>qwen2.5-vl-7b</code> 即可。`;

    // Voice transcription
    containerEl.createEl('h4', { text: '语音转写 (Whisper)' });
    new Setting(containerEl)
      .setName('启用语音转写')
      .setDesc('默认关闭。开启后，简报里的语音消息会显示转写文字')
      .addToggle(t => t.setValue(this.plugin.settings.enableVoiceTranscription).onChange(async v => {
        this.plugin.settings.enableVoiceTranscription = v;
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl)
      .setName('Whisper 服务地址')
      .setDesc('whisper.cpp server 的 HTTP 端点')
      .addText(t => t.setPlaceholder('http://localhost:8081').setValue(this.plugin.settings.whisperEndpoint).onChange(async v => {
        this.plugin.settings.whisperEndpoint = v.trim();
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl)
      .setName('语音语言')
      .setDesc('ISO 639-1 代码，中文用 zh')
      .addText(t => t.setPlaceholder('zh').setValue(this.plugin.settings.whisperLanguage).onChange(async v => {
        this.plugin.settings.whisperLanguage = v.trim() || 'zh';
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl)
      .setName('测试 Whisper 连接')
      .addButton(b => b.setButtonText('测试').onClick(async () => {
        try {
          const resp = await fetch(`${this.plugin.settings.whisperEndpoint}/health`);
          new Notice(resp.ok ? 'Whisper 连接成功' : `Whisper 失败: HTTP ${resp.status}`, 5000);
        } catch (e) {
          new Notice(`Whisper 连接失败: ${(e as Error).message}`, 5000);
        }
      }));

    // Image analysis
    containerEl.createEl('h4', { text: '图片分析 (OCR + VLM)' });
    new Setting(containerEl)
      .setName('启用 OCR（截图文字抽取）')
      .setDesc('适合聊天截图、文档截图；速度快（~0.2s/张）')
      .addToggle(t => t.setValue(this.plugin.settings.enableImageOcr).onChange(async v => {
        this.plugin.settings.enableImageOcr = v;
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl)
      .setName('启用 VLM（生活照 / 表情包描述）')
      .setDesc('适合照片、海报、表情包；速度较慢（~3s/张），需要 LM Studio 加载 VLM 模型')
      .addToggle(t => t.setValue(this.plugin.settings.enableImageVlm).onChange(async v => {
        this.plugin.settings.enableImageVlm = v;
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl)
      .setName('OCR 服务地址')
      .setDesc('RapidOCR-json 等兼容 /ocr 端点的 HTTP 服务')
      .addText(t => t.setPlaceholder('http://localhost:8090').setValue(this.plugin.settings.ocrEndpoint).onChange(async v => {
        this.plugin.settings.ocrEndpoint = v.trim();
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl)
      .setName('VLM 服务地址')
      .setDesc('留空则复用上面的"AI 服务地址" (LM Studio)')
      .addText(t => t.setPlaceholder('留空 = 同 AI 服务地址').setValue(this.plugin.settings.vlmEndpoint).onChange(async v => {
        this.plugin.settings.vlmEndpoint = v.trim();
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl)
      .setName('VLM 模型名')
      .setDesc('LM Studio 中加载的视觉模型 ID，留空则 LM Studio 自动选择')
      .addText(t => t.setPlaceholder('qwen2.5-vl-7b 或留空').setValue(this.plugin.settings.vlmModel).onChange(async v => {
        this.plugin.settings.vlmModel = v.trim();
        await this.plugin.saveSettings();
      }));

    // Shared
    containerEl.createEl('h4', { text: '共享设置' });
    new Setting(containerEl)
      .setName('媒体缓存目录')
      .setDesc('转写和图片分析结果的缓存路径（避免重复处理同一段内容）')
      .addText(t => t.setPlaceholder(join(process.env.HOME || '', '.wechat-hub/media-cache')).setValue(this.plugin.settings.mediaCacheDir).onChange(async v => {
        this.plugin.settings.mediaCacheDir = v.trim();
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl)
      .setName('微信媒体根目录（原始语音/图片文件）')
      .setDesc('留空则自动检测 ~/Library/Containers/com.tencent.xinWeChat/.../xwechat_files/<user>/')
      .addText(t => t.setPlaceholder('留空 = 自动检测').setValue(this.plugin.settings.wechatMediaRoot).onChange(async v => {
        this.plugin.settings.wechatMediaRoot = v.trim();
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
