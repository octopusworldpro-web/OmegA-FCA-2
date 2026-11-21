"use strict";

const path = require("node:path");

const MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024;

function detectImageMime(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mimeType: "image/png", extension: ".png" };
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mimeType: "image/jpeg", extension: ".jpg" };
  }
  if (buffer.length >= 6 && (buffer.subarray(0, 6).toString("ascii") === "GIF87a" ||
      buffer.subarray(0, 6).toString("ascii") === "GIF89a")) {
    return { mimeType: "image/gif", extension: ".gif" };
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
      buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return { mimeType: "image/webp", extension: ".webp" };
  }
  throw new TypeError("Image upload must be a valid JPEG, PNG, GIF, or WebP file");
}

async function readImageInput(input, options = {}) {
  const maxBytes = options.maxBytes ?? MAX_IMAGE_UPLOAD_BYTES;
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_IMAGE_UPLOAD_BYTES) {
    throw new TypeError("maxBytes must be between 1 and 10 MiB");
  }
  let buffer;
  if (Buffer.isBuffer(input)) {
    buffer = Buffer.from(input);
  } else if (input instanceof Uint8Array) {
    buffer = Buffer.from(input);
  } else if (typeof Blob !== "undefined" && input instanceof Blob) {
    if (input.size > maxBytes) throw new RangeError("Image upload exceeds the 10 MiB safety limit");
    buffer = Buffer.from(await input.arrayBuffer());
  } else if (input && typeof input[Symbol.asyncIterator] === "function") {
    const chunks = [];
    let size = 0;
    for await (const chunk of input) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > maxBytes) {
        if (typeof input.destroy === "function") input.destroy();
        throw new RangeError("Image upload exceeds the 10 MiB safety limit");
      }
      chunks.push(bytes);
    }
    buffer = Buffer.concat(chunks, size);
  } else {
    throw new TypeError("Image upload must be a Buffer, Uint8Array, Blob, or readable stream");
  }
  if (!buffer.length) throw new TypeError("Image upload is empty");
  if (buffer.length > maxBytes) throw new RangeError("Image upload exceeds the 10 MiB safety limit");
  const detected = detectImageMime(buffer);
  const rawName = typeof input?.path === "string" ? path.basename(input.path) :
    (typeof input?.name === "string" ? path.basename(input.name) : "");
  const safeName = rawName && !/[\r\n]/.test(rawName) ? rawName : "";
  const extension = path.extname(safeName).toLowerCase();
  const fileName = safeName && extension === detected.extension ? safeName : "upload" + detected.extension;
  return Object.freeze({ buffer, mimeType: detected.mimeType, fileName, size: buffer.length });
}

module.exports = { MAX_IMAGE_UPLOAD_BYTES, detectImageMime, readImageInput };
