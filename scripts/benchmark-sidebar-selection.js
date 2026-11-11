(async () => {
  if (app.vault.getName() !== "note_test") throw Error("Run only in the note_test vault.");
  const p = app.plugins.plugins.vaultbranch;
  if (!p || [...(p.editors?.sessions || p.editSessions).values()].some(s => s.dirty || s.saving)) throw Error("Save all diff drafts first.");
  if (p.refreshTask) await p.refreshTask;
  p.refreshSoon?.cancel();
  const leaf = await p.openSidebar(), view = leaf.view;
  if (p.refreshTask) await p.refreshTask;
  const saved = { status: p.status, ready: p.ready, busy: p.busy, error: p.error, lastAutoRefresh: p.lastAutoRefresh, openDiff: p.openDiff, selected: view.selected, collapsed: view.collapsed };
  const samples = [], checks = [], sizes = [10, 100, 1000];
  const check = (value, name) => { if (!value) throw Error(name); checks.push(name); };
  const round = n => Number(n.toFixed(3));
  const summary = values => { values.sort((a,b) => a-b); return { median: values[2], range: [values[0], values.at(-1)] }; };
  const pause = () => new Promise(resolve => setTimeout(resolve, 20));
  const git = p.git, run = git.run;
  let gitCalls = 0, opened;
  try {
    p.lastAutoRefresh = Date.now() + 3600000;
    p.ready = true; p.busy = false; p.error = ""; view.collapsed = new Set();
    p.openDiff = async (file, area) => { opened = { path: file.path, area }; };
    git.run = function (...args) { gitCalls++; return run.apply(this, args); };
    for (const size of sizes) {
      const files = Array.from({ length: size }, (_, n) => ({ path: `folder-${Math.floor(n/20)}/note-${n}.md`, index: " ", worktree: "M", oldPath: null, conflict: false, untracked: false }));
      p.status = { branch: "main", upstream: "origin/main", ahead: 0, behind: 0, operation: null, stash: false, files };
      const clicks = size === 1000 ? 5 : 10;
      const click = path => view.treeEl.querySelector(`.vaultbranch-file-row[data-path="${CSS.escape(path)}"] .vaultbranch-file-open`).click();
      for (let iteration = 0; iteration < 6; iteration++) {
        view.selected = ""; view.renderSnapshot = null; view.render(); view.treeEl.scrollTop = 30;
        view.treeEl.getBoundingClientRect(); await pause();
        const scroll = view.treeEl.scrollTop, started = performance.now();
        for (let n = 0; n < clicks; n++) { click(files[n%2].path); view.treeEl.getBoundingClientRect(); }
        const elapsed = performance.now() - started, last = files[(clicks-1)%2].path;
        check(opened.path === last && opened.area === "unstaged" && view.selected === "unstaged:" + last, `${size}/${iteration}: correct diff requested`);
        check(view.treeEl.querySelectorAll(".vaultbranch-file-row.is-selected").length === 1, `${size}/${iteration}: one selected row`);
        check(view.treeEl.scrollTop === scroll, `${size}/${iteration}: scroll retained`);
        if (iteration) samples.push({ size, clicks, totalMs: round(elapsed), perClickMs: round(elapsed/clicks) });
      }
      view.selected = ""; view.renderSnapshot = null; view.render();
      const before = new Set(view.treeEl.querySelectorAll("*"));
      click(files[0].path);
      const retained = [...view.treeEl.querySelectorAll("*")].filter(node => before.has(node)).length;
      samples.push({ size, nodesBefore: before.size, retainedAfterClick: retained });
    }
    check(gitCalls === 0, "selection benchmark performs no Git calls");
    return {
      environment: { obsidian: document.title.match(/Obsidian ([\d.]+)/)?.[1] || "unknown", platform: `${process.platform} ${require("node:os").release()}`, node: process.version, electron: process.versions.electron, plugin: p.manifest.version },
      method: "Same live note_test vault; synthetic sidebar status only, 10/100/1000 changed files. One discarded warm-up then five measured batches/size. Each batch alternates two actual file-row clicks; openDiff is replaced by a recorder. Includes click handler, selection update and synchronous layout, excludes Git/file reads, editor opening, final paint and cold startup. Setup/full render outside timing. No Git mutations. Original methods, status, selection and collapsed folders restored afterward.",
      samples, summary: Object.fromEntries(sizes.map(size => [size, summary(samples.filter(s => s.size === size && s.perClickMs !== undefined).map(s=>s.perClickMs))])), gitCalls, checks,
    };
  } finally {
    git.run = run; p.openDiff = saved.openDiff;
    Object.assign(p, { status: saved.status, ready: saved.ready, busy: saved.busy, error: saved.error, lastAutoRefresh: saved.lastAutoRefresh });
    view.selected = saved.selected; view.collapsed = saved.collapsed; view.renderSnapshot = null; view.render();
  }
})()
