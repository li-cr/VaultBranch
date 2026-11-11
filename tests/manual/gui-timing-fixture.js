(async () => {
  if (app.vault.getName() !== "note_test") throw Error("Run only in the note_test vault.");
  const p = app.plugins.plugins.vaultbranch;
  if (!p || [...p.editSessions.values()].some(s => s.dirty || s.saving) || window.__vbGuiTiming) throw Error("Save drafts and finish previous GUI benchmark first.");
  if (p.diffNavigationTask) await p.diffNavigationTask;
  if (p.refreshTask) await p.refreshTask;
  p.refreshSoon?.cancel();
  const saved = { settings: { ...p.settings }, scheduleRefresh: p.scheduleRefresh, lastAutoRefresh: p.lastAutoRefresh };
  const root = `vb-gui-${Date.now()}`, files = [], samples = [], restore = [];
  let source, collapsed, selected, folder, leaf, current;
  const wrap = (object, key, label) => {
    const original = object[key];
    object[key] = function (...args) {
      const trace = window.__vbGuiTimingRapid ? null : current, start = performance.now();
      const finish = () => { if (trace) trace.spans.push({ name: typeof label === "function" ? label(args) : label, start: start - trace.start, ms: performance.now() - start }); };
      try {
        const value = original.apply(this, args);
        if (value?.then) return value.then(result => { finish(); return result; }, error => { finish(); throw error; });
        finish(); return value;
      } catch (error) { finish(); throw error; }
    };
    restore.push(() => { object[key] = original; });
  };
  const click = event => {
    const row = event.target.closest(".vaultbranch-file-open")?.closest(".vaultbranch-file-row");
    if (!row?.dataset.path.startsWith(root + "/")) return;
    if (current && !current.done && !window.__vbGuiTimingRapid) throw Error("Previous click still running");
    const start = performance.now();
    current = { path: row.dataset.path.slice(root.length + 1), start, gapMs: samples.length ? start - samples.at(-1).start : null, trusted: event.isTrusted, spans: [] };
    samples.push(current);
  };
  const cleanup = async () => {
    document.removeEventListener("click", click, true);
    for (const undo of restore.reverse()) undo();
    if (leaf?.view?.session?.dirty) await leaf.view.session.reload();
    for (const open of app.workspace.getLeavesOfType("vaultbranch-diff")) if (open.view.file?.path.startsWith(root + "/")) await open.detach();
    if (files.length) await p.git.run(["rm", "--cached", "--force", "--", ...files.map(f => f.path)]);
    if (folder) await app.vault.trash(folder, false);
    if (source) { source.collapsed = collapsed; source.selected = selected; source.renderSnapshot = null; }
    for (const key of ["diffAutosave", "syntaxHighlighting", "collapseUnchanged", "performanceLogging"]) if (saved.settings[key] !== undefined) await p.updateSetting(key, saved.settings[key]);
    p.scheduleRefresh = saved.scheduleRefresh; p.lastAutoRefresh = saved.lastAutoRefresh; await p.refresh();
    delete window.__vbGuiTiming;
    delete window.__vbGuiTimingMode;
    delete window.__vbGuiTimingRapid;
  };
  window.__vbGuiTiming = { cleanup };
  try {
    p.scheduleRefresh = () => {}; p.lastAutoRefresh = Date.now() + 3600000;
    for (const key of ["diffAutosave", "syntaxHighlighting"]) await p.updateSetting(key, false);
    await p.updateSetting("collapseUnchanged", true);
    if ("performanceLogging" in p.settings) await p.updateSetting("performanceLogging", window.__vbGuiTimingMode !== "off");
    for (const old of app.workspace.getLeavesOfType("vaultbranch-diff")) await old.detach();
    folder = await app.vault.createFolder(root);
    for (const dir of ["small", "large", "large/deep", "large/deep/json", "small/deep", "small/deep/json"]) await app.vault.createFolder(`${root}/${dir}`);
    const fixtures = [
      ["small/note.md", "# Small note\n\noriginal value\n"],
      ["large/deep/json/data.json", JSON.stringify(Array.from({ length: 24000 }, (_, n) => ({ id: n, text: `value ${n} abcdefghijklmnop` })), null, 2) + "\n"],
      ["small/deep/json/data.json", '{\n  "text": "original value"\n}\n'],
      ["large/note.md", Array.from({ length: 24000 }, (_, n) => `Line ${n}: original value abcdefghijklmnopqrstuvwxyz`).join("\n") + "\n"],
    ];
    for (const [path, text] of fixtures) files.push(await app.vault.create(`${root}/${path}`, text));
    await p.git.stage(files.map(f => f.path));
    for (const file of files) {
      const text = await app.vault.read(file), at = text.indexOf("value", Math.floor(text.length / 2));
      await app.vault.modify(file, text.slice(0, at) + "changed" + text.slice(at + 5));
    }
    await p.refresh(); source = (await p.openSidebar()).view;
    collapsed = new Set(source.collapsed); selected = source.selected;
    source.collapsed.clear(); source.renderSnapshot = null; source.render();
    leaf = await p.openDiff(p.status.files.find(f => f.path === files[3].path), "unstaged");
    for (const [object, key, label] of [
      [p, "editorSession", "editor-session"], [p.git, "worktreeVersions", "read-versions"],
      [p.git, "run", args => `git:${args[0][0]}${args[0][0] === "cat-file" ? ":" + args[0][1] : ""}`],
      [leaf.view, "readComparison", "prepare-comparison"], [leaf.view, "renderEditor", "build-editor"], [leaf.view, "destroyEditor", "destroy-editor"],
    ]) wrap(object, key, label);
    const originalRender = leaf.view.renderEditor;
    leaf.view.renderEditor = function (...args) {
      const value = originalRender.apply(this, args), trace = samples.findLast(sample => sample.path === this.file.path.slice(root.length + 1) && sample.domReadyMs === undefined);
      if (trace) {
        trace.domReadyMs = performance.now() - trace.start;
        requestAnimationFrame(() => {
          trace.firstFrameMs = performance.now() - trace.start;
          requestAnimationFrame(() => { trace.nextFrameMs = performance.now() - trace.start; });
        });
      }
      return value;
    };
    restore.push(() => { leaf.view.renderEditor = originalRender; });
    const originalOpen = p.openDiff;
    p.openDiff = async function (...args) {
      const trace = current;
      try { return await originalOpen.apply(this, args); }
      finally { if (trace) { trace.completedMs = performance.now() - trace.start; trace.done = true; } }
    };
    restore.push(() => { p.openDiff = originalOpen; });
    document.addEventListener("click", click, true);
    Object.assign(window.__vbGuiTiming, {
      position(n) {
        const rows = [...source.treeEl.querySelectorAll(".vaultbranch-file-row")].filter(row => row.dataset.path === files[n].path);
        const control = rows.at(-1)?.querySelector(".vaultbranch-file-open");
        if (!control) throw Error("Fixture row unavailable");
        control.scrollIntoView({ block: "center" });
        const rect = control.getBoundingClientRect();
        return { x: rect.x + Math.min(rect.width / 2, 50), y: rect.y + rect.height / 2 };
      },
      poll() { return { count: samples.length, done: samples.every(sample => sample.done), domReadyMs: current?.domReadyMs, completedMs: current?.completedMs, hasFrame: current?.nextFrameMs !== undefined, hidden: document.hidden }; },
      report() {
        if (leaf.view.file.path !== files[window.__vbGuiTimingRapid ? 2 : 3].path || leaf.view.contentEl.inert || !leaf.view.merge) throw Error("Last requested file is not completely displayed");
        return { version: p.manifest.version, userAgent: navigator.userAgent, settings: { diffAutosave: p.settings.diffAutosave, syntaxHighlighting: p.settings.syntaxHighlighting, collapseUnchanged: p.settings.collapseUnchanged, performanceLogging: p.settings.performanceLogging }, fixtures: fixtures.map(([path, text]) => ({ path, bytes: new TextEncoder().encode(text).length, lines: text.split("\n").length })), samples: samples.map(({ start, ...sample }) => sample), timings: p.timingLog?.records || [] };
      },
    });
    return { ready: true, version: p.manifest.version };
  } catch (error) { await cleanup(); throw error; }
})()
