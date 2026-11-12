"use strict";

function cells(line) {
  const result = [];
  let start = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\") { i++; continue; }
    if (line[i] === "|") { result.push(line.slice(start, i).trim()); start = i + 1; }
  }
  result.push(line.slice(start).trim());
  if (!result[0]) result.shift();
  if (!result.at(-1)) result.pop();
  return result;
}

function tableHeader(header, separator) {
  if (/^[ \t]/.test(header) || /^[ \t]/.test(separator) || !header.includes("|") || !separator.includes("|")) return false;
  const columns = cells(header), rules = cells(separator);
  return columns.length >= 2 && columns.length === rules.length && rules.every(rule => /^:?-+:?$/.test(rule));
}

// Top-level paragraphs only. Block syntax remains owned by Obsidian.
function findLooseTables(text, offset = 0) {
  const lines = text.split("\n"), tables = [], blocked = [];
  let position = offset, fence, fenceClose, block, blockStart = offset, previous = "", ticks = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].endsWith("\r") ? lines[i].slice(0, -1) : lines[i], end = position + lines[i].length;
    if (!fence && !block && !/[|`~%<$]/.test(line) && !(i === 0 && offset === 0 && line === "---")) {
      if (!line.trim()) ticks = 0;
      previous = line; position = end + 1;
      continue;
    }
    if (fence) {
      if (fenceClose.test(line)) { blocked.push({ from: blockStart, to: end, kind: "fence" }); fence = null; }
    } else if (block) {
      const closes = block === "frontmatter" ? /^(---|\.\.\.)\s*$/.test(line) : block === "html" ? !line.trim() : line.includes(block);
      if (closes) { blocked.push({ from: blockStart, to: end, kind: block }); block = null; }
    } else {
      const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (marker) { fence = marker[1]; fenceClose = new RegExp(`^ {0,3}${fence[0]}{${fence.length},}\\s*$`); blockStart = position; }
      else if (i === 0 && offset === 0 && line === "---") { block = "frontmatter"; blockStart = position; }
      else if (line.includes("<!--") && !line.includes("-->", line.indexOf("<!--") + 4)) { block = "-->"; blockStart = position; }
      else if (line.includes("%%") && line.indexOf("%%") === line.lastIndexOf("%%")) { block = "%%"; blockStart = position; }
      else if (line.trim() === "$$") { block = "$$"; blockStart = position; }
      else if (/^<(?:[a-zA-Z][\w-]*(?:\s|>|\/)|!)/.test(line)) { block = "html"; blockStart = position; }
      else if (line.includes("|") && !ticks && i && previous.trim() && !/^(?:[ \t>#|]|[-+*]\s|\d+[.)]\s|`|~|<|\$|%%)/.test(previous) && tableHeader(line, lines[i + 1] || "")) {
        let last = i + 1, to = end + 1 + lines[last].length;
        while (last + 1 < lines.length && lines[last + 1].trim() && !/^[ \t]/.test(lines[last + 1]) && lines[last + 1].includes("|")) { last++; to += 1 + lines[last].length; }
        tables.push({ from: position, to, markdown: lines.slice(i, last + 1).join("\n") });
      }
    }
    if (!line.trim() || fence || block) ticks = 0;
    else if (line.includes("`")) for (let c = 0; c < line.length; c++) {
      if (line[c] === "\\") { c++; continue; }
      if (line[c] !== "`") continue;
      let last = c; while (line[last + 1] === "`") last++;
      const length = last - c + 1;
      if (!ticks) ticks = length; else if (ticks === length) ticks = 0;
      c = last;
    }
    previous = line; position = end + 1;
  }
  if (fence || block) blocked.push({ from: blockStart, to: offset + text.length, kind: fence ? "fence" : block });
  return { tables, blocked };
}

function sectionText(info) {
  let start = 0;
  for (let line = 0; line < info.lineStart; line++) { start = info.text.indexOf("\n", start); if (start < 0) return ""; start++; }
  let end = start;
  for (let line = info.lineStart; line <= info.lineEnd; line++) { const next = info.text.indexOf("\n", end); if (next < 0) return info.text.slice(start); end = next + 1; }
  return info.text.slice(start, end);
}

async function renderReadingTable(plugin, el, context) {
  if (!(context.containerEl || el).closest(".markdown-reading-view")) return;
  const info = context.getSectionInfo(el);
  if (!info) return;
  const source = sectionText(info), { tables } = findLooseTables(source);
  if (!tables.length) return;
  let markdown = source;
  for (const table of tables.reverse()) markdown = markdown.slice(0, table.from) + "\n" + markdown.slice(table.from);
  const { MarkdownRenderer, MarkdownRenderChild } = require("obsidian");
  const child = new MarkdownRenderChild(el);
  let closed = false;
  child.onunload = () => { closed = true; };
  context.addChild(child);
  const rendered = el.ownerDocument.createElement("div");
  await MarkdownRenderer.render(plugin.app, markdown, rendered, context.sourcePath, child);
  if (!closed && !plugin.unloaded && plugin.settings.renderLooseTables) el.replaceChildren(...rendered.childNodes);
}

module.exports = { cells, tableHeader, findLooseTables, renderReadingTable };
