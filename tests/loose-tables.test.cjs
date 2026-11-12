"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { cells, tableHeader, findLooseTables } = require("../src/loose-tables.js");
const table = "| 数据集 | 总数 |\n|---|---:|\n| 示例 A | 12 |\n| 示例 B | 34 |";

test("finds only a table directly following top-level paragraph text and preserves exact source ranges", () => {
  const text = "总体分析：\n" + table + "\n\n尾部文字";
  const found = findLooseTables(text).tables;
  assert.equal(found.length, 1);
  assert.equal(found[0].markdown, table);
  assert.equal(text.slice(found[0].from, found[0].to), table);
  assert.equal(findLooseTables(table).tables.length, 0);
  assert.equal(findLooseTables("总体分析：\n\n" + table).tables.length, 0);
});

test("keeps escaped pipes, inline code, alignment and column counts compatible with native tables", () => {
  assert.deepEqual(cells("| a\\|b | `code` |"), ["a\\|b", "`code`"]);
  assert.equal(tableHeader("A | B", ":--- | ---:"), true);
  assert.equal(tableHeader("| A | B |", "|---|"), false);
  assert.equal(tableHeader("| A | B |", "|---|text|"), false);
  assert.equal(tableHeader(" | A | B |", " |---|---|"), false);
  assert.equal(findLooseTables("intro\n| A\\|B | `x` |\n|---|---|\n| y | z |\n").tables.length, 1);
});

test("leaves fenced code, frontmatter, comments, math, raw HTML, lists and quotes alone", () => {
  for (const [start, end] of [["```md", "```"], ["~~~~md", "~~~~"], ["---", "---"], ["%%", "%%"], ["<!--", "-->"], ["$$", "$$"]]) {
    assert.equal(findLooseTables(start + "\n\nintro\n" + table + "\n" + end).tables.length, 0, start);
  }
  assert.equal(findLooseTables("<div>\nintro\n" + table + "\n</div>").tables.length, 0);
  for (const prefix of ["# title", "- item", "1. item", "> quote", "    indented code"]) assert.equal(findLooseTables(prefix + "\n" + table).tables.length, 0, prefix);
  assert.equal(findLooseTables("intro\n    " + table.replaceAll("\n", "\n    ")).tables.length, 0);
  assert.equal(findLooseTables("intro `\n" + table + "\n` end").tables.length, 0);
});

test("handles multiple paragraphs, offset ranges, CRLF and EOF without modifying text", () => {
  const text = "intro\n" + table + "\n\nnext\n" + table;
  const found = findLooseTables(text, 100).tables;
  assert.equal(found.length, 2);
  for (const range of found) assert.equal(text.slice(range.from - 100, range.to - 100), range.markdown);
  assert.equal(findLooseTables(text.replaceAll("\n", "\r\n")).tables.length, 2);
});
