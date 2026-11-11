(async () => {
  if (app.vault.getName() !== "note_test") throw Error("Run only in the note_test vault.");
  const p = app.plugins.plugins.vaultbranch;
  if (!p || [...(p.editors?.sessions || p.editSessions).values()].some(s => s.dirty || s.saving)) throw Error("Save all diff drafts first.");
  if (p.refreshTask) await p.refreshTask;
  p.refreshSoon?.cancel();
  const saved = { settings: { ...p.settings }, scheduleRefresh: p.scheduleRefresh, lastAutoRefresh: p.lastAutoRefresh };
  const root = `vb-switch-${Date.now()}`, files = [], samples = [];
  let folder, leaf, observer, frame, source, collapsed;
  const paint = () => new Promise(resolve => {
    const timer = setTimeout(resolve, 100);
    requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timer); resolve(); }));
  });
  try {
    p.scheduleRefresh = () => {}; p.lastAutoRefresh = Date.now() + 3600000;
    for (const key of ["diffAutosave", "syntaxHighlighting"]) await p.updateSetting(key, false);
    await p.updateSetting("collapseUnchanged", true);
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
    await p.refresh();
    source = (await p.openSidebar()).view;
    collapsed = new Set(source.collapsed);
    source.collapsed.clear(); source.renderSnapshot = null; source.render();
    const entries = files.map(f => p.status.files.find(entry => entry.path === f.path));
    await p.openDiff(entries[3], "unstaged");
    leaf = app.workspace.getLeavesOfType("vaultbranch-diff").find(l => l.view.file?.path === files[3].path);
    await paint();
    for (let round = 0; round < 6; round++) for (let n = 0; n < files.length; n++) {
      const view = leaf.view, heights = [], states = [];
      let blankFrames = 0, loadingFrames = 0, watching = true;
      const sample = () => {
        const header = view.contentEl.querySelector(".vaultbranch-diff-header");
        const height = header?.getBoundingClientRect().height;
        if (height) heights.push(height);
        const text = view.contentEl.querySelector(".vaultbranch-diff-body")?.textContent || "";
        states.push({ editor: !!view.contentEl.querySelector(".cm-mergeView"), loading: /读取差异中|Loading diff/.test(text), height });
      };
      observer = new MutationObserver(sample); observer.observe(view.contentEl, { childList: true, subtree: true });
      const tick = () => {
        if (!watching) return;
        if (!view.contentEl.querySelector(".cm-mergeView")) blankFrames++;
        if (/读取差异中|Loading diff/.test(view.contentEl.querySelector(".vaultbranch-diff-body")?.textContent || "")) loadingFrames++;
        frame = requestAnimationFrame(tick);
      };
      sample(); frame = requestAnimationFrame(tick);
      const start = performance.now();
      // The fixtures are staged and modified; click their unstaged occurrence.
      const rows = [...source.treeEl.querySelectorAll(".vaultbranch-file-row")].filter(row => row.dataset.path === files[n].path);
      if (!rows.length) throw Error("Fixture row missing");
      rows.at(-1).querySelector(".vaultbranch-file-open").click();
      await Promise.resolve(); await p.diffNavigationTask; await paint();
      const elapsed = performance.now() - start;
      watching = false; cancelAnimationFrame(frame); observer.disconnect(); observer = null;
      if (leaf.view.file.path !== files[n].path || !leaf.view.merge || leaf.view.session.dirty) throw Error("Incorrect loaded file");
      if (round) samples.push({ path: fixtures[n][0], bytes: new TextEncoder().encode(fixtures[n][1]).length, elapsed, blankFrames, loadingFrames, incompleteStates: states.filter(s => s.loading || !s.editor).length, headerRange: [Math.min(...heights), Math.max(...heights)] });
    }
    const summary = fixtures.map(([path]) => {
      const group = samples.filter(s => s.path === path), times = group.map(s => s.elapsed).sort((a, b) => a - b);
      return { path, bytes: group[0].bytes, samples: group.length, median: times[2], range: [times[0], times.at(-1)], blankFrames: group.reduce((sum, s) => sum + s.blankFrames, 0), loadingFrames: group.reduce((sum, s) => sum + s.loadingFrames, 0), incompleteStates: group.reduce((sum, s) => sum + s.incompleteStates, 0), headerRange: [Math.min(...group.map(s => s.headerRange[0])), Math.max(...group.map(s => s.headerRange[1]))] };
    });
    return { version: p.manifest.version, environment: { userAgent: navigator.userAgent, platform: process.platform, versions: process.versions }, summary, samples };
  } finally {
    observer?.disconnect(); cancelAnimationFrame(frame);
    if (leaf) await leaf.detach();
    if (files.length) await p.git.run(["rm", "--cached", "--force", "--", ...files.map(f => f.path)]);
    if (folder) await app.vault.trash(folder, false);
    if (source && collapsed) { source.collapsed = collapsed; source.renderSnapshot = null; }
    for (const key of ["diffAutosave", "syntaxHighlighting", "collapseUnchanged"]) await p.updateSetting(key, saved.settings[key]);
    p.scheduleRefresh = saved.scheduleRefresh; p.lastAutoRefresh = saved.lastAutoRefresh;
    await p.refresh();
  }
})()
