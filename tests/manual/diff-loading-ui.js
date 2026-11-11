(async () => {
  if (app.vault.getName() !== "note_test") throw Error("Run only in the note_test vault.");
  const p = app.plugins.plugins.vaultbranch;
  if (!p || [...p.editors.sessions.values()].some(s => s.dirty || s.saving)) throw Error("Save all diff drafts first.");
  if (p.diffNavigationTask) await p.diffNavigationTask;
  if (p.refreshTask) await p.refreshTask;
  p.refreshSoon?.cancel();
  const saved = { settings: { ...p.settings }, editorSession: p.editors.acquire, ensureReady: p.ensureReady, scheduleRefresh: p.scheduleRefresh, lastAutoRefresh: p.lastAutoRefresh };
  const results = [], files = [], root = `vb-loading-${Date.now()}`;
  const check = (value, name) => { if (!value) throw Error(name); results.push(name); };
  const nextFrame = () => new Promise(resolve => {
    const timer = setTimeout(resolve, 100);
    requestAnimationFrame(() => { clearTimeout(timer); resolve(); });
  });
  let folder, leaf, release, pending, source, collapsed;
  const holdSession = () => {
    let start;
    const started = new Promise(resolve => { start = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    p.editors.acquire = async (...args) => {
      const session = await saved.editorSession.apply(p.editors, args);
      start(); await gate; return session;
    };
    return started;
  };
  try {
    p.scheduleRefresh = () => {}; p.lastAutoRefresh = Date.now() + 3600000;
    for (const key of ["diffAutosave", "syntaxHighlighting"]) await p.updateSetting(key, false);
    await p.updateSetting("collapseUnchanged", true); await p.updateSetting("showDiffNavigation", true);
    for (const old of app.workspace.getLeavesOfType("vaultbranch-diff")) await old.detach();
    folder = await app.vault.createFolder(root);
    for (const dir of ["small", "large", "large/deep", "large/deep/json", "small/deep", "small/deep/json", "limits"]) await app.vault.createFolder(`${root}/${dir}`);
    const fixtures = [
      ["small/note.md", "# Small note\n\noriginal value\n"],
      ["large/deep/json/data.json", JSON.stringify(Array.from({ length: 24000 }, (_, n) => ({ id: n, text: `value ${n} abcdefghijklmnop` })), null, 2) + "\n"],
      ["small/deep/json/data.json", '{\n  "text": "original value"\n}\n'],
      ["large/note.md", Array.from({ length: 24000 }, (_, n) => `Line ${n}: original value abcdefghijklmnopqrstuvwxyz`).join("\n\n") + "\n"],
      ["limits/near.json", JSON.stringify({ rows: Array.from({ length: 34000 }, (_, n) => `value ${n} ${"x".repeat(40)}`) }, null, 2) + "\n"],
      ["limits/over.json", JSON.stringify({ rows: Array(150000).fill("original value") }, null, 2)],
    ];
    for (const [path, text] of fixtures) files.push(await app.vault.create(`${root}/${path}`, text));
    await p.git.stage(files.map(f => f.path));
    for (const file of files) {
      const text = await app.vault.read(file), at = text.indexOf("value", Math.floor(text.length / 2));
      await app.vault.modify(file, text.slice(0, at) + "changed" + text.slice(at + 5));
    }
    const index = await p.git.run(["write-tree"]);
    await p.refresh();
    source = (await p.openSidebar()).view;
    collapsed = new Set(source.collapsed);
    source.collapsed.clear(); source.renderSnapshot = null; source.render();
    const entries = files.map(file => p.status.files.find(entry => entry.path === file.path));
    const click = async n => {
      const row = [...source.treeEl.querySelectorAll(".vaultbranch-file-row")].filter(row => row.dataset.path === files[n].path).at(-1);
      check(!!row, `fixture ${n} exists in its real nested directory`);
      row.querySelector(".vaultbranch-file-open").click();
      await Promise.resolve(); await p.diffNavigationTask;
      leaf = app.workspace.getLeavesOfType("vaultbranch-diff").find(l => l.view.file?.path === files[n].path);
    };
    let started = holdSession();
    pending = p.openDiff(entries[0], "unstaged"); await started;
    leaf = app.workspace.getLeavesOfType("vaultbranch-diff")[0];
    await nextFrame();
    check(!leaf.view.contentEl.querySelector(".vaultbranch-diff-header"), "first open does not expose a partial toolbar while data is pending");
    check(leaf.view.contentEl.inert && leaf.view.contentEl.getAttribute("aria-busy") === "true", "pending first open is inert and reports busy to accessibility tools");
    release(); await pending; pending = null; p.editors.acquire = saved.editorSession;
    const complete = () => leaf.view.contentEl.querySelector(".vaultbranch-diff-header") && leaf.view.saveButton && leaf.view.contentEl.querySelectorAll(".vaultbranch-diff-navigation button").length === 2 && leaf.view.merge && leaf.view.leftCaption.textContent && leaf.view.rightCaption.textContent;
    check(complete() && !leaf.view.contentEl.inert, "first committed editable page contains path, save/navigation controls, both captions and editor together");
    const oldHeader = leaf.view.contentEl.querySelector(".vaultbranch-diff-header"), oldMerge = leaf.view.merge;
    started = holdSession(); pending = p.openDiff(entries[1], "unstaged"); await started; await nextFrame();
    check(leaf.view.contentEl.querySelector(".vaultbranch-diff-header") === oldHeader && leaf.view.merge === oldMerge && leaf.view.contentEl.inert, "pending switch exposes no new incomplete header and prevents old-page interaction");
    await leaf.view.render();
    check(leaf.view.merge === oldMerge, "background refresh cannot interrupt a pending switch");
    release(); await pending; pending = null; p.editors.acquire = saved.editorSession;
    check(complete() && leaf.view.file.path === files[1].path, "large JSON commits a complete page after its read completes");
    for (const n of [2, 3, 0, 1, 2, 3]) {
      await click(n);
      check(complete() && !/读取差异中|Loading diff/.test(leaf.view.contentEl.querySelector(".vaultbranch-diff-body").textContent), `interleaved small/large fixture ${n} opens without a loading placeholder`);
    }
    await click(4);
    check(!!leaf.view.session && leaf.view.merge.b.state.doc.length > 1900000, "near-2-MB JSON remains editable");
    await click(5);
    check(!leaf.view.merge && !leaf.view.session && !!leaf.view.contentEl.querySelector(".vaultbranch-diff-row"), "over-2-MB JSON retains its patch-only fallback");
    check(!leaf.view.contentEl.querySelector(".vaultbranch-diff-navigation"), "patch-only fallback does not expose unavailable navigation controls");
    await click(0);
    const disk = await app.vault.read(files[0]);
    leaf.view.merge.b.dispatch({ changes: { from: 0, insert: "manual draft\n" } });
    check(leaf.view.session.dirty && leaf.view.merge.b.state.doc.lines === disk.split("\n").length + 1, "typing updates draft and line count");
    await click(1); await click(0);
    check(leaf.view.merge.b.state.doc.toString() === "manual draft\n" + disk && await app.vault.read(files[0]) === disk, "large/small switching retains a manual draft without saving it");
    const draft = leaf.view.session.draft.text;
    leaf.view.merge.b.dispatch({ changes: { from: 0, insert: "new edit\n" } });
    leaf.view.merge.b.focus(); leaf.view.merge.b.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "z", code: "KeyZ", ctrlKey: true, bubbles: true }));
    check(leaf.view.session.draft.text === draft, "new input after reopening can still be undone");
    await app.vault.modify(files[0], disk + "external edit\n"); await leaf.view.session.sync();
    check(leaf.view.session.error && leaf.view.session.draft.text === draft, "external change protection retains the manual draft");
    await leaf.view.session.reload();
    leaf.view.merge.b.dispatch({ changes: { from: 0, insert: "saved edit\n" } }); await leaf.view.saveEditor();
    check((await app.vault.read(files[0])).startsWith("saved edit\n") && !leaf.view.session.dirty, "manual save still writes the working file");
    await p.openDiff(entries[0], "staged");
    check(!leaf.view.session && leaf.view.merge.a.state.readOnly && leaf.view.merge.b.state.readOnly, "staged comparisons remain readonly");
    const rapid = [p.openDiff(entries[1], "unstaged"), p.openDiff(entries[2], "unstaged"), p.openDiff(entries[3], "unstaged")];
    await Promise.all(rapid);
    check(leaf.view.file.path === files[3].path && complete(), "rapid large/small/large clicks finish on the last requested file");
    let blocked;
    const blockedStarted = new Promise(resolve => { blocked = resolve; });
    const blockedGate = new Promise(resolve => { release = resolve; });
    p.editors.acquire = async (...args) => {
      const session = await saved.editorSession.apply(p.editors, args);
      if (args[0] === files[1].path) { blocked(); await blockedGate; }
      return session;
    };
    pending = p.openDiff(entries[1], "unstaged"); await blockedStarted;
    await p.openDiff(entries[2], "unstaged");
    check(leaf.view.file.path === files[2].path && complete() && !leaf.view.contentEl.inert, "B becomes fully interactive before the blocked large-file A read finishes");
    release(); await pending; pending = null; p.editors.acquire = saved.editorSession;
    check(leaf.view.file.path === files[2].path && complete(), "late A result cannot replace the completed B page");
    check(!p.editors.sessions.has(files[1].path), "superseded large-file A session is released");
    p.ensureReady = async () => { throw Error("expected test read failure"); };
    await p.openDiff(entries[2], "unstaged");
    check(!!leaf.view.contentEl.querySelector(".is-error") && !leaf.view.contentEl.inert, "failed load displays an error and restores interaction");
    p.ensureReady = saved.ensureReady; await p.openDiff(entries[2], "unstaged");
    check(complete(), "a later file opens successfully after a read failure");
    started = holdSession(); pending = p.openDiff(entries[1], "unstaged"); await started;
    await leaf.detach(); leaf = null; release(); await pending; pending = null; p.editors.acquire = saved.editorSession;
    check(!p.editors.sessions.size, "closing during a large-file load releases current and late editor sessions");
    check(await p.git.run(["write-tree"]) === index, "all navigation, edits and saves leave the staged index unchanged");
    check(!(window.__vaultbranchErrors || []).length, "no runtime errors");
    return { results, fixtures: fixtures.map(([path, text]) => ({ path, bytes: new TextEncoder().encode(text).length, lines: text.split("\n").length })), errors: window.__vaultbranchErrors || [] };
  } finally {
    release?.(); if (pending) await pending.catch(() => {});
    p.editors.acquire = saved.editorSession; p.ensureReady = saved.ensureReady;
    if (leaf) { await leaf.view.session?.reload(); await leaf.detach(); }
    if (files.length) await p.git.run(["rm", "--cached", "--force", "--", ...files.map(f => f.path)]);
    if (folder) await app.vault.trash(folder, false);
    if (source && collapsed) { source.collapsed = collapsed; source.renderSnapshot = null; }
    for (const key of ["diffAutosave", "syntaxHighlighting", "collapseUnchanged", "showDiffNavigation"]) await p.updateSetting(key, saved.settings[key]);
    p.scheduleRefresh = saved.scheduleRefresh; p.lastAutoRefresh = saved.lastAutoRefresh; await p.refresh();
  }
})()
