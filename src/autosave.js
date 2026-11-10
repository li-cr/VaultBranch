"use strict";

const { t } = require("./i18n.js");
const normalize = (text) => text.replace(/\r\n?/g, "\n");
const conflictMessage = () => t("文件已被其他编辑器修改。自动保存已暂停，你的输入已保留。请核对文件，或放弃草稿并重新载入。");

// One session per path serializes saves and file notifications, including across views.
class Autosave {
  constructor(draft, { read, write, changed = () => {}, saved = () => {}, delay = 500, enabled = true }) {
    this.draft = draft;
    this.read = read;
    this.write = write;
    this.changed = changed;
    this.saved = saved;
    this.delay = delay;
    this.enabled = enabled;
    this.listeners = new Set();
    this.task = Promise.resolve();
    this.error = "";
    this.saving = false;
  }

  get savedText() {
    if (this.savedWorking !== this.draft.working) {
      this.savedWorking = this.draft.working;
      this.normalizedWorking = normalize(this.draft.working);
    }
    return this.normalizedWorking;
  }
  get dirty() { return this.draft.text !== this.savedText; }
  notify() { this.changed(); for (const listener of this.listeners) listener(); }
  enqueue(action) {
    const task = this.task.then(action).catch((error) => { this.error = error.message; this.notify(); return false; });
    this.task = task;
    return task;
  }
  edit(text) {
    this.draft.text = text;
    clearTimeout(this.timer);
    if (this.enabled && !this.error) this.timer = setTimeout(() => { void this.flush(); }, this.delay);
    this.notify();
  }
  setEnabled(enabled) {
    this.enabled = enabled;
    clearTimeout(this.timer);
    if (enabled && this.dirty && !this.error) this.timer = setTimeout(() => { void this.flush(); }, this.delay);
    this.notify();
  }
  autoFlush() { return this.enabled ? this.flush() : Promise.resolve(!this.dirty); }
  flush() {
    clearTimeout(this.timer);
    return this.enqueue(async () => {
      if (!this.dirty) return true;
      if (this.error) return false;
      this.saving = true;
      this.notify();
      try {
        while (this.dirty) {
          const { text, working } = this.draft;
          const versions = await this.read();
          if (versions.working !== working) throw new Error(conflictMessage());
          const crlf = working.includes("\r\n") && !/(?<!\r)\n/.test(working);
          const content = crlf ? text.replace(/\n/g, "\r\n") : text;
          if (Buffer.byteLength(content, "utf8") > 2 * 1024 * 1024) throw new Error(t("仅支持编辑 2 MB 以内的 UTF-8 文本文件。"));
          await this.write(working, content);
          this.draft.working = content;
          this.draft.index = versions.index;
          this.saved();
        }
        return true;
      } finally { this.saving = false; this.notify(); }
    });
  }
  sync() {
    this.syncAgain = true;
    if (this.syncTask) return this.syncTask;
    this.syncTask = this.enqueue(async () => {
      do {
        this.syncAgain = false;
        const versions = await this.read();
        let changed = this.draft.index !== versions.index;
        this.draft.index = versions.index;
        if (versions.working !== this.draft.working) {
          changed = true;
          if (this.dirty) this.error = conflictMessage();
          else {
            this.draft.working = versions.working;
            this.draft.text = normalize(versions.working);
            this.error = "";
          }
        }
        if (changed) this.notify();
      } while (this.syncAgain);
      return !this.error;
    }).finally(() => { this.syncTask = null; });
    return this.syncTask;
  }
  retry() { this.error = ""; return this.flush(); }
  reload() {
    clearTimeout(this.timer);
    return this.enqueue(async () => {
      const versions = await this.read();
      Object.assign(this.draft, versions, { text: normalize(versions.working) });
      this.error = "";
      this.notify();
      return true;
    });
  }
  stop() { clearTimeout(this.timer); }
}

module.exports = { Autosave, normalize, conflictMessage };
