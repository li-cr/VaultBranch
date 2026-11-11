"use strict";

const { Autosave, normalize, conflictMessage } = require("./autosave.js");
const { t } = require("./i18n.js");

// Own per-file sessions and drafts; the plugin supplies live Git/settings hooks.
class EditorSessions {
  constructor({ vault, read, enabled, changed, saved }) {
    Object.assign(this, { vault, read, enabled, changed, saved });
    this.sessions = new Map();
    this.drafts = new Map();
    this.pending = new Map();
  }

  async acquire(filePath, retain = false, timing) {
    if (!this.sessions.has(filePath) && !this.pending.has(filePath)) this.pending.set(filePath, (async () => {
      const versions = await this.read(filePath, timing);
      const draft = this.drafts.get(filePath) || { ...versions, text: normalize(versions.working) };
      this.drafts.set(filePath, draft);
      const session = new Autosave(draft, {
        enabled: this.enabled(),
        read: timing => this.read(filePath, timing),
        write: (expected, content) => this.write(filePath, expected, content),
        changed: () => {
          this.changed();
          if (session.released) this.prune(filePath, session);
        },
        saved: () => this.saved(),
      });
      this.sessions.set(filePath, session);
      return session;
    })().finally(() => this.pending.delete(filePath)));
    const session = this.sessions.get(filePath) || await this.pending.get(filePath);
    if (retain) { session.users = (session.users || 0) + 1; session.released = false; }
    return session;
  }

  async write(filePath, expected, content) {
    const file = this.vault.getAbstractFileByPath(filePath);
    const update = current => {
      if (current !== expected) throw new Error(conflictMessage());
      return content;
    };
    if (file && typeof file.extension === "string") await this.vault.process(file, update);
    else if (!file && typeof this.vault.adapter.process === "function") await this.vault.adapter.process(filePath, update);
    else throw new Error(t("文件状态已改变，请刷新后重试。"));
  }

  release(filePath, session) {
    session.users = Math.max(0, (session.users || 0) - 1);
    session.released = true;
    this.prune(filePath, session);
  }

  prune(filePath, session) {
    if (this.sessions.get(filePath) !== session || session.users || session.dirty || session.saving) return;
    session.stop();
    this.sessions.delete(filePath);
    this.drafts.delete(filePath);
  }

  stop() { for (const session of this.sessions.values()) session.stop(); }
}

module.exports = { EditorSessions };
