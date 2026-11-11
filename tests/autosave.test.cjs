"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Autosave } = require("../src/autosave.js");
const { Text } = require("@codemirror/state");

function fixture(working = "old\n", options = {}) {
  let disk = working;
  const writes = [];
  const draft = { index: "staged\n", working, text: working.replace(/\r\n?/g, "\n") };
  const session = new Autosave(draft, {
    read: async () => ({ index: "staged\n", working: disk }),
    write: async (expected, content) => {
      assert.equal(disk, expected, "writes must compare the current disk content");
      disk = content; writes.push(content);
    },
    delay: 10,
    ...options,
  });
  return { session, draft, writes, get disk() { return disk; }, set disk(value) { disk = value; } };
}
const tick = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("manual mode retains drafts across idle and navigation until explicit save", async () => {
  const f = fixture("old\n", { enabled: false });
  f.session.edit("manual draft\n");
  await tick(40);
  assert.equal(await f.session.autoFlush(), false);
  assert.equal(f.disk, "old\n");
  assert.equal(f.draft.text, "manual draft\n");
  assert.deepEqual(f.writes, []);
  assert.equal(await f.session.flush(), true);
  assert.equal(f.disk, "manual draft\n");
});

test("turning off autosave cancels its timer; enabling it schedules retained drafts", async () => {
  const f = fixture();
  f.session.edit("retained\n");
  f.session.setEnabled(false);
  await tick(40);
  assert.deepEqual(f.writes, []);
  f.session.setEnabled(true);
  await tick(40); await f.session.task;
  assert.deepEqual(f.writes, ["retained\n"]);
});

test("idle autosave combines rapid edits and leaves the index unchanged", async () => {
  const f = fixture();
  f.session.edit("one\n"); f.session.edit("two\n"); f.session.edit("three\n");
  await tick(40); await f.session.task;
  assert.deepEqual(f.writes, ["three\n"]);
  assert.equal(f.draft.index, "staged\n");
  assert.equal(f.session.dirty, false);
});

test("flush saves pending input immediately before navigation, preserving CRLF and BOM", async () => {
  const f = fixture("\uFEFFold\r\n", { delay: 60000 });
  f.session.edit("\uFEFFedited\nnext\n");
  assert.equal(await f.session.flush(), true);
  assert.equal(f.disk, "\uFEFFedited\r\nnext\r\n");
  assert.equal(f.session.dirty, false);
});

test("typing while a save is in flight is serialized and saves the latest input", async () => {
  let begin, release;
  const started = new Promise((resolve) => { begin = resolve; });
  const blocked = new Promise((resolve) => { release = resolve; });
  const writes = [];
  const f = fixture("old\n", {
    delay: 60000,
    write: async (_, text) => { writes.push(text); begin(); await blocked; f.disk = text; },
  });
  f.session.edit("first\n");
  const saving = f.session.flush();
  await started;
  f.session.edit("latest\n");
  release();
  assert.equal(await saving, true);
  await f.session.flush();
  assert.deepEqual(writes, ["first\n", "latest\n"]);
  assert.equal(f.disk, "latest\n");
});

test("clean external changes sync, concurrent changes pause saves and retain the draft", async () => {
  const f = fixture();
  f.disk = "external\n";
  await f.session.sync();
  assert.equal(f.draft.text, "external\n");
  f.session.edit("local draft\n");
  f.disk = "new external\n";
  assert.equal(await f.session.sync(), false);
  assert.equal(await f.session.flush(), false);
  assert.equal(await f.session.retry(), false, "retry must still check disk contents");
  assert.equal(f.disk, "new external\n");
  assert.equal(f.draft.text, "local draft\n");
  assert.deepEqual(f.writes, []);
  await f.session.reload();
  assert.equal(f.draft.text, "new external\n");
  assert.equal(f.session.error, "");
  f.session.edit("after reload\n");
  assert.equal(await f.session.flush(), true);
});

test("external changes detected at save time are never overwritten", async () => {
  const f = fixture();
  f.session.edit("draft\n"); f.disk = "external\n";
  assert.equal(await f.session.flush(), false);
  assert.equal(f.draft.text, "draft\n");
  assert.equal(f.disk, "external\n");
  assert.deepEqual(f.writes, []);
});

test("a write race or write failure retains input and can be retried safely", async () => {
  let fail = true;
  const f = fixture("old\n", { write: async (expected, text) => {
    if (fail) throw new Error("write failed");
    assert.equal(expected, f.disk); f.disk = text;
  } });
  f.session.edit("draft\n");
  assert.equal(await f.session.flush(), false);
  assert.equal(f.draft.working, "old\n");
  assert.equal(f.draft.text, "draft\n");
  assert.equal(f.session.saving, false);
  fail = false;
  assert.equal(await f.session.retry(), true);
  assert.equal(f.disk, "draft\n");
});

test("large UTF-8 drafts stay in memory instead of exceeding the editing limit", async () => {
  const f = fixture();
  const text = "笔".repeat(700000);
  f.session.edit(text);
  assert.equal(await f.session.flush(), false);
  assert.equal(f.draft.text, text);
  assert.deepEqual(f.writes, []);
});

test("a clean deleted file does not block unrelated Git actions", async () => {
  const f = fixture("old\n", { read: async () => { throw new Error("deleted"); } });
  await f.session.sync();
  assert.equal(await f.session.flush(), true);
  assert.equal(f.session.dirty, false);
});

test("a burst of sync events shares a read without redundant change notifications", async () => {
  let reads = 0;
  let notifications = 0;
  const f = fixture("old\n", {
    read: async () => { reads++; return { index: "staged\n", working: "old\n" }; },
    changed: () => { notifications++; },
  });
  await Promise.all(Array.from({ length: 20 }, () => f.session.sync()));
  assert.equal(reads, 1);
  assert.equal(notifications, 0);
});

test("an external event arriving during a sync triggers one fresh read of the latest content", async () => {
  let begin, release;
  const started = new Promise((resolve) => { begin = resolve; });
  const blocked = new Promise((resolve) => { release = resolve; });
  let reads = 0;
  const f = fixture("old\n", { read: async () => {
    const snapshot = f.disk;
    if (++reads === 1) { begin(); await blocked; }
    return { index: "staged\n", working: snapshot };
  } });
  const initial = f.session.sync();
  await started;
  f.disk = "latest external\n";
  const pending = Array.from({ length: 20 }, () => f.session.sync());
  release();
  await Promise.all([initial, ...pending]);
  assert.equal(reads, 2);
  assert.equal(f.draft.text, "latest external\n");
  assert.equal(f.session.dirty, false);
});

test("document edits keep strings lazy, dirty checks and undo share the saved document", async () => {
  const f = fixture("\uFEFFold\r\n", { enabled: false });
  const original = Text.of(f.session.savedText.split("\n"));
  const changed = original.replace(1, 4, Text.of(["new"]));
  let conversions = 0;
  const stringify = changed.toString;
  changed.toString = function() { conversions++; return stringify.call(this); };
  f.session.editDocument(changed, original);
  for (let n = 0; n < 30; n++) assert.equal(f.session.dirty, true);
  assert.equal(conversions, 0);
  assert.equal(f.session.document.saved, original);
  const state = JSON.parse(JSON.stringify(f.draft));
  assert.equal(state.text, "\uFEFFnew\n");
  assert.equal(conversions, 1);
  assert.equal(f.draft.text, state.text); assert.equal(conversions, 1);
  f.session.editDocument(original, changed);
  assert.equal(f.session.dirty, false, "undo to saved content must be clean");
  assert.equal(await f.session.autoFlush(), true);
  assert.deepEqual(f.writes, []);
  f.session.editDocument(changed, original);
  assert.equal(await f.session.flush(), true);
  assert.equal(f.disk, "\uFEFFnew\r\n");
  assert.equal(f.session.dirty, false);
});

test("document drafts preserve concurrent writes, string edits, external conflicts and reload", async () => {
  let begin, release;
  const started = new Promise(resolve => { begin = resolve; }), blocked = new Promise(resolve => { release = resolve; });
  const f = fixture("old\n", { enabled: false, write: async (expected, content) => {
    assert.equal(f.disk, expected); begin(); await blocked; f.disk = content; f.writes.push(content);
  } });
  const first = Text.of(["first", ""]), latest = Text.of(["latest", ""]);
  f.session.editDocument(first);
  const saving = f.session.flush(); await started;
  f.session.editDocument(latest, first); release(); await saving;
  assert.deepEqual(f.writes, ["first\n", "latest\n"]);
  assert.equal(f.session.dirty, false);
  f.session.edit("string edit\n"); assert.equal(f.session.document.doc, null);
  assert.equal(f.session.dirty, true); assert.equal(f.draft.text, "string edit\n");
  f.disk = "external\n";
  assert.equal(await f.session.sync(), false);
  assert.equal(await f.session.flush(), false);
  assert.equal(f.draft.text, "string edit\n");
  await f.session.reload(); assert.equal(f.session.dirty, false);
  assert.equal(f.draft.text, "external\n");
  f.disk = "next external\n"; await f.session.sync();
  assert.equal(f.draft.text, "next external\n"); assert.equal(f.session.dirty, false);
});

test("document edits preserve restored drafts and exact same-length dirty changes", async () => {
  const f = fixture("one\ntwo\nthree\n", { enabled: false });
  f.session.edit("restored\n");
  f.session.editDocument(Text.of(["restored!", ""]), Text.of(["restored", ""]));
  assert.equal(f.session.dirty, true);
  assert.equal(f.draft.text, "restored!\n");
  f.session.editDocument(Text.of(["one", "two", "three", ""]));
  assert.equal(f.session.dirty, false);
  f.session.editDocument(Text.of(["one", "TWO", "three", ""]));
  assert.equal(f.session.dirty, true);
  assert.equal(await f.session.flush(), true);
  assert.equal(f.disk, "one\nTWO\nthree\n");
  assert.equal(f.session.dirty, false);
});
