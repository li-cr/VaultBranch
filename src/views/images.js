"use strict";

const { t } = require("../i18n.js");
const { el } = require("./shared.js");

function enableZoom(preview, image) {
  let scale = 1, x = 0, y = 0, drag;
  const update = () => {
    const limitX = Math.max(0, (image.offsetWidth * scale - preview.clientWidth + 32) / 2);
    const limitY = Math.max(0, (image.offsetHeight * scale - preview.clientHeight + 32) / 2);
    x = Math.max(-limitX, Math.min(limitX, x));
    y = Math.max(-limitY, Math.min(limitY, y));
    image.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    preview.classList.toggle("is-zoomed", scale > 1);
  };
  image.title = t("滚轮缩放 · 放大后拖动 · 双击复原");
  preview.addEventListener("wheel", event => {
    if (event.target !== image || !event.deltaY) return;
    event.preventDefault();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? preview.clientHeight : 1);
    const next = Math.max(1, Math.min(8, scale * Math.exp(-Math.max(-200, Math.min(200, delta)) * 0.002)));
    const rect = preview.getBoundingClientRect();
    const px = event.clientX - rect.left - rect.width / 2;
    const py = event.clientY - rect.top - rect.height / 2;
    x = px - (px - x) * next / scale;
    y = py - (py - y) * next / scale;
    scale = next; update();
  }, { passive: false });
  preview.addEventListener("pointerdown", event => {
    if (scale === 1 || event.button !== 0 || event.target !== image) return;
    event.preventDefault();
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    preview.setPointerCapture(event.pointerId);
  });
  preview.addEventListener("pointermove", event => {
    if (drag?.id !== event.pointerId) return;
    x += event.clientX - drag.x; y += event.clientY - drag.y;
    drag.x = event.clientX; drag.y = event.clientY; update();
  });
  preview.addEventListener("pointerup", event => {
    if (drag?.id !== event.pointerId) return;
    preview.releasePointerCapture(event.pointerId); drag = null;
  });
  preview.addEventListener("lostpointercapture", () => { drag = null; });
  preview.addEventListener("dblclick", () => { scale = 1; x = y = 0; update(); });
}

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
          enableZoom(preview, image);
          el(pane, "div", "vaultbranch-image-size", `${image.naturalWidth} × ${image.naturalHeight}`);
        } else el(preview, "div", "vaultbranch-empty", t("此版本无图片"));
      });
    },
  };
}

module.exports = { prepareImages };
