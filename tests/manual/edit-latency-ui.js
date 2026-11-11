(async () => {
  if (app.vault.getName() !== "note_test" || !window.__vbStagedSwitch) throw Error("Run staged-switch-ui.js in note_test first.");
  const p = app.plugins.plugins.vaultbranch, web = require("electron").remote.getCurrentWebContents();
  const samples = [], checks = [], pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const summary = values => {
    const sorted = [...values].sort((a, b) => a - b);
    return { median: sorted[Math.floor(sorted.length / 2)], range: [sorted[0], sorted.at(-1)], count: sorted.length };
  };
  const check = (condition, message) => { if (!condition) throw Error(message); checks.push(message); };
  const paths = ["small/note.md", "large/deep/json/data.json", "small/deep/json/data.json", "large/note.md"];
  try {
    Object.assign(p.settings, { diffAutosave: false, syntaxHighlighting: false, collapseUnchanged: false, performanceLogging: false });
    for (const name of paths) {
      const file = p.status.files.find(file => file.path === `changed/${name}`);
      const leaf = await p.openDiff(file, "unstaged"), view = leaf.view, editor = view.merge.b;
      const original = editor.state.doc.toString(), at = Math.floor(original.length / 2);
      const dispatch = editor.dispatch;
      let pending;
      const events = [];
      const begin = event => { events.push({ type: event.type, key: event.key, inputType: event.inputType, trusted: event.isTrusted }); if (pending && !pending.event) pending.event = { start: performance.now(), type: event.type, trusted: event.isTrusted }; };
      for (const type of ["keydown", "beforeinput"]) editor.contentDOM.addEventListener(type, begin, true);
      editor.dispatch = function (...args) {
        const before = this.state.doc, started = performance.now();
        const result = dispatch.apply(this, args);
        if (pending && this.state.doc !== before) {
          const done = pending; pending = null;
          const end = performance.now();
          if (!done.event?.trusted) { done.reject(Error("Missing trusted native editing event")); return result; }
          const record = { path: name, round: done.round, operation: done.operation, trusted: true, event: done.event.type,
            inputToDocumentMs: end - done.event.start, synchronousDispatchMs: end - started, deliveryToDocumentMs: end - done.sent };
          let settled = false;
          const finish = frameMs => { if (settled) return; settled = true; clearTimeout(timer); done.resolve({ ...record, nextFrameMs: frameMs }); };
          const timer = setTimeout(() => finish(null), 250);
          requestAnimationFrame(() => finish(performance.now() - done.event.start));
        }
        return result;
      }.bind(editor);
      try {
        for (let round = 0; round < 6; round++) {
          editor.dispatch({ selection: { anchor: at } }); editor.focus(); await pause(40);
          for (const operation of ["insert", "newline", "delete"]) {
            const record = await new Promise((resolve, reject) => {
              const timer = setTimeout(() => { pending = null; reject(Error("Native editing timeout: " + operation + " " + JSON.stringify({ events, active: document.activeElement?.className, focused: document.hasFocus() }))); }, 3000);
              pending = { round, operation, sent: performance.now(), resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } };
              if (operation === "insert") web.sendInputEvent({ type: "char", keyCode: "x" });
              else {
                const keyCode = operation === "newline" ? "Enter" : "Backspace";
                web.sendInputEvent({ type: "keyDown", keyCode }); web.sendInputEvent({ type: "keyUp", keyCode });
              }
            });
            if (round) samples.push(record);
          }
          editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: original } });
          check(editor.state.doc.toString() === original && !view.session.dirty, `${name} round ${round} restores original text`);
        }
      } finally {
        editor.dispatch = dispatch;
        for (const type of ["keydown", "beforeinput"]) editor.contentDOM.removeEventListener(type, begin, true);
        if (view.session?.dirty) view.session.draft.text = view.session.savedText;
        await leaf.detach();
      }
    }
    const fixture = await window.__vbStagedSwitch.report();
    check(fixture.indexUnchanged, "native input leaves the index unchanged");
    check((p.editors?.sessions || p.editSessions).size === 0, "closed clean views release their sessions");
    check(!(window.__vaultbranchErrors || []).length, "no runtime errors");
    return { version: p.manifest.version, note: "Trusted native input: event capture to CodeMirror document update, synchronous dispatch, and following animation-frame callback are separate. Frame callbacks are not physical paint. Five measured rounds after one warm-up, per file and operation; saving and Git are outside editing timers. CPU sampling, syntax highlighting, autosave, folding and timing logging are off.",
      environment: { userAgent: navigator.userAgent, node: process.version, focused: document.hasFocus(), visibility: document.visibilityState }, fixtures: fixture.fixtures, checks, samples,
      summary: Object.fromEntries(paths.map(name => [name, Object.fromEntries(["insert", "newline", "delete"].map(operation => {
        const records = samples.filter(sample => sample.path === name && sample.operation === operation);
        return [operation, Object.fromEntries(["inputToDocumentMs", "synchronousDispatchMs", "deliveryToDocumentMs", "nextFrameMs"].map(key => [key, summary(records.map(record => record[key]).filter(value => value !== null))]))];
      }))])) };
  } finally { await window.__vbStagedSwitch.cleanup(); }
})()
