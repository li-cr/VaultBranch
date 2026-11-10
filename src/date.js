"use strict";

// Only replace a trigger at the typing cursor, never scan or rewrite an entire note.
function dateTriggerRange(editor, trigger) {
  if (!trigger || /\s/.test(trigger) || editor.somethingSelected()) return null;
  const cursor = editor.getCursor();
  const before = editor.getLine(cursor.line).slice(0, cursor.ch);
  if (!before.endsWith(trigger)) return null;
  const start = cursor.ch - trigger.length;
  if (start && !/\s/.test(before[start - 1])) return null;
  return { from: { line: cursor.line, ch: start }, to: cursor };
}

module.exports = { dateTriggerRange };
