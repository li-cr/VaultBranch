"use strict";

const MAX_OUTPUT = 12 * 1024 * 1024;
const MAX_PREVIEW = 2 * 1024 * 1024;
const MAX_IMAGE = 10 * 1024 * 1024;
const IMAGE_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", ico: "image/x-icon", avif: "image/avif" };
const DIFF_OPTIONS = ["--no-ext-diff", "--no-textconv", "--no-color", "--no-renames", "--unified=4"];

module.exports = { MAX_OUTPUT, MAX_PREVIEW, MAX_IMAGE, IMAGE_TYPES, DIFF_OPTIONS };
