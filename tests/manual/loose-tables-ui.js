(async () => {
  if (app.vault.getName() !== "note_test") throw Error("Run only in note_test.");
  const p = app.plugins.plugins.vaultbranch;
  if (!p || [...p.editors.sessions.values()].some(s => s.dirty || s.saving)) throw Error("Save diff drafts first.");
  await p.diffNavigationTask; await p.refreshTask; p.refreshSoon?.cancel();
  const settings = { ...p.settings }, scheduleRefresh = p.scheduleRefresh, lastAutoRefresh = p.lastAutoRefresh;
  const files = [], leaves = [], results = [], samples = [];
  const existingViews = app.workspace.getLeavesOfType("markdown").map(leaf => leaf.view.containerEl);
  const check = (value, label) => { if (!value) throw Error(label); results.push(label); };
  const wait = async predicate => { const deadline = performance.now() + 15000; while (!await predicate()) { if (performance.now() > deadline) throw Error("Table UI timeout"); await new Promise(r => setTimeout(r, 10)); } };
  const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const remote = require("electron").remote, web = remote.getCurrentWebContents();
  remote.getCurrentWindow().show(); remote.getCurrentWindow().focus();
  const click = async node => {
    node.scrollIntoView({ block: "center" }); await frame();
    const rect = node.getBoundingClientRect(), point = { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2), button: "left", clickCount: 1 };
    const done = new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error("Table click timeout")), 3000); node.addEventListener("mousedown", event => { clearTimeout(timer); resolve(event.isTrusted); }, { once: true }); });
    web.sendInputEvent({ type: "mouseDown", ...point }); web.sendInputEvent({ type: "mouseUp", ...point });
    check(await done, "table receives a trusted native mouse event");
  };
  const plainTable = "| Dataset | Count | Status |\n|---|---:|:---:|\n| alpha | 12 | yes |\n| beta | 34 | no |";
  const source = "总体分析：\n" + plainTable + "\n\nFormatting:\n| Bold | Code | Link |\n|---|---|---|\n| **strong** | `value` | [[欢迎\\|Alias]] |\n\nNative:\n\n| Native | Count |\n|---|---|\n| retained | 7 |\n\n```markdown\nCode example:\n| Fake | Count |\n|---|---|\n| keep source | 9 |\n```\n\nTail paragraph.\n";
  const create = async (suffix, text) => { const file = await app.vault.create(`vaultbranch-table-ui-${Date.now()}-${suffix}.md`, text); files.push(file); return file; };
  const open = async (file, mode, sourceMode = false) => { const leaf = app.workspace.getLeaf("tab"); leaves.push(leaf); await leaf.openFile(file); await leaf.setViewState({ type: "markdown", state: { file: file.path, mode, source: sourceMode } }); return leaf; };
  const screenshot = async name => {
    if (window.__vbReleaseOptions?.outputDir) await require("node:fs/promises").writeFile(require("node:path").join(window.__vbReleaseOptions.outputDir, name + ".png"), (await web.capturePage()).toPNG());
  };
  try {
    p.scheduleRefresh = () => {}; p.lastAutoRefresh = Date.now() + 3600000;
    const index = await p.git.run(["write-tree"]), file = await create("small", source);
    await p.updateSetting("renderLooseTables", false);
    const reading = await open(file, "preview"), readingRoot = reading.view.previewMode.containerEl;
    await wait(() => readingRoot.querySelector("pre"));
    check(readingRoot.querySelectorAll("table").length === 1, "off leaves native tables intact and loose tables as source");
    let reads = 0;
    for (let round = 0; round < 6; round++) {
      const start = performance.now();
      await p.tableProcessor(null, { getSectionInfo() { reads++; } });
      if (round) samples.push({ operation: "disabled processor", ms: performance.now() - start });
    }
    check(reads === 0, "disabled processor performs no DOM scan or source lookup");
    await p.updateSetting("renderLooseTables", true);
    const field = p.tableExtensions[0];
    check((await p.loadData()).renderLooseTables === true, "the compatibility switch is saved across reloads");
    await wait(() => readingRoot.querySelectorAll("table").length === 3);
    check(readingRoot.querySelectorAll("table")[0].querySelectorAll("tbody tr").length === 2, "Reading view renders a table immediately after Chinese paragraph text");
    check(readingRoot.querySelector("table th:nth-child(2)").getAttribute("align") === "right", "native column alignment is preserved");
    check(readingRoot.querySelectorAll("table")[1].querySelector("strong") && readingRoot.querySelectorAll("table")[1].querySelector("code") && readingRoot.querySelectorAll("table")[1].querySelector("a.internal-link"), "native bold, code and wikilinks are preserved in table cells");
    check(readingRoot.querySelector("pre code").textContent.includes("| Fake | Count |"), "fenced Markdown examples remain code");
    check(await app.vault.read(file) === source, "Reading compatibility never writes a blank line to the original note");
    await frame(); await screenshot("loose-tables-reading");
    const editing = await open(file, "source"), cm = editing.view.editor.cm;
    cm.dispatch({ selection: { anchor: 0 } });
    await wait(() => editing.view.contentEl.querySelector(".vaultbranch-loose-table table"));
    check(editing.view.contentEl.querySelector(".markdown-source-view.is-live-preview") && cm.state.field(p.tableExtensions[0]).tables.length === 2, "Live Preview renders exactly the two loose tables");
    const firstWidget = editing.view.contentEl.querySelector(".vaultbranch-loose-table");
    await click(firstWidget.querySelector("td"));
    await wait(() => cm.state.field(p.tableExtensions[0]).decorations.size === 1);
    check(cm.state.field(p.tableExtensions[0]).decorations.size === 1 && cm.state.doc.toString() === source, "clicking a table exposes its source without changing the note");
    check(editing.view.contentEl.querySelector(".HyperMD-table-row .cm-hmd-table-sep"), "Live Preview source keeps native table delimiter highlighting");
    cm.dispatch({ selection: { anchor: source.indexOf("alpha") + 2 } }); cm.focus();
    let trusted = false;
    cm.contentDOM.addEventListener("beforeinput", event => { trusted = event.isTrusted; }, { once: true });
    web.sendInputEvent({ type: "char", keyCode: "x" });
    await wait(() => cm.state.doc.toString().includes("alxpha"));
    check(trusted, "table source accepts trusted native typing");
    await p.updateSetting("renderLooseTables", false);
    await wait(() => !editing.view.contentEl.querySelector(".vaultbranch-loose-table"));
    check(cm.state.doc.toString().includes("alxpha"), "disabling compatibility preserves the edited document");
    await p.updateSetting("renderLooseTables", true);
    cm.focus(); web.sendInputEvent({ type: "keyDown", keyCode: "Z", modifiers: ["control"] }); web.sendInputEvent({ type: "keyUp", keyCode: "Z", modifiers: ["control"] });
    await wait(() => cm.state.doc.toString() === source);
    check(cm.state.doc.toString() === source, "native undo survives toggling the feature");
    cm.dispatch({ selection: { anchor: source.length } });
    await wait(() => cm.state.field(p.tableExtensions[0]).decorations.size === 2);
    await frame(); await screenshot("loose-tables-live-preview");
    await app.workspace.revealLeaf(reading); await wait(() => readingRoot.querySelectorAll("table").length === 3);
    check(readingRoot.querySelectorAll("table").length === 3, "the same note can stay rendered in a separate Reading view");
    await app.workspace.revealLeaf(editing);
    await editing.setViewState({ type: "markdown", state: { file: file.path, mode: "source", source: true } }); await frame();
    check(!editing.view.contentEl.querySelector(".vaultbranch-loose-table"), "Source mode retains raw Markdown");
    const sourceEditor = editing.view.editor.cm;
    sourceEditor.dispatch({ selection: { anchor: source.indexOf("| Dataset") }, scrollIntoView: true }); await frame();
    const lineAt = at => { const node = sourceEditor.domAtPos(at).node; return (node.nodeType === 1 ? node : node.parentElement).closest(".cm-line"); };
    const looseLine = lineAt(source.indexOf("| Dataset") + 2), nativeLine = lineAt(source.indexOf("| Native") + 2);
    check(looseLine.classList.contains("HyperMD-table-row") && looseLine.querySelector(".cm-hmd-table-sep"), "Source mode highlights loose table rows and separators with host classes");
    check(getComputedStyle(looseLine).fontFamily === getComputedStyle(nativeLine).fontFamily && getComputedStyle(looseLine).fontSize === getComputedStyle(nativeLine).fontSize && getComputedStyle(looseLine).whiteSpace === getComputedStyle(nativeLine).whiteSpace, "loose table source font, size and whitespace match a native table");
    check(sourceEditor.state.doc.toString() === source, "source highlighting never reformats or pads the note");
    await screenshot("loose-tables-source");
    await p.updateSetting("renderLooseTables", false);
    await frame();
    check(!lineAt(source.indexOf("| Dataset") + 2).classList.contains("HyperMD-table-row"), "disabling restores the host's original source parsing");
    await app.workspace.revealLeaf(reading);
    await wait(() => readingRoot.querySelectorAll("table").length === 1);
    check(readingRoot.querySelectorAll("table").length === 1, "turning off immediately restores the open Reading view");
    await editing.detach(); await reading.detach();
    await wait(async () => await app.vault.read(file) === source);
    const Component = Object.getPrototypeOf(Object.getPrototypeOf(p.constructor));
    const container = document.createElement("div"); container.className = "markdown-reading-view"; document.body.appendChild(container);
    const component = new Component(); component.load();
    try {
      for (const enabled of [false, true]) {
        await p.updateSetting("renderLooseTables", enabled);
        for (let round = 0; round < 6; round++) {
          const element = container.createDiv({ cls: "el-p" });
          const paragraph = element.createEl("p"); paragraph.textContent = "Overall:\n" + plainTable;
          const context = { containerEl: container, sourcePath: file.path, getSectionInfo: () => ({ text: "Overall:\n" + plainTable, lineStart: 0, lineEnd: 4 }), addChild: child => component.addChild(child) };
          const start = performance.now(); await p.tableProcessor(element, context);
          if (round) samples.push({ operation: "Reading processor", enabled, ms: performance.now() - start });
          check(Boolean(element.querySelector("table")) === enabled, "processor output matches its setting"); element.remove();
        }
      }
    } finally { component.unload(); container.remove(); }
    await p.updateSetting("renderLooseTables", true);
    const largeSource = "Overall:\n" + plainTable + "\n\n" + "Paragraph with ordinary prose.\n\n".repeat(35000), large = await create("large", largeSource);
    for (const enabled of [false, true]) {
      await p.updateSetting("renderLooseTables", enabled);
      const leaf = await open(large, "source"), editor = leaf.view.editor.cm;
      editor.dispatch({ selection: { anchor: largeSource.length } }); editor.focus();
      for (let round = 0; round < 6; round++) {
        const start = performance.now(); field.spec.create(editor.state);
        if (round) samples.push({ operation: "Large-note compatibility field initialization", enabled, ms: performance.now() - start, bytes: Buffer.byteLength(largeSource) });
      }
      for (let round = 0; round < 6; round++) {
        let inputStart, inputTrusted, record;
        const begin = event => { inputStart = performance.now(); inputTrusted = event.isTrusted; };
        const dispatch = editor.dispatch;
        const updated = new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(Error("Table typing timeout")), 3000);
          editor.dispatch = function (...args) {
            const before = this.state.doc, start = performance.now(), value = dispatch.apply(this, args);
            if (this.state.doc !== before && inputStart !== undefined) { clearTimeout(timer); resolve({ inputToDocumentMs: performance.now() - inputStart, synchronousDispatchMs: performance.now() - start }); }
            return value;
          };
        });
        editor.contentDOM.addEventListener("beforeinput", begin, { once: true });
        try { web.sendInputEvent({ type: "char", keyCode: "x" }); record = await updated; }
        finally { editor.dispatch = dispatch; editor.contentDOM.removeEventListener("beforeinput", begin); }
        check(inputTrusted && document.hasFocus() && !editor.composing, "large-note typing uses focused trusted native input");
        if (round) samples.push({ operation: "Live Preview native input", enabled, ...record, bytes: Buffer.byteLength(largeSource) });
        editor.focus(); web.sendInputEvent({ type: "keyDown", keyCode: "Z", modifiers: ["control"] }); web.sendInputEvent({ type: "keyUp", keyCode: "Z", modifiers: ["control"] });
        await wait(() => editor.state.doc.length === largeSource.length);
      }
      await leaf.detach(); await wait(async () => await app.vault.read(large) === largeSource);
    }
    check([...document.querySelectorAll(".vaultbranch-loose-table")].every(node => existingViews.some(root => root.contains(node))), "closed test editor views leave no table widget DOM");
    check(await p.git.run(["write-tree"]) === index, "table rendering and source edits leave the staged index unchanged");
    check(!(window.__vaultbranchErrors || []).length, "no table runtime errors");
    return { results, samples, fixtures: files.map(file => ({ path: file.path, bytes: file.stat.size })), note: "Reading samples measure the compatibility processor including native Markdown rendering, excluding whole-page layout/paint. Field initialization measures full-note compatibility scanning/decoration setup, excluding native editor creation/render. Typing measures trusted native beforeinput to document update and synchronous dispatch separately. Five samples after one warm-up; timing/CPU sampling off." };
  } finally {
    for (const leaf of leaves) if (app.workspace.getLeavesOfType("markdown").includes(leaf)) await leaf.detach();
    await p.updateSetting("renderLooseTables", settings.renderLooseTables);
    p.scheduleRefresh = scheduleRefresh; p.lastAutoRefresh = lastAutoRefresh;
    for (const file of files) if (app.vault.getAbstractFileByPath(file.path)) await app.vault.trash(file, false);
    await p.refresh();
  }
})()
