"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { dateTriggerRange } = require("../src/date.js");
const defaults = require("../default-settings.json");
function editor(line, ch = line.length, selected = false) {
  return { getCursor: () => ({ line: 2, ch }), getLine: () => line, somethingSelected: () => selected };
}
test("date expansion matches only the configured trigger at a word boundary and typing cursor", () => {
  assert.deepEqual(dateTriggerRange(editor("note @date"), "@date"), { from: { line: 2, ch: 5 }, to: { line: 2, ch: 10 } });
  assert.equal(dateTriggerRange(editor("email@date"), "@date"), null);
  assert.equal(dateTriggerRange(editor("@date suffix"), "@date"), null);
  assert.equal(dateTriggerRange(editor("@date", 5, true), "@date"), null);
  assert.equal(dateTriggerRange(editor("@date"), ""), null);
  assert.equal(dateTriggerRange(editor("@date"), "@ date"), null);
  assert.ok(dateTriggerRange(editor(";today"), ";today"));
});
test("date insertion and diff manual saving have independent defaults", () => {
  assert.equal(defaults.dateTrigger, "@date");
  assert.equal(defaults.dateFormat, "YYYY-MM-DD HH:mm:ss");
  assert.equal(defaults.diffAutosave, false);
});
