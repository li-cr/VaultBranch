(async () => {
  if (app.vault.getName() !== "note_test") throw Error("Run only in the note_test vault.");
  const plugin = app.plugins.plugins.vaultbranch;
  if (!plugin || [...(plugin.editors?.sessions || plugin.editSessions).values()].some(session => session.dirty || session.saving)) throw Error("Enable VaultBranch and save diff drafts first.");
  const workspace = app.workspace, fs = require("node:fs/promises"), path = require("node:path"), crypto = require("node:crypto");
  const original = { open: plugin.settings.openOnStartup, seconds: plugin.settings.refreshSeconds, last: plugin.lastAutoRefresh, collapsed: workspace.rightSplit.collapsed };
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const closeSource = async () => { for (const leaf of workspace.getLeavesOfType("vaultbranch-source-control")) await leaf.detach(); };
  const run = plugin.git.run;
  let calls = [], collecting = false, other;
  const results = [];
  const indexHash = async () => crypto.createHash("sha256").update(await fs.readFile(path.join(plugin.git.gitDir, "index"))).digest("hex");
  try {
    plugin.settings.openOnStartup = false;
    plugin.settings.refreshSeconds = 3600;
    plugin.lastAutoRefresh = Date.now() + 3600000;
    await plugin.ensureReady();
    await closeSource();
    if (plugin.refreshTask) await plugin.refreshTask;
    plugin.refreshSoon?.cancel();
    const beforeIndex = await indexHash();
    plugin.git.run = function (args, ...rest) { if (collecting) calls.push(args[0]); return run.call(this, args, ...rest); };
    for (const mode of ["closed", "collapsed", "background-tab", "visible"]) {
      await closeSource();
      if (other) { await other.detach(); other = null; }
      if (mode !== "closed") {
        const leaf = await plugin.openSidebar();
        if (mode === "collapsed") workspace.rightSplit.collapse();
        if (mode === "background-tab") { other = workspace.createLeafInParent(leaf.parent, leaf.parent.children.length); await other.setViewState({ type: "empty", active: true }); await workspace.revealLeaf(other); }
      }
      await pause(800);
      if (plugin.refreshTask) await plugin.refreshTask;
      plugin.refreshSoon?.cancel();
      calls = []; collecting = true;
      for (let n = 0; n < 20; n++) plugin.scheduleRefresh();
      await pause(900);
      if (plugin.refreshTask) await plugin.refreshTask;
      collecting = false;
      results.push({ mode, eventBurst: 20, gitSubprocesses: calls.length, commands: [...calls] });
    }
    return { version: plugin.manifest.version, obsidian: document.title.match(/Obsidian ([\d.]+)/)?.[1], platform: process.platform, node: process.version, indexedFiles: app.vault.getFiles().length, results, indexUnchanged: beforeIndex === await indexHash(), scope: "One burst of 20 scheduleRefresh requests per real sidebar state; 900 ms debounce window; initialized Git, periodic polling suppressed. Counts, not latency or application startup." };
  } finally {
    collecting = false; plugin.git.run = run;
    plugin.refreshSoon?.cancel();
    if (other) await other.detach();
    await closeSource();
    plugin.settings.openOnStartup = original.open;
    plugin.settings.refreshSeconds = original.seconds;
    if (original.open) await plugin.openSidebar();
    if (original.collapsed) workspace.rightSplit.collapse();
    else workspace.rightSplit.expand();
    plugin.lastAutoRefresh = original.last;
  }
})()
