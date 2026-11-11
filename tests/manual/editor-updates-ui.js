(async () => {
  if (app.vault.getName() !== "note_test") throw Error("Run only in note_test.");
  const p = app.plugins.plugins.vaultbranch;
  if (!p || [...p.editSessions.values()].some(s => s.dirty || s.saving)) throw Error("Save drafts first.");
  await p.diffNavigationTask; await p.refreshTask; p.refreshSoon?.cancel();
  const testWindow = require("electron").remote.getCurrentWindow(); testWindow.show(); testWindow.focus();
  const fs = require("node:fs/promises"), os = require("node:os"), path = require("node:path");
  const exec = require("node:util").promisify(require("node:child_process").execFile);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vaultbranch-editor-updates-"));
  const saved = { git: p.git, status: p.status, ready: p.ready, settings: { ...p.settings }, scheduleRefresh: p.scheduleRefresh, lastAutoRefresh: p.lastAutoRefresh };
  const git = async (...args) => (await exec(saved.git.binary, args, { cwd: root, windowsHide: true })).stdout;
  const write = async (name, text) => { await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true }); await fs.writeFile(path.join(root, name), text); };
  const shapes = [
    ["small/note.md", "# Small note\noriginal value\n"],
    ["large/deep/json/data.json", JSON.stringify(Array.from({ length: 24000 }, (_, id) => ({ id, text: `value ${id} abcdefghijklmnop` })), null, 2) + "\n"],
    ["small/deep/json/data.json", '{"text":"original value"}\n'],
    ["large/note.md", Array.from({ length: 24000 }, (_, n) => `Line ${n}: original value abcdefghijklmnopqrstuvwxyz`).join("\n") + "\n"],
  ];
  const samples = [], results = [], check = (value, name) => { if (!value) throw Error(name); results.push(name); };
  const summary = values => { const sorted = [...values].sort((a, b) => a - b); return { median: sorted[Math.floor(sorted.length / 2)], range: [sorted[0], sorted.at(-1)] }; };
  const settle = async () => {
    await new Promise(resolve => { const timer = setTimeout(resolve, 100); requestAnimationFrame(() => { clearTimeout(timer); resolve(); }); });
    await new Promise(resolve => setTimeout(resolve, 50));
  };
  let leaf, source, collapsed, selected;
  try {
    p.scheduleRefresh = () => {}; p.lastAutoRefresh = Date.now() + 3600000;
    Object.assign(p.settings, { diffAutosave: false, collapseUnchanged: false, syntaxHighlighting: false, performanceLogging: false, showDiffNavigation: true });
    for (const open of app.workspace.getLeavesOfType("vaultbranch-diff")) await open.detach();
    await git("init", "-b", "main"); await git("config", "user.name", "Editor benchmark"); await git("config", "user.email", "benchmark@example.invalid");
    for (const group of ["staged", "changed"]) {
      for (const [name, text] of shapes) await write(`${group}/${name}`, text);
      for (let n = 0; n < 96; n++) await write(`${group}/filler/${n}.md`, `original value ${n}\n`);
    }
    await git("add", "."); await git("commit", "-m", "base");
    for (const group of ["staged", "changed"]) {
      for (const [name, text] of shapes) await write(`${group}/${name}`, text.replace("value", "changed value"));
      for (let n = 0; n < 96; n++) await write(`${group}/filler/${n}.md`, `changed value ${n}\n`);
      if (group === "staged") await git("add", "staged");
    }
    const index = await git("write-tree");
    p.git = new saved.git.constructor(root, { binary: saved.git.binary }); await p.git.init(); p.ready = true; p.status = await p.git.status();
    const groups = p.core.groupsFor(p.status.files);
    check(groups.staged.length === 100 && groups.unstaged.length === 100, "fixture has exactly 100 staged and 100 changed files");
    source = (await p.openSidebar()).view; collapsed = new Set(source.collapsed); selected = source.selected;
    for (const [name] of shapes) {
      const file = p.status.files.find(file => file.path === `changed/${name}`);
      leaf = await p.openDiff(file, "unstaged");
      const view = leaf.view, editor = view.merge.b, original = editor.state.doc.toString(), at = original.indexOf("value") + 2;
      editor.focus();
      await settle();
      const observer = new MutationObserver(() => {});
      observer.observe(view.contentEl.querySelector(".vaultbranch-diff-header"), { subtree: true, attributes: true, attributeFilter: ["title", "aria-label", "disabled"] });
      for (const caption of [view.leftCaption, view.rightCaption]) observer.observe(caption, { childList: true, characterData: true, subtree: true });
      observer.observe(view.warningEl, { attributes: true, attributeFilter: ["hidden"] });
      for (const pane of [view.merge.a, view.merge.b]) observer.observe(pane.contentDOM, { attributes: true, attributeFilter: ["aria-label"] });
      try {
        for (let round = 0; round < 6; round++) {
          await settle();
          editor.dispatch({ changes: { from: at, insert: "x" } });
          observer.takeRecords();
          const start = performance.now();
          for (let key = 0; key < 30; key++) editor.dispatch({ changes: { from: at, insert: "x" } });
          const dispatchMs = +(performance.now() - start).toFixed(3);
          const mutations = observer.takeRecords();
          if (round) samples.push({ path: name, round, edits: 30, dispatchMs, chromeMutations: mutations.length });
          editor.dispatch({ changes: { from: at, to: at + 31 } });
          check(editor.state.doc.toString() === original && !view.session.dirty, `round ${round} restores the clean draft for ${name}`);
        }
      } finally { observer.disconnect(); }
      await leaf.detach(); leaf = null;
    }
    leaf = await p.openDiff(p.status.files.find(file => file.path === "staged/small/note.md"), "staged");
    check(leaf.view.merge.a.state.readOnly && leaf.view.merge.b.state.readOnly, "Staged stays read-only");
    await leaf.detach(); leaf = null;
    check((await git("write-tree")) === index, "editing batches and previews leave the index unchanged");
    check(p.editSessions.size === 0, "closing releases all clean editor sessions");
    check(!(window.__vaultbranchErrors || []).length, "no runtime errors");
    return { version: p.manifest.version, environment: { userAgent: navigator.userAgent, node: process.version, platform: process.platform, git: (await git("--version")).trim(), focused: document.hasFocus(), visibility: document.visibilityState },
      scenario: "100 Staged + 100 Changed files; four mixed nested targets, six rounds each, discard one warm-up round. Focus the test window and editable pane; allow scheduled editor rendering between targets/rounds, outside timing. Thirty scripted CodeMirror insert transactions after the first dirty edit. Measures synchronous edit dispatch and toolbar/caption/warning/ARIA mutations only; excludes Git/file reads, navigation, asynchronous layout and physical paint. Autosave, folding, syntax highlighting and timing logging disabled. No GUI click latency claim.",
      fixtures: shapes.map(([name, text]) => ({ path: name, baseBytes: Buffer.byteLength(text), bytes: Buffer.byteLength(text.replace("value", "changed value")), lines: text.split("\n").length })), results, samples,
      summary: Object.fromEntries(shapes.map(([name]) => { const group = samples.filter(sample => sample.path === name); return [name, { dispatchMs: summary(group.map(sample => sample.dispatchMs)), chromeMutations: summary(group.map(sample => sample.chromeMutations)) }]; })) };
  } finally {
    if (leaf) { if (leaf.view.session?.dirty) leaf.view.session.draft.text = leaf.view.session.savedText; await leaf.detach(); }
    p.git = saved.git; p.status = saved.status; p.ready = saved.ready;
    Object.assign(p.settings, saved.settings); p.scheduleRefresh = saved.scheduleRefresh; p.lastAutoRefresh = saved.lastAutoRefresh;
    if (source) { source.collapsed = collapsed; source.selected = selected; source.renderSnapshot = null; }
    await p.refresh(); await fs.rm(root, { recursive: true, force: true });
  }
})()
