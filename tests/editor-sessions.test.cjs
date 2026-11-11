"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EditorSessions } = require("../src/editor-sessions.js");

function fixture(read) {
  const state = { disk: "working\n", notifications: 0, saves: 0, processes: 0 };
  const vault = {
    getAbstractFileByPath: path => ({ path, extension: "md" }),
    async process(file, update) { state.processes++; state.disk = update(state.disk); },
    adapter: { process() { throw Error("A visible file must use vault.process"); } },
  };
  const editors = new EditorSessions({ vault, read: read || (async () => ({ index: "index\n", working: state.disk })),
    enabled: () => false, changed: () => { state.notifications++; }, saved: () => { state.saves++; } });
  return { editors, state, vault };
}

test("different files open independently while concurrent views share only the same file's read", async () => {
  let release, reads = 0;
  const blocked = new Promise(resolve => { release = resolve; });
  const { editors } = fixture(async path => {
    reads++;
    if (path === "large.json") await blocked;
    return { index: "index\n", working: path + "\n" };
  });
  const first = editors.acquire("large.json", true), shared = editors.acquire("large.json", true);
  const small = await editors.acquire("small.md", true);
  assert.equal(small.draft.text, "small.md\n");
  assert.equal(reads, 2);
  release();
  const [a, b] = await Promise.all([first, shared]);
  assert.equal(a, b);
  assert.equal(a.users, 2);
  assert.equal(editors.pending.size, 0);
  editors.release("large.json", a); editors.release("large.json", b); editors.release("small.md", small);
  assert.equal(editors.sessions.size, 0);
  assert.equal(editors.drafts.size, 0);
});

test("a failed read can be retried without losing a restored workspace draft", async () => {
  let fail = true;
  const { editors } = fixture(async () => { if (fail) throw Error("read failed"); return { index: "index\n", working: "working\n" }; });
  const draft = { index: "index\n", working: "working\n", text: "restored draft\n" };
  editors.drafts.set("note.md", draft);
  await assert.rejects(editors.acquire("note.md", true), /read failed/);
  assert.equal(editors.pending.size, 0);
  assert.equal(editors.sessions.size, 0);
  assert.equal(editors.drafts.get("note.md"), draft);
  fail = false;
  const session = await editors.acquire("note.md", true);
  assert.equal(session.draft.text, "restored draft\n");
  editors.release("note.md", session);
  assert.equal(editors.sessions.get("note.md"), session);
  editors.stop();
  assert.equal(editors.drafts.get("note.md"), draft);
});

test("normal vault writes retain compare-before-write protection and preserve a racing external edit", async () => {
  const { editors, state, vault } = fixture();
  const session = await editors.acquire("note.md", true);
  session.edit("saved\n");
  assert.equal(await session.flush(), true);
  assert.equal(state.disk, "saved\n");
  assert.equal(state.processes, 1);
  assert.equal(state.saves, 1);
  session.edit("draft\n");
  vault.process = async (file, update) => { state.disk = "external\n"; state.disk = update(state.disk); };
  assert.equal(await session.flush(), false);
  assert.equal(state.disk, "external\n");
  assert.equal(session.draft.text, "draft\n");
  assert.equal(session.draft.index, "index\n");
  editors.release("note.md", session);
  assert.equal(editors.sessions.get("note.md"), session);
  editors.stop();
});
