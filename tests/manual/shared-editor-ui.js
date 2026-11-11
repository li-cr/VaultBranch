(async () => {
  if (app.vault.getName() !== "note_test") throw Error("Run only in note_test.");
  const p = app.plugins.plugins.vaultbranch;
  if (!p || [...p.editSessions.values()].some(s => s.dirty || s.saving)) throw Error("Save drafts first.");
  const saved = { ...p.settings }, results = [], check = (value, label) => { if (!value) throw Error(label); results.push(label); };
  const name = `vaultbranch-shared-${Date.now()}.md`, original = "# Original\nvalue\n";
  const file = await app.vault.create(name, original);
  let first, second;
  try {
    await p.updateSetting("diffAutosave", false);
    first = await p.openDiff({ path: name, untracked: true }, "unstaged");
    second = app.workspace.getLeaf("tab");
    await second.setViewState({ type: "vaultbranch-diff", state: { file: { path: name, untracked: true }, area: "unstaged" } });
    const a = first.view, b = second.view, session = a.session;
    check(session === b.session && session.users === 2, "two views share one retained editor session");
    a.merge.b.dispatch({ changes: { from: 0, insert: "first draft\n" } });
    check(b.merge.b.state.doc.toString() === "first draft\n" + original, "first view input synchronizes to second view");
    check(session.document.doc === a.merge.b.state.doc, "session retains the originating native document");
    b.merge.b.dispatch({ changes: { from: 0, insert: "second draft\n" } });
    check(a.merge.b.state.doc.toString() === "second draft\nfirst draft\n" + original, "second view input synchronizes to first view");
    const state = JSON.parse(JSON.stringify(b.getState()));
    check(typeof state.editDraft.text === "string" && state.editDraft.text === a.merge.b.state.doc.toString(), "workspace snapshots serialize the latest plain-text draft");
    check(await app.vault.read(file) === original, "shared manual drafts do not write to disk");
    await first.detach(); first = null;
    check(session.users === 1 && p.editSessions.get(name) === session, "closing one view retains the shared session");
    b.merge.b.dispatch({ changes: { from: 0, insert: "latest\n" } });
    await b.saveEditor();
    check(await app.vault.read(file) === b.merge.b.state.doc.toString() && !session.dirty, "remaining view saves the latest native document");
    await second.detach(); second = null;
    check(!p.editSessions.has(name) && !p.diffDrafts.has(name), "closing the saved final view releases session and draft");
    check(!(window.__vaultbranchErrors || []).length, "no runtime errors");
    return { results };
  } finally {
    if (first) { await first.view.session?.reload(); await first.detach(); }
    if (second) { await second.view.session?.reload(); await second.detach(); }
    for (const key of ["diffAutosave"]) await p.updateSetting(key, saved[key]);
    if (app.vault.getAbstractFileByPath(name)) await app.vault.trash(file, false);
    await p.refresh();
  }
})()
