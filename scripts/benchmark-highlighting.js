(async () => {
  if (app.vault.getName() !== "note_test") throw Error("Run only in the note_test vault.");
  const p = app.plugins.plugins.vaultbranch;
  if (!p || [...(p.editors?.sessions || p.editSessions).values()].some(s => s.dirty || s.saving)) throw Error("Save all diff drafts first.");
  const original = { ...p.settings }, files = [], samples = [];
  const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
  const round = n => Number(n.toFixed(3));
  const summary = values => { values.sort((a, b) => a - b); return { median: values[Math.floor(values.length / 2)], range: [values[0], values.at(-1)] }; };
  const fixtures = {
    json: '{\n' + Array.from({ length: 2000 }, (_, n) => `  "key${n}": "paragraph value ${n}"`).join(',\n') + '\n}\n',
    md: Array.from({ length: 2000 }, (_, n) => n % 10 ? `paragraph ${n} with **bold**, *italic*, [link](https://example.com) and \`code\`.` : `## Heading ${n}`).join('\n') + '\n',
  };
  let leaf;
  try {
    await p.updateSetting("diffAutosave", false); await p.updateSetting("collapseUnchanged", false);
    for (const [extension, text] of Object.entries(fixtures)) {
      const file = await app.vault.create(`vb-highlight-bench-${Date.now()}.${extension}`, text); files.push(file);
      // Alternate modes to reduce ordering bias. Discard one warm-up per mode.
      for (let iteration = 0; iteration < 6; iteration++) for (const enabled of iteration % 2 ? [true, false] : [false, true]) {
        await p.updateSetting("syntaxHighlighting", enabled);
        let started = performance.now();
        leaf = await p.openDiff({ path: file.path, untracked: true, index: "?", worktree: "?" }, "unstaged");
        await leaf.view.updateSyntaxHighlight();
        const editor = leaf.view.merge.b;
        editor.dom.getBoundingClientRect();
        const openLayoutMs = round(performance.now() - started);
        await frame(); await frame();
        const openFramesMs = round(performance.now() - started);
        if (Boolean(editor.contentDOM.querySelector('[class*="vb-syntax-"]')) !== enabled) throw Error("Highlighting correctness failed.");
        const position = text.indexOf("paragraph") + 3;
        started = performance.now();
        for (let key = 0; key < 30; key++) {
          editor.dispatch({ changes: { from: position, insert: "x" }, selection: { anchor: position + 1 } });
          editor.dom.getBoundingClientRect();
        }
        const typingBatchMs = round(performance.now() - started);
        editor.dispatch({ changes: { from: position, to: position + 30 } });
        if (editor.state.doc.toString() !== text || leaf.view.session.dirty) throw Error("Draft correctness failed.");
        await leaf.detach(); leaf = null;
        if ((p.editors?.sessions || p.editSessions).size) throw Error("Editor session leaked.");
        if (iteration) samples.push({ extension, enabled, iteration, openLayoutMs, openFramesMs, typingBatchMs });
      }
    }
    return {
      environment: { obsidian: document.title, node: process.version, electron: process.versions.electron, platform: process.platform },
      scenario: "Warm live note_test, untracked synthetic files. Five opens per mode/language after one discarded warm-up; modes alternate. Open layout includes Git/file reads, editor creation, highlight configuration and synchronous layout. Frames adds two animation frames (not guaranteed complete background parsing). Typing measures 30 visible-line insert transactions with synchronous layout, excluding final paint, disk writes and Git. Autosave and folding off. No cold-start claim.",
      scale: Object.fromEntries(Object.entries(fixtures).map(([key, text]) => [key, { characters: text.length, lines: text.split('\n').length }])),
      samples,
      summary: Object.fromEntries(Object.keys(fixtures).flatMap(extension => [false, true].map(enabled => {
        const group = samples.filter(s => s.extension === extension && s.enabled === enabled);
        return [`${extension}-${enabled ? 'on' : 'off'}`, Object.fromEntries(["openLayoutMs", "openFramesMs", "typingBatchMs"].map(key => [key, summary(group.map(s => s[key]))]))];
      }))),
    };
  } finally {
    if (leaf) { await leaf.view.session?.reload(); await leaf.detach(); }
    for (const file of files) if (app.vault.getAbstractFileByPath(file.path)) await app.vault.trash(file, false);
    for (const key of ["syntaxHighlighting", "collapseUnchanged", "diffAutosave"]) await p.updateSetting(key, original[key]);
  }
})()
