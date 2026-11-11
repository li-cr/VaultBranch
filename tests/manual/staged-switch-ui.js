(async () => {
  if (app.vault.getName() !== "note_test") throw Error("Run only in note_test.");
  const p = app.plugins.plugins.vaultbranch;
  if (!p || window.__vbStagedSwitch || [...p.editSessions.values()].some(s => s.dirty || s.saving)) throw Error("Save drafts and finish previous tests first.");
  if (p.diffNavigationTask) await p.diffNavigationTask;
  if (p.refreshTask) await p.refreshTask;
  p.refreshSoon?.cancel();

  const fs = require("node:fs/promises"), os = require("node:os"), path = require("node:path");
  const exec = require("node:util").promisify(require("node:child_process").execFile);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vaultbranch-staged-switch-"));
  const saved = { git: p.git, status: p.status, ready: p.ready, error: p.error, scheduleRefresh: p.scheduleRefresh,
    lastAutoRefresh: p.lastAutoRefresh, timingLog: p.timingLog, settings: { ...p.settings } };
  const git = async (...args) => (await exec(saved.git.binary, args, { cwd: root, windowsHide: true })).stdout;
  const shapes = [
    ["small/note.md", "# Small note\noriginal value\n"],
    ["large/deep/json/data.json", JSON.stringify(Array.from({ length: 24000 }, (_, id) => ({ id, text: `value ${id} abcdefghijklmnop` })), null, 2) + "\n"],
    ["small/deep/json/data.json", '{"text":"original value"}\n'],
    ["large/note.md", Array.from({ length: 24000 }, (_, n) => `Line ${n}: original value abcdefghijklmnopqrstuvwxyz`).join("\n") + "\n"],
  ];
  const staged = shapes.map(([name, text]) => [`staged/${name}`, text]);
  const changed = shapes.map(([name, text]) => [`changed/${name}`, text]);
  const fillers = prefix => Array.from({ length: 96 }, (_, n) => [`${prefix}/nested/${String(n).padStart(3, "0")}/note-${n}.md`, `# Filler ${n}\noriginal value\n`]);
  const stagedFillers = fillers("staged"), changedFillers = fillers("changed");
  const targets = [...staged, ...changed], allFiles = [...targets, ...stagedFillers, ...changedFillers];
  const samples = [], restores = [];
  let source, savedCollapsed, savedSelected, leaf, current;

  const cleanup = async () => {
    document.removeEventListener("click", onClick, true);
    for (const restore of restores.reverse()) restore();
    for (const open of app.workspace.getLeavesOfType("vaultbranch-diff")) {
      if (targets.some(([name]) => open.view.file?.path === name)) await open.detach();
    }
    p.git = saved.git; p.status = saved.status; p.ready = saved.ready; p.error = saved.error;
    p.scheduleRefresh = saved.scheduleRefresh; p.lastAutoRefresh = saved.lastAutoRefresh; p.timingLog = saved.timingLog;
    Object.assign(p.settings, saved.settings);
    if (source) { source.collapsed = savedCollapsed; source.selected = savedSelected; source.treeSnapshot = null; source.renderSnapshot = null; }
    await p.refresh();
    await fs.rm(root, { recursive: true, force: true });
    delete window.__vbStagedSwitch;
  };
  const onClick = event => {
    const row = event.target.closest(".vaultbranch-file-open")?.closest(".vaultbranch-file-row");
    if (!row || !targets.some(([name]) => name === row.dataset.path)) return;
    const groups = [...source.treeEl.querySelectorAll(".vaultbranch-group")];
    const area = groups.indexOf(row.closest(".vaultbranch-group")) === 0 ? "staged" : "unstaged";
    current = { path: row.dataset.path, area, trusted: event.isTrusted, start: performance.now(), spans: [] };
    samples.push(current);
  };
  window.__vbStagedSwitch = { cleanup };

  try {
    p.scheduleRefresh = () => {};
    p.lastAutoRefresh = Date.now() + 3600000;
    p.settings.performanceLogging = true;
    p.settings.diffAutosave = false;
    p.settings.syntaxHighlighting = false;
    p.timingLog = undefined;
    await git("init", "-b", "main");
    await git("config", "user.name", "VaultBranch benchmark");
    await git("config", "user.email", "benchmark@example.invalid");
    for (const [name, text] of allFiles) {
      await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
      await fs.writeFile(path.join(root, name), text);
    }
    await git("add", "."); await git("commit", "-m", "Benchmark base");
    const edit = (text, replacement) => {
      const at = text.indexOf("value", Math.floor(text.length / 2));
      return at < 0 ? `${text}${replacement}\n` : `${text.slice(0, at)}${replacement}${text.slice(at + 5)}`;
    };
    for (const [name, text] of [...staged, ...stagedFillers]) await fs.writeFile(path.join(root, name), edit(text, "staged"));
    await git("add", ...staged.map(([name]) => name), ...stagedFillers.map(([name]) => name));
    for (const [name, text] of [...changed, ...changedFillers]) await fs.writeFile(path.join(root, name), edit(text, "working"));

    p.git = new saved.git.constructor(root, { binary: saved.git.binary });
    await p.git.init(); p.ready = true; p.status = await p.git.status();
    const index = await git("write-tree");
    source = (await p.openSidebar()).view;
    savedCollapsed = new Set(source.collapsed); savedSelected = source.selected;
    source.collapsed.clear(); source.treeSnapshot = null; source.renderSnapshot = null; source.render();
    leaf = await p.openDiff(p.status.files.find(file => file.path === staged[0][0]), "staged");

    const run = p.git.run;
    p.git.run = function (args, options) {
      const trace = current, start = performance.now();
      return run.call(this, args, options).finally(() => trace?.spans.push({ command: args[0], start: start - trace.start, ms: performance.now() - start }));
    };
    restores.push(() => { p.git.run = run; });
    const open = p.openDiff;
    p.openDiff = async function (...args) {
      const trace = current;
      try { return await open.apply(this, args); }
      finally {
        if (trace) {
          trace.completedMs = performance.now() - trace.start;
          const view = leaf.view, record = p.timingLog.records.at(-1);
          trace.domReadyMs = record.domReadyMs;
          trace.gitCalls = trace.spans.length;
          trace.modeValid = trace.area === "staged"
            ? Boolean(view.merge?.a.state.readOnly && view.merge?.b.state.readOnly)
            : Boolean(view.session && !view.merge?.b.state.readOnly);
          trace.done = true;
        }
      }
    };
    restores.push(() => { p.openDiff = open; });
    document.addEventListener("click", onClick, true);

    Object.assign(window.__vbStagedSwitch, {
      position(index, area) {
        const group = [...source.treeEl.querySelectorAll(".vaultbranch-group")][area === "staged" ? 0 : 1];
        const target = targets[(area === "staged" ? 0 : 4) + index][0];
        const row = [...group.querySelectorAll(".vaultbranch-file-row")].find(item => item.dataset.path === target);
        if (!row) throw Error(`Missing ${area} fixture row: ${target}`);
        const control = row.querySelector(".vaultbranch-file-open"); control.scrollIntoView({ block: "center" });
        const rect = control.getBoundingClientRect();
        return { x: rect.x + Math.min(rect.width / 2, 50), y: rect.y + rect.height / 2 };
      },
      poll() { return { count: samples.length, done: samples.every(sample => sample.done) }; },
      async report() {
        const groups = p.core.groupsFor(p.status.files);
        return { version: p.manifest.version, userAgent: navigator.userAgent,
          statusCounts: { staged: groups.staged.length, changed: groups.unstaged.length },
          indexUnchanged: (await git("write-tree")) === index,
          modeChecksPassed: samples.every(sample => sample.modeValid),
          fixtures: targets.map(([pathName, text]) => ({ path: pathName, bytes: Buffer.byteLength(text), lines: text.split("\n").length })),
          samples: samples.map(({ start, done, modeValid, ...sample }) => sample) };
      },
    });
    return { ready: true, statusCounts: { staged: 100, changed: 100 } };
  } catch (error) { await cleanup(); throw error; }
})()
