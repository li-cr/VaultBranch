(async () => {
  if (app.vault.getName() !== "note_test") throw Error("Run only in the note_test vault.");
  const id = "vaultbranch", manager = app.plugins;
  const initial = manager.plugins[id];
  if (!initial || [...(initial.editors?.sessions || initial.editSessions).values()].some(session => session.dirty || session.saving)) throw Error("Enable VaultBranch and save all diff drafts first.");
  const settings = { ...initial.settings };
  const legacy = Boolean(window.__vaultbranchBenchmarkLegacy);
  const fs = require("node:fs/promises"), os = require("node:os"), path = require("node:path");
  const exec = require("node:util").promisify(require("node:child_process").execFile);
  const filePath = "vaultbranch-startup-benchmark.md";
  if (await app.vault.adapter.exists(filePath)) throw Error("Benchmark fixture already exists.");
  const file = await app.vault.create(filePath, Array.from({ length: 80 }, (_, n) => `line ${n}`).join("\n") + "\n");
  let loadOwner = Object.getPrototypeOf(initial);
  while (!Object.hasOwn(loadOwner, "load")) loadOwner = Object.getPrototypeOf(loadOwner);
  const originalLoad = loadOwner.load;
  const readData = app.vault.readPluginData, writeData = app.vault.writePluginData;
  let sample, started;
  const round = value => Number(value.toFixed(2));
  const gitVersion = (await exec(initial.git.binary, ["--version"], { windowsHide: true })).stdout.trim();
  const samples = [];
  const closeViews = async () => {
    const leaves = [];
    app.workspace.iterateAllLeaves(leaf => { if (leaf.view.getViewType().startsWith("vaultbranch-")) leaves.push(leaf); });
    for (const leaf of leaves) await leaf.detach();
  };
  try {
    await initial.updateSetting("openOnStartup", false);
    await closeViews();
    loadOwner.load = async function (...args) {
      if (this.manifest?.id !== id || !sample) return originalLoad.apply(this, args);
      sample.beforeOnloadMs = round(performance.now() - started);
      const now = performance.now();
      try { return await originalLoad.apply(this, args); }
      finally { sample.onloadMs = round(performance.now() - now); }
    };
    app.vault.readPluginData = async function (...args) {
      const now = performance.now();
      try { return await readData.apply(this, args); }
      finally { if (sample && args[0] === initial.manifest.dir) sample.settingsReadMs = round(performance.now() - now); }
    };
    app.vault.writePluginData = async function (...args) {
      if (sample && args[0] === initial.manifest.dir) sample.settingsWrites = (sample.settingsWrites || 0) + 1;
      return writeData.apply(this, args);
    };
    for (let iteration = 0; iteration < 6; iteration++) {
      await closeViews();
      const previous = manager.plugins[id];
      if (previous?.refreshTask) await previous.refreshTask;
      previous?.refreshSoon?.cancel();
      await manager.disablePlugin(id);
      const preferences = { ...settings, openOnStartup: false };
      if (legacy) { delete preferences.collapseUnchanged; delete preferences.showDiffNavigation; }
      await writeData.call(app.vault, initial.manifest.dir, preferences);
      sample = {};
      started = performance.now();
      const plugin = await manager.loadPlugin(id);
      sample.loadPluginMs = round(performance.now() - started);
      sample.tableCompatibilityEnabled = Boolean(plugin.settings.renderLooseTables);
      sample.tableEditorExtensionCount = plugin.tableExtensions?.length || 0;
      sample.settingsWrites ||= 0;
      sample.readyAtLoad = plugin.ready;
      const run = plugin.git.run, gitCalls = [];
      let phase = "first-sidebar";
      plugin.git.run = function (...args) {
        const call = { phase, command: args[0][0], start: performance.now() };
        gitCalls.push(call);
        return run.apply(this, args).finally(() => { call.ms = round(performance.now() - call.start); delete call.start; });
      };
      let now = performance.now();
      const sidebar = await plugin.openSidebar();
      await plugin.refresh();
      sidebar.view.contentEl.getBoundingClientRect();
      sample.firstSidebarMs = round(performance.now() - now);
      phase = "first-diff";
      now = performance.now();
      const diff = await plugin.openDiff({ path: filePath, untracked: true, index: "?", worktree: "?" }, "unstaged");
      diff.view.merge.b.dom.getBoundingClientRect();
      sample.firstDiffMs = round(performance.now() - now);
      sample.gitCalls = gitCalls;
      plugin.git.run = run;
      if (!diff.view.merge.a.state.readOnly || diff.view.merge.b.state.readOnly) throw Error("Editor access regression.");
      await diff.detach();
      if ((plugin.editors?.sessions || plugin.editSessions).size) throw Error("Clean editor session leaked.");
      sample.sessionsAfterClose = (plugin.editors?.sessions || plugin.editSessions).size;
      if (iteration) samples.push(sample);
      sample = null;
    }
    const summarize = key => {
      const values = samples.map(s => s[key]).sort((a, b) => a - b);
      return { median: values[2], range: [values[0], values.at(-1)] };
    };
    const git = manager.plugins[id].git;
    const counts = await Promise.all([git.run(["ls-files", "-z"]), git.run(["rev-list", "--all", "--count"]), git.stashHistory(1000)]);
    return {
      environment: { platform: `${process.platform} ${os.release()}`, node: process.version, electron: process.versions.electron, git: gitVersion, obsidian: document.title.match(/Obsidian ([\d.]+)/)?.[1] || "unknown", installer: JSON.parse(await fs.readFile(path.join(process.resourcesPath, "app.asar", "package.json"), "utf8")).version, plugin: manager.plugins[id].manifest.version },
      scenario: "Same live note_test vault; sidebar closed, openOnStartup=false; one warm-up, five reloads. loadPlugin includes script loading/evaluation, onload and CSS. First sidebar includes Git status and layout; first diff includes Git/file reads, MergeView creation and synchronous layout, not final paint. Warm OS/V8 cache; not a full application cold start.",
      preferences: legacy ? "Existing preferences missing two newer default fields" : "Existing preferences with all default fields",
      scale: { indexedVaultFiles: app.vault.getFiles().length, gitFiles: counts[0].split("\0").filter(Boolean).length, commits: Number(counts[1]), stashes: counts[2].length, fixtureLines: 80 },
      samples, summary: Object.fromEntries(["loadPluginMs", "beforeOnloadMs", "onloadMs", "settingsReadMs", "firstSidebarMs", "firstDiffMs"].map(key => [key, summarize(key)])),
      bundleBytes: (await fs.stat(path.join(app.vault.adapter.getBasePath(), initial.manifest.dir, "main.js"))).size,
    };
  } finally {
    sample = null;
    loadOwner.load = originalLoad;
    app.vault.readPluginData = readData; app.vault.writePluginData = writeData;
    await closeViews();
    if (app.vault.getAbstractFileByPath(filePath)) await app.vault.trash(file, false);
    const plugin = manager.plugins[id] || await manager.loadPlugin(id);
    plugin.settings = settings; await plugin.saveData(settings);
    if (settings.openOnStartup) await plugin.openSidebar();
  }
})()
