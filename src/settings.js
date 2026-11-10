"use strict";

const { PluginSettingTab, Setting, Notice } = require("obsidian");
const { hostname } = require("node:os");
const { t } = require("./i18n.js");
const { DEFAULT_SETTINGS } = require("./views/shared.js");

class MyGitSettings extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl } = this; const p = this.plugin;
    containerEl.empty();
    new Setting(containerEl).setName(t("界面语言")).addDropdown((input) => input.addOptions({ zh: "简体中文", en: "English" }).setValue(p.settings.language).onChange(async (value) => {
      if (await p.updateSetting("language", value)) this.display();
    }));
    new Setting(containerEl).setName(t("Git 路径")).setDesc(t("留空自动检测。仅当本机 Git 不在 PATH 中时填写 Git 可执行文件的完整路径。")).addText((input) => input.setPlaceholder(t("自动检测")).setValue(p.settings.gitPath).onChange((value) => p.updateSetting("gitPath", value.trim())));
    new Setting(containerEl).setName(t("拉取方式")).setDesc(t("默认 rebase，遇到冲突会停下，解决后继续。")).addDropdown((input) => input.addOptions({ rebase: "Rebase", merge: "Merge" }).setValue(p.settings.pullMethod).onChange((value) => p.updateSetting("pullMethod", value)));
    const preview = new Setting(containerEl).setName(t("提交说明前缀")).setDesc(t("支持 {{date}} 和 {{hostname}}；提交时自动加在手写说明前。留空关闭前缀。"));
    const updatePreview = () => preview.setDesc(t`支持 {{date}} 和 {{hostname}}；提交时自动加在手写说明前，留空关闭。预览：${p.commitMessage(t("修改笔记"))}`);
    for (const [key, name, placeholder, desc] of [
      ["commitMessage", t("提交说明前缀"), DEFAULT_SETTINGS.commitMessage, ""],
      ["commitDateFormat", t("提交时间格式"), DEFAULT_SETTINGS.commitDateFormat, t("使用 Moment 格式，例如 YYYY-MM-DD HH:mm:ss。")],
      ["hostname", t("主机名"), hostname(), t("留空自动读取当前电脑名称；迁移后自动使用新电脑名称。")],
    ]) {
      const setting = key === "commitMessage" ? preview : new Setting(containerEl).setName(name).setDesc(desc);
      setting.addText((input) => input.setPlaceholder(placeholder).setValue(p.settings[key]).onChange(async (value) => {
        await p.updateSetting(key, key === "hostname" ? value.trim() : value);
        updatePreview();
      }));
    }
    updatePreview();
    for (const [key, name, min, max] of [["refreshSeconds", t("刷新间隔（秒）"), 1, 300], ["historyLimit", t("历史加载条数"), 10, 1000]]) {
      new Setting(containerEl).setName(name).addText((input) => {
        input.inputEl.type = "number"; input.inputEl.min = String(min); input.inputEl.max = String(max);
        input.setValue(String(p.settings[key])).onChange((value) => p.updateSetting(key, Math.max(min, Math.min(max, Number(value) || DEFAULT_SETTINGS[key]))));
      });
    }
    new Setting(containerEl).setName(t("启动时打开侧栏")).addToggle((input) => input.setValue(p.settings.openOnStartup).onChange((value) => p.updateSetting("openOnStartup", value)));
    const tracking = new Setting(containerEl).setName(t("配置文件版本管理")).setDesc(t("检查 data.json 是否被 Git 忽略…"));
    void p.ensureReady().then(() => p.git.settingsTracking()).then((state) => {
      tracking.setDesc(state.tracked ? t("data.json 已在 Git 中，修改后会显示为未暂存。") : state.ignored ? t("data.json 被 .gitignore 忽略，修改不会显示在文件列表。") : t("data.json 可加入 Git。请在文件列表中暂存并提交。"));
      if (state.ignored && !state.tracked) tracking.addButton((input) => input.setButtonText(t("允许追踪")).onClick(async () => {
        if (await p.mutate(t("允许配置追踪"), () => p.git.enableSettingsTracking())) this.display();
      }));
    }).catch((error) => tracking.setDesc(error.message));
    new Setting(containerEl).setName(t("检查 Git")).setDesc(t("插件和 data.json 可随笔记库迁移。新电脑需要安装 Git，并配置提交身份和 SSH / HTTPS 凭据。")).addButton((input) => input.setButtonText(t("检查")).onClick(async () => {
      try { new Notice((await p.git.run(["--version"])).trim()); } catch (error) { new Notice(error.message, 8000); }
    }));
    new Setting(containerEl).setName(t("其他")).setHeading();
    new Setting(containerEl).setName(t("日期触发字符串")).setDesc(t("在笔记中输入此字符串后自动替换为当前日期时间。留空关闭；前面须为空格或行首。")).addText((input) => input.setPlaceholder("@date").setValue(p.settings.dateTrigger).onChange((value) => p.updateSetting("dateTrigger", value.trim())));
    const datePreview = new Setting(containerEl).setName(t("日期时间格式"));
    const showDatePreview = () => datePreview.setDesc(t`Moment 格式；固定文字用方括号包住，例如 [Time:] YYYY-MM-DD HH:mm:ss。预览：${p.formatDate()}`);
    datePreview.addText((input) => input.setPlaceholder(DEFAULT_SETTINGS.dateFormat).setValue(p.settings.dateFormat).onChange(async (value) => { await p.updateSetting("dateFormat", value); showDatePreview(); }));
    showDatePreview();
    new Setting(containerEl).setName(t("插入日期时间快捷键")).setDesc(t("为 VaultBranch 的“插入当前日期时间”命令设置快捷键。")).addButton((input) => input.setButtonText(t("配置快捷键")).onClick(() => {
      this.app.setting.openTabById("hotkeys");
      const tab = this.app.setting.activeTab;
      if (typeof tab?.setQuery === "function") tab.setQuery(`${p.manifest.name}: ${t("插入当前日期时间")}`);
    }));
    new Setting(containerEl).setName("Diff autosave").setDesc(t("默认关闭。开启后停止输入 500 ms 自动保存；关闭时按 Ctrl/Cmd+S 或点击保存。切换文件保留草稿，Git 操作前请先保存。")).addToggle((input) => input.setValue(p.settings.diffAutosave).onChange((value) => p.updateSetting("diffAutosave", value)));
  }
}

module.exports = { MyGitSettings };
