"use strict";

function drawGraph(parent, commit, width, height = 36) {
  const colors = ["blue", "green", "orange", "purple", "red"];
  const color = lane => `var(--color-${colors[lane % colors.length]})`;
  const x = lane => 12 + lane * 16, middle = height / 2;
  const svgNode = (parent, tag, attributes) => {
    const node = parent.ownerDocument.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    parent.appendChild(node); return node;
  };
  const svg = svgNode(parent, "svg", { width, height, viewBox: `0 0 ${width} ${height}`, class: "vaultbranch-graph", "aria-hidden": "true" });
  for (const { from, to, through } of commit.edges) {
    if (to < 0) continue;
    const d = through ? `M ${x(from)} 0 L ${x(from)} ${middle} C ${x(from)} ${height * .72} ${x(to)} ${height * .72} ${x(to)} ${height}`
      : `M ${x(from)} ${middle} C ${x(from)} ${height * .75} ${x(to)} ${height * .75} ${x(to)} ${height}`;
    svgNode(svg, "path", { d, stroke: color(from), "stroke-width": 2, fill: "none" });
  }
  if (commit.incoming) svgNode(svg, "path", { d: `M ${x(commit.column)} 0 L ${x(commit.column)} ${middle}`, stroke: color(commit.column), "stroke-width": 2 });
  svgNode(svg, "circle", { cx: x(commit.column), cy: middle, r: (commit.graphParents || commit.parents).length > 1 ? 5 : 4,
    fill: color(commit.column), stroke: "var(--background-primary)", "stroke-width": 1.5 });
}

module.exports = { drawGraph };
