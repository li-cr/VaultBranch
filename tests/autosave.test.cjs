"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Autosave } = require("../src/autosave.js");

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
