(async () => {
  if (app.vault.getName() !== "note_test") throw Error("Run only in the note_test vault.");
  const p = app.plugins.plugins.vaultbranch;
  if (!p || [...p.editSessions.values()].some(s => s.dirty || s.saving)) throw Error("Save drafts first.");
  if (p.diffNavigationTask) await p.diffNavigationTask;
  const saved = { logging: p.settings.performanceLogging, autosave: p.settings.diffAutosave, ensureReady: p.ensureReady, editorSession: p.editorSession };
  const files = [], results = [];
  const check = (value, name) => { if (!value) throw Error(name); results.push(name); };
  let leaf, staged, release, pending, modal, clipboardWrite;
  try {
    await p.updateSetting("diffAutosave", false); await p.updateSetting("performanceLogging", false);
    check(!p.timingLog?.records.length, "disabled logging starts with no records");
    for (const suffix of [".json", ".md"]) files.push(await app.vault.create(`vb-timing-${Date.now()}${suffix}`, suffix === ".json" ? '{"value":1}\n' : "# Note\n"));
    await p.git.stage([files[0].path]); staged = files[0].path;
    await app.vault.modify(files[0], '{"value":2}\n');
    const entry = { path: files[0].path, index: "M", worktree: "M" };
    leaf = await p.openDiff(entry, "unstaged");
    check(!p.timingLog?.records.length, "opening a diff while disabled records no trace");
    await p.updateSetting("performanceLogging", true);
    check((await p.loadData()).performanceLogging === true, "native logging preference persists");
    await p.openDiff(entry, "unstaged");
    let record = p.timingLog.records.at(-1);
    check(record.status === "complete" && record.domReadyMs >= 0 && record.completedMs >= record.domReadyMs, "content-ready and operation-complete times are separate");
    check(record.stages.some(s => s.name === "git:status") && record.stages.some(s => s.name === "git:ls-files"), "live Git status and index reads appear in the trace");
    check(record.stages.some(s => s.name === "create-editor") && record.stages.some(s => s.name === "verify-after-render"), "editor creation and required final verification appear separately");
    check(record.source === "command" && !record.trusted, "programmatic openings are not mislabeled as GUI clicks");
    check(!JSON.stringify(leaf.view.getState()).includes("stages") && !JSON.stringify(await p.loadData()).includes("stages"), "timing records are absent from workspace drafts and persisted preferences");
    check(record.path === files[0].path && !JSON.stringify(record).includes('{"value":'), "trace contains relative path and no file body");
    await p.openDiff(entry, "staged"); record = p.timingLog.records.at(-1);
    check(record.status === "complete" && record.stages.some(s => s.name.startsWith("git:")) && record.stages.some(s => s.name === "create-readonly-editor"), "readonly staged comparison has Git and editor timings");
    p.ensureReady = async () => { throw Error("expected timing fixture failure"); };
    await p.openDiff(entry, "unstaged");
    check(p.timingLog.records.at(-1).status === "failed", "caught render errors are reported as failed operations");
    p.ensureReady = saved.ensureReady; await p.openDiff(entry, "unstaged");
    check(p.timingLog.records.at(-1).status === "complete", "logging recovers after a failed load");
    p.showTimings(); modal = [...document.querySelectorAll(".modal")].find(el => el.querySelector(".vaultbranch-log"));
    check(!!modal && JSON.parse(modal.querySelector(".vaultbranch-log").textContent).records.length > 0, "settings record viewer displays the current report");
    clipboardWrite = navigator.clipboard.writeText;
    let copied;
    navigator.clipboard.writeText = async text => { copied = text; };
    modal.querySelector('button[title="Copy records"],button[title="复制记录"]').click(); await new Promise(resolve => setTimeout(resolve, 0));
    check(JSON.parse(copied).units === "ms", "copy action exports valid JSON without changing the real clipboard during this test");
    navigator.clipboard.writeText = clipboardWrite; clipboardWrite = null;
    modal.querySelector('button[title="Clear records"],button[title="清空记录"]').click(); await new Promise(resolve => setTimeout(resolve, 0));
    check(!p.timingLog.records.length && !JSON.parse(modal.querySelector(".vaultbranch-log").textContent).records.length, "clear action clears memory and displayed report");
    modal.querySelector(".modal-close-button,.modal-header-button").click(); modal = null;
    let start;
    const started = new Promise(resolve => { start = resolve; }), gate = new Promise(resolve => { release = resolve; });
    p.editorSession = async (...args) => { const session = await saved.editorSession.apply(p, args); start(); await gate; return session; };
    pending = p.openDiff({ path: files[1].path, untracked: true }, "unstaged"); await started;
    await p.updateSetting("performanceLogging", false); release(); await pending; pending = null; p.editorSession = saved.editorSession;
    check(!p.timingLog.records.length, "disabling mid-load prevents late completion from restoring cleared records");
    check(!(window.__vaultbranchErrors || []).length, "no runtime errors");
    return { results, errors: window.__vaultbranchErrors || [] };
  } finally {
    if (clipboardWrite) navigator.clipboard.writeText = clipboardWrite;
    modal?.querySelector(".modal-close-button,.modal-header-button")?.click();
    release?.(); if (pending) await pending.catch(() => {});
    p.ensureReady = saved.ensureReady; p.editorSession = saved.editorSession;
    if (leaf) { await leaf.view.session?.reload(); await leaf.detach(); }
    if (staged) await p.git.run(["rm", "--cached", "--force", "--", staged]);
    for (const file of files) if (app.vault.getAbstractFileByPath(file.path)) await app.vault.trash(file, false);
    await p.updateSetting("diffAutosave", saved.autosave); await p.updateSetting("performanceLogging", saved.logging);
    await p.refresh();
  }
})()
