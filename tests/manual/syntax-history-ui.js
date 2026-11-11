(async () => {
  if (app.vault.getName() !== "note_test") throw Error("Run only in the note_test vault.");
  const p = app.plugins.plugins.vaultbranch;
  if (!p || [...p.editSessions.values()].some(s => s.dirty || s.saving)) throw Error("Save all diff drafts first.");
  const fs = require("node:fs/promises"), os = require("node:os"), path = require("node:path");
  const exec = require("node:util").promisify(require("node:child_process").execFile);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vaultbranch-syntax-history-"));
  const original = { git: p.git, status: p.status, ready: p.ready, refresh: p.lastAutoRefresh, syntax: p.settings.syntaxHighlighting };
  const git = async (...args) => (await exec(original.git.binary, args, { cwd: root, windowsHide: true })).stdout;
  const results = [], check = (value, label) => { if (!value) throw Error(label); results.push(label); };
  const pause = () => new Promise(resolve => setTimeout(resolve, 120));
  let leaf;
  try {
    await git("init", "-b", "main"); await git("config", "user.name", "Syntax UI"); await git("config", "user.email", "syntax@example.invalid");
    await git("config", "core.autocrlf", "false");
    await fs.writeFile(path.join(root, "old.md"), "# Heading\n\n**bold** and `code`\n");
    await fs.writeFile(path.join(root, "config.json"), '{"key":"before","count":1}\n');
    await git("add", "."); await git("commit", "-m", "Create Markdown and JSON");
    await fs.writeFile(path.join(root, "config.json"), '{"key":"after","count":2}\n');
    await git("commit", "-am", "Edit JSON");
    await git("mv", "old.md", "renamed.txt"); await git("commit", "-m", "Rename Markdown to plain text");
    if (p.refreshTask) await p.refreshTask; p.refreshSoon?.cancel(); p.lastAutoRefresh = Date.now() + 3600000;
    p.git = new original.git.constructor(root, { binary: original.git.binary }); await p.git.init(); p.ready = true; p.status = await p.git.status();
    await p.updateSetting("syntaxHighlighting", true);
    const index = await git("write-tree");
    leaf = await p.openFileHistory("config.json"); await leaf.view.updateSyntaxHighlight(); await pause();
    const view = leaf.view, merge = view.merge;
    check(merge.a.contentDOM.querySelector(".vb-syntax-property") && merge.b.contentDOM.querySelector(".vb-syntax-string"), "file history highlights both parent and commit JSON");
    check(merge.a.state.readOnly && merge.b.state.readOnly && !view.contentEl.querySelector(".cm-merge-revert button"), "history remains readonly without revert controls");
    await p.updateSetting("syntaxHighlighting", false); await pause();
    check(view.merge === merge && !view.contentEl.querySelector('[class*="vb-syntax-"]'), "history setting updates colors without replacing comparison");
    await p.updateSetting("syntaxHighlighting", true);
    await leaf.detach(); leaf = await p.openFileHistory("renamed.txt"); await leaf.view.updateSyntaxHighlight(); await pause();
    check(!leaf.view.contentEl.querySelector('[class*="vb-syntax-"]'), "current .txt history is plain text");
    await leaf.view.selectCommit(leaf.view.commits.find(commit => commit.path === "old.md"));
    await leaf.view.updateSyntaxHighlight(); await pause();
    check(leaf.view.merge.b.contentDOM.querySelector(".vb-syntax-heading"), "older revision uses historical Markdown extension after rename");
    check(await git("write-tree") === index, "history highlighting leaves the staged index unchanged");
    await leaf.detach(); leaf = null;
    check(!p.editSessions.size, "history creates no editable sessions");
    check(!(window.__vaultbranchErrors || []).length, "no runtime errors");
    return { results, errors: window.__vaultbranchErrors || [] };
  } finally {
    await leaf?.detach(); p.git = original.git; p.status = original.status; p.ready = original.ready; p.lastAutoRefresh = original.refresh;
    await p.updateSetting("syntaxHighlighting", original.syntax); await p.refresh();
    await fs.rm(root, { recursive: true, force: true });
  }
})()
