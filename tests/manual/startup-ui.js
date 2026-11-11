(async () => {
  if (app.vault.getName() !== "note_test") throw Error("Run only in the note_test vault.");
  const id = "vaultbranch", manager = app.plugins;
  let plugin = manager.plugins[id];
  if (!plugin || [...plugin.editSessions.values()].some(session => session.dirty || session.saving)) throw Error("Enable VaultBranch and save diff drafts first.");
  const settings = { ...plugin.settings }, results = [];
  const check = (condition, message) => { if (!condition) throw Error(message); results.push(message); };
  const filePath = "vaultbranch-startup-ui.md";
  if (await app.vault.adapter.exists(filePath)) throw Error("Fixture already exists.");
  const contents = "# Startup restore fixture\n";
  const file = await app.vault.create(filePath, contents);
  const closeViews = async () => {
    const leaves = [];
    app.workspace.iterateAllLeaves(leaf => { if (leaf.view.getViewType().startsWith("vaultbranch-")) leaves.push(leaf); });
    for (const leaf of leaves) await leaf.detach();
  };
  const reload = async () => {
    await closeViews();
    if (plugin.refreshTask) await plugin.refreshTask;
    plugin.refreshSoon?.cancel();
    await manager.disablePlugin(id);
    plugin = await manager.loadPlugin(id);
  };
  const restore = async (type, state = {}) => {
    const leaf = app.workspace.getLeaf(true);
    await leaf.setViewState({ type, state, active: true });
    check(plugin.isView(leaf.view, type), `${type} restores through its registered factory`);
    return leaf;
  };
  try {
    await plugin.updateSetting("openOnStartup", false);
    await plugin.updateSetting("diffAutosave", false);
    await reload();
    check(Object.keys(plugin.viewClasses).length === 0, "closed workspace loads no view implementations");
    check(!plugin.ready, "closed workspace does not initialize Git status");
    const source = await restore("vaultbranch-source-control");
    check(Object.keys(plugin.viewClasses).length === 1, "sidebar restoration leaves other implementations deferred");
    await source.detach();
    const first = await plugin.openDiff({ path: filePath, untracked: true }, "unstaged");
    first.view.merge.b.dispatch({ changes: { from: 0, to: first.view.merge.b.state.doc.length, insert: "# Restored manual draft\n" } });
    const state = first.view.getState();
    check(Boolean(state.editDraft), "workspace state contains the manual draft");
    await reload();
    check(Object.keys(plugin.viewClasses).length === 0, "reload resets deferred view classes");
    const diff = await restore("vaultbranch-diff", state);
    check(diff.view.merge.b.state.doc.toString() === "# Restored manual draft\n", "first restored diff preserves its serialized draft");
    check(diff.view.merge.a.state.readOnly && !diff.view.merge.b.state.readOnly, "restored diff retains index and working access modes");
    check(await app.vault.read(file) === contents, "restoring manual draft does not save to disk");
    diff.view.merge.b.dispatch({ changes: { from: 0, to: diff.view.merge.b.state.doc.length, insert: contents } });
    await diff.detach();
    check(plugin.editSessions.size === 0, "closing restored clean diff releases its editor session");
    await restore("vaultbranch-history");
    await restore("vaultbranch-file-history");
    await restore("vaultbranch-conflict");
    await restore("vaultbranch-source-control");
    check(Object.keys(plugin.viewClasses).length === 5, "all five implementations load on demand");
    check(!(window.__vaultbranchErrors || []).length, "no runtime errors");
    return { results, errors: window.__vaultbranchErrors || [] };
  } finally {
    const session = plugin.editSessions.get(filePath);
    if (session && !session.saving) session.edit(contents);
    await closeViews();
    if (app.vault.getAbstractFileByPath(filePath)) await app.vault.trash(file, false);
    plugin.settings = settings; await plugin.saveData(settings);
    if (settings.openOnStartup) await plugin.openSidebar();
  }
})()
