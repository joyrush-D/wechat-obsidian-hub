export class Plugin {
  loadData() { return Promise.resolve({}); }
  saveData(_data: unknown) { return Promise.resolve(); }
  addCommand(_cmd: unknown) {}
}
export class PluginSettingTab {}
export class Notice {
  constructor(_msg: string) {}
}
