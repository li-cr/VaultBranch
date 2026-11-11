"use strict";

const { t } = require("../i18n.js");
const { el } = require("./shared.js");

// Decode off-screen so both versions arrive with the rest of the page.
async function prepareImages(document, versions) {
  const images = [versions.left, versions.right].map(version => {
    if (!version) return null;
    const image = document.createElement("img");
    image.src = version.src;
    image.draggable = false;
    return image;
  });
  const destroy = () => { for (const image of images) image?.removeAttribute("src"); };
  const decoded = await Promise.allSettled(images.map(image => image?.decode()));
  if (decoded.some(result => result.status === "rejected")) {
    destroy(); throw new Error(t("无法预览此图片；文件可能损坏或格式不受支持。"));
  }
  return {
    destroy,
    render(body, labels) {
      const grid = el(body, "div", "vaultbranch-image-comparison");
      images.forEach((image, index) => {
        const pane = el(grid, "div", "vaultbranch-image-pane");
        el(pane, "div", "vaultbranch-image-caption", labels[index]);
        const preview = el(pane, "div", "vaultbranch-image-preview");
        if (image) {
          image.alt = labels[index]; preview.appendChild(image);
          el(pane, "div", "vaultbranch-image-size", `${image.naturalWidth} × ${image.naturalHeight}`);
        } else el(preview, "div", "vaultbranch-empty", t("此版本无图片"));
      });
    },
  };
}

module.exports = { prepareImages };
