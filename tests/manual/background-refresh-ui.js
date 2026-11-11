(async () => {
  if (app.vault.getName() !== "note_test") throw Error("Run only in the note_test vault.");
  const plugin = app.plugins.plugins.vaultbranch, workspace = app.workspace;
  if (!plugin || [...plugin.editors.sessions.values()].some(session => session.dirty || session.saving)) throw Error("Enable VaultBranch and save diff drafts first.");
  const results = [], check = (condition, message) => { if (!condition) throw Error(message); results.push(message); };
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const settle = async () => { await pause(850); if (plugin.refreshTask) await plugin.refreshTask; };
  const settings = { ...plugin.settings }, collapsed = workspace.rightSplit.collapsed;
  const run = plugin.git.run, refresh = plugin.refresh;
  let statusCalls = 0, sidebarRefreshes = 0, other, diff;
  const filePath = "vaultbranch-background-refresh.md";
  if (await app.vault.adapter.exists(filePath)) throw Error("Fixture already exists.");
  const file = await app.vault.create(filePath, "original\n");
  const closeSource = async () => { for (const leaf of workspace.getLeavesOfType("vaultbranch-source-control")) await leaf.detach(); };
  try {
    plugin.settings.openOnStartup = false; plugin.settings.diffAutosave = false; plugin.settings.refreshSeconds = 1;
    await closeSource(); await settle();
    plugin.git.run = function (args, ...rest) { if (args[0] === "status") statusCalls++; return run.call(this, args, ...rest); };
    plugin.refresh = function (...args) { sidebarRefreshes++; return refresh.apply(this, args); };
    for (let n = 0; n < 20; n++) plugin.scheduleRefresh();
    await settle();
    check(statusCalls === 0, "closed sidebar ignores background status refresh requests");
    const source = await plugin.openSidebar(); await settle();
    check(statusCalls > 0 && plugin.status, "opening sidebar loads current Git status");
    workspace.rightSplit.collapse(); await settle(); statusCalls = 0;
    for (let n = 0; n < 20; n++) plugin.scheduleRefresh();
    plugin.lastAutoRefresh = 0; await pause(1700); if (plugin.refreshTask) await plugin.refreshTask;
    check(statusCalls === 0, "collapsed sidebar skips both event bursts and periodic polling");
    workspace.rightSplit.expand(); await workspace.revealLeaf(source); await settle();
    check(statusCalls > 0, "expanding sidebar refreshes current status");
    other = workspace.createLeafInParent(source.parent, source.parent.children.length);
    await other.setViewState({ type: "empty", active: true }); await workspace.revealLeaf(other); await settle(); statusCalls = 0;
    plugin.lastAutoRefresh = 0; plugin.scheduleRefresh(); await pause(1700); if (plugin.refreshTask) await plugin.refreshTask;
    check(statusCalls === 0, "inactive sidebar tab skips event refresh and periodic polling");
    await workspace.revealLeaf(source); await settle();
    check(statusCalls > 0, "returning to sidebar tab refreshes current status");
    await other.detach(); other = null;
    diff = await plugin.openDiff({ path: filePath, untracked: true }, "unstaged");
    await closeSource(); await settle(); statusCalls = 0; sidebarRefreshes = 0;
    await app.vault.modify(file, "external clean\n"); await settle();
    check(diff.view.merge.b.state.doc.toString() === "external clean\n", "closed sidebar still synchronizes clean external editor changes");
    diff.view.merge.b.dispatch({ changes: { from: 0, to: diff.view.merge.b.state.doc.length, insert: "manual draft\n" } });
    await app.vault.modify(file, "external concurrent\n"); await settle();
    check(diff.view.merge.b.state.doc.toString() === "manual draft\n", "closed sidebar retains manual draft during concurrent external change");
    check(await app.vault.read(file) === "external concurrent\n", "external content remains on disk without draft overwrite");
    check(sidebarRefreshes === 0, "editor synchronization does not trigger hidden-sidebar refreshes");
    check(statusCalls > 0, "editor synchronization retains its own Git conflict safety checks");
    statusCalls = 0;
    await plugin.refresh(true);
    check(statusCalls === 1, "explicit refresh remains available without sidebar");
    await diff.view.session.reload(); await diff.detach(); diff = null;
    check(!plugin.editors.sessions.has(filePath), "closing clean editor releases its session");
    check(!(window.__vaultbranchErrors || []).length, "no runtime errors");
    return { results, errors: window.__vaultbranchErrors || [] };
  } finally {
    plugin.git.run = run; plugin.refresh = refresh;
    if (diff) { await diff.view.session?.reload(); await diff.detach(); }
    if (other) await other.detach();
    await closeSource();
    if (app.vault.getAbstractFileByPath(filePath)) await app.vault.trash(file, false);
    plugin.settings = settings;
    if (settings.openOnStartup) await plugin.openSidebar();
    if (collapsed) workspace.rightSplit.collapse(); else workspace.rightSplit.expand();
  }
})()
