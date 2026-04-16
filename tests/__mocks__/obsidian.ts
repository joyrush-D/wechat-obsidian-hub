export class Plugin {
  loadData() { return Promise.resolve({}); }
  saveData(_data: unknown) { return Promise.resolve(); }
  addCommand(_cmd: unknown) {}
  addSettingTab(_tab: unknown) {}
}
export class PluginSettingTab {
  containerEl: any = { empty() {}, createEl() { return {}; } };
  constructor(_app: unknown, _plugin: unknown) {}
}
export class Setting {
  constructor(_containerEl: unknown) {}
  setName(_name: string) { return this; }
  setDesc(_desc: string) { return this; }
  addText(cb: (t: any) => any) { cb({ setPlaceholder() { return this; }, setValue() { return this; }, onChange() { return this; } }); return this; }
  addToggle(cb: (t: any) => any) { cb({ setValue() { return this; }, onChange() { return this; } }); return this; }
  addSlider(cb: (t: any) => any) { cb({ setLimits() { return this; }, setValue() { return this; }, setDynamicTooltip() { return this; }, onChange() { return this; } }); return this; }
  addButton(cb: (t: any) => any) { cb({ setButtonText() { return this; }, onClick() { return this; } }); return this; }
}
export class Notice {
  constructor(_msg: string) {}
}
export class App {}
