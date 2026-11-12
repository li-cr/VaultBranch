"use strict";

const { t } = require("../i18n.js");
const { el, button } = require("./shared.js");
const { prepareImages } = require("./images.js");

const isSvg = file => /\.svg$/i.test(file?.path || "");

async function prepareSvg(document, versions) {
  const image = text => text ? { src: `data:image/svg+xml;base64,${Buffer.from(text, "utf8").toString("base64")}` } : null;
  // SVG stays in an image document: no inline DOM, scripts or external resources.
  try { return { versions, images: await prepareImages(document, { left: image(versions.left), right: image(versions.right) }) }; }
  catch (error) { return { versions, error }; }
}

class SvgComparison {
  constructor(view, body, toolbar, prepared, labels, read, renderSource) {
    this.view = view;
    this.read = read;
    this.labels = labels;
    this.preview = true;
    this.request = 0;
    body.classList.add("has-editor");
    this.previewEl = el(body, "div", "vaultbranch-svg-mode");
    this.sourceEl = el(body, "div", "vaultbranch-svg-mode");
    this.sourceEl.hidden = true;
    this.renderSource = renderSource;
    this.toggle = button(toolbar, "code", t("查看 SVG 源码"), () => this.switchMode(), t("源码"));
    this.toggle.classList.add("vaultbranch-svg-toggle");
    this.versions = prepared.versions;
    this.show(prepared);
  }

  show(prepared) {
    this.images?.destroy();
    this.images = prepared.images;
    this.previewEl.replaceChildren();
    if (prepared.error) el(this.previewEl, "div", "vaultbranch-empty is-error", t("SVG 无法预览，请切换源码检查。"));
    else prepared.images.render(this.previewEl, this.labels);
  }

  async refresh() {
    if (!this.preview || this.closed) return;
    const versions = this.read();
    if (versions.left === this.versions.left && versions.right === this.versions.right) return;
    const request = ++this.request;
    const prepared = await prepareSvg(this.previewEl.ownerDocument, versions);
    if (this.closed || request !== this.request) { prepared.images?.destroy(); return; }
    this.versions = versions;
    this.show(prepared);
  }

  async switchMode() {
    if (this.closed || this.switching) return;
    this.switching = true;
    try {
      if (this.preview) {
        if (!this.sourceReady) { this.renderSource(this.sourceEl); this.sourceReady = true; }
        this.preview = false;
      } else {
        this.preview = true;
        await this.refresh();
        if (this.closed) return;
      }
      this.previewEl.hidden = !this.preview;
      this.sourceEl.hidden = this.preview;
      const title = this.preview ? t("查看 SVG 源码") : t("预览 SVG");
      this.toggle.title = title;
      this.toggle.setAttribute("aria-label", title);
      this.toggle.lastElementChild.textContent = this.preview ? t("源码") : t("预览");
      this.view.updateDiffNavigation();
      this.view.merge?.a.requestMeasure();
      this.view.merge?.b.requestMeasure();
    } finally { this.switching = false; }
  }

  destroy() { this.closed = true; this.request++; this.images?.destroy(); }
}

module.exports = { isSvg, prepareSvg, SvgComparison };
