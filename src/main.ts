import { Plugin } from 'obsidian';
import { OWHSettings, DEFAULT_SETTINGS } from './types';

export default class OWHPlugin extends Plugin {
  settings: OWHSettings = DEFAULT_SETTINGS;

  async onload() {
    await this.loadSettings();

    this.addCommand({
      id: 'generate-briefing',
      name: 'Generate WeChat Briefing',
      callback: () => {
        console.log('OWH: Generate briefing command triggered');
      },
    });

    console.log('OWH: WeChat Obsidian Hub loaded');
  }

  onunload() {
    console.log('OWH: WeChat Obsidian Hub unloaded');
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
