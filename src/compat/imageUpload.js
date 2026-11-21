"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");

const MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENT_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENT_DOWNLOAD_BYTES = 25 * 1024 * 1024;
const MAX_ATTACHMENT_COUNT = 10;

const MIME_BY_EXTENSION = Object.freeze({
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp",
  ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm",
  ".m4v": "video/x-m4v", ".mp3": "audio/mpeg", ".m4a": "audio/mp4",
  ".aac": "audio/aac", ".wav": "audio/wav", ".ogg": "audio/ogg",
  ".oga": "audio/ogg", ".opus": "audio/opus", ".pdf": "application/pdf",
  ".txt": "text/plain", ".csv": "text/csv", ".json": "application/json",
  ".zip": "application/zip", ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation"
});

function detectImageMime(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mimeType: "image/png", extension: ".png" };
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { mimeType: "image/jpeg", extension: ".jpg" };
  if (buffer.length >= 6 && /^GIF8[79]a$/.test(buffer.subarray(0, 6).toString("ascii"))) return { mimeType: "image/gif", extension: ".gif" };
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return { mimeType: "image/webp", extension: ".webp" };
  throw new TypeError("Image upload must be a valid JPEG, PNG, GIF, or WebP file");
}

async function readBytes(input, maxBytes) {
  let buffer;
  if (typeof input === "string" && input.trim()) {
    const handle = await fs.open(input, "r");
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new TypeError("Attachment path must point to a regular file");
      if (stat.size > maxBytes) throw new RangeError("Attachment exceeds the 10 MiB upload safety limit");
      buffer = await handle.readFile();
    } finally {
      await handle.close();
    }
  } else if (Buffer.isBuffer(input) || input instanceof Uint8Array) buffer = Buffer.from(input);
  else if (typeof Blob !== "undefined" && input instanceof Blob) {
    if (input.size > maxBytes) throw new RangeError("Attachment exceeds the 10 MiB upload safety limit");
    buffer = Buffer.from(await input.arrayBuffer());
  } else if (input && typeof input[Symbol.asyncIterator] === "function") {
    const chunks = [];
    let size = 0;
    for await (const chunk of input) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > maxBytes) {
        if (typeof input.destroy === "function") input.destroy();
        throw new RangeError("Attachment exceeds the 10 MiB upload safety limit");
      }
      chunks.push(bytes);
    }
    buffer = Buffer.concat(chunks, size);
  } else throw new TypeError("Attachment must be a Buffer, Uint8Array, Blob, or readable stream");
  if (!buffer.length) throw new TypeError("Attachment is empty");
  if (buffer.length > maxBytes) throw new RangeError("Attachment exceeds the 10 MiB upload safety limit");
  return buffer;
}

function safeFileName(input, extension) {
  const source = typeof input === "string" ? input : (typeof input?.path === "string" ? input.path : (typeof input?.name === "string" ? input.name : ""));
  const raw = source ? path.basename(source.replace(/\\/g, "/")) : "";
  const clean = raw && !/[\r\n\0]/.test(raw) ? raw : "";
  if (!clean) return "upload" + extension;
  return clean.slice(0, 180);
}

async function readImageInput(input, options = {}) {
  const maxBytes = options.maxBytes ?? MAX_IMAGE_UPLOAD_BYTES;
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_IMAGE_UPLOAD_BYTES) throw new TypeError("maxBytes must be between 1 and 10 MiB");
  const buffer = await readBytes(input, maxBytes);
  const detected = detectImageMime(buffer);
  const rawName = typeof input === "string" ? path.basename(input) : (typeof input?.path === "string" ? path.basename(input.path) : (typeof input?.name === "string" ? path.basename(input.name) : ""));
  const safeName = rawName && !/[\r\n\0]/.test(rawName) ? rawName : "";
  const extension = path.extname(safeName).toLowerCase();
  const fileName = safeName && extension === detected.extension ? safeName : "upload" + detected.extension;
  return Object.freeze({ buffer, mimeType: detected.mimeType, fileName, size: buffer.length });
}

async function readAttachmentInput(input, options = {}) {
  const maxBytes = options.maxBytes ?? MAX_ATTACHMENT_UPLOAD_BYTES;
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_ATTACHMENT_UPLOAD_BYTES) throw new TypeError("maxBytes must be between 1 and 10 MiB");
  const buffer = await readBytes(input, maxBytes);
  let extension = path.extname(typeof input === "string" ? input : (typeof input?.path === "string" ? input.path : (typeof input?.name === "string" ? input.name : ""))).toLowerCase();
  let mimeType = MIME_BY_EXTENSION[extension] || "application/octet-stream";
  let kind = mimeType.startsWith("image/") ? "image" : mimeType.startsWith("video/") ? "video" : mimeType.startsWith("audio/") ? "audio" : "file";
  try {
    const image = detectImageMime(buffer);
    mimeType = image.mimeType; extension = image.extension; kind = "image";
  } catch {}
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-") { mimeType = "application/pdf"; extension = ".pdf"; kind = "file"; }
  if (buffer.length >= 8 && buffer.subarray(4, 8).toString("ascii") === "ftyp") { mimeType = "video/mp4"; extension = extension || ".mp4"; kind = "video"; }
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString("ascii") === "OggS") { mimeType = "audio/ogg"; extension = ".ogg"; kind = "audio"; }
  if (buffer.length >= 3 && buffer.subarray(0, 3).toString("ascii") === "ID3") { mimeType = "audio/mpeg"; extension = ".mp3"; kind = "audio"; }
  if (!extension) extension = Object.keys(MIME_BY_EXTENSION).find(key => MIME_BY_EXTENSION[key] === mimeType) || ".bin";
  return Object.freeze({ buffer, mimeType, fileName: safeFileName(input, extension), size: buffer.length, kind });
}

function safeDownloadUrl(input) {
  let url;
  try { url = new URL(input); } catch { throw new TypeError("Attachment URL is invalid"); }
  if (url.protocol !== "https:" || url.username || url.password ||
      !/(^|\.)(?:fbcdn\.net|fbsbx\.com|facebook\.com|messenger\.com)$/i.test(url.hostname)) {
    throw new TypeError("Attachment download URL must be HTTPS on a Facebook media host");
  }
  return url;
}

async function readResponseBytes(response, maxBytes) {
  if (response.body && typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        size += chunk.length;
        if (size > maxBytes) {
          await reader.cancel();
          throw new RangeError("Attachment download exceeds the configured byte limit");
        }
        chunks.push(chunk);
      }
      return Buffer.concat(chunks, size);
    } finally { try { reader.releaseLock(); } catch {} }
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > maxBytes) throw new RangeError("Attachment download exceeds the configured byte limit");
  return buffer;
}

function filenameFromDisposition(value) {
  if (typeof value !== "string") return null;
  const utf = /filename\*=UTF-8''([^;]+)/i.exec(value);
  const plain = /filename="?([^";]+)"?/i.exec(value);
  const raw = utf ? decodeURIComponent(utf[1]) : plain?.[1];
  if (!raw) return null;
  const name = path.basename(raw.replace(/\\/g, "/")).replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 180);
  return name || null;
}

async function downloadAttachment(input, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new TypeError("A Fetch-compatible implementation is required");
  const maxBytes = options.maxBytes ?? MAX_ATTACHMENT_DOWNLOAD_BYTES;
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_ATTACHMENT_DOWNLOAD_BYTES) throw new TypeError("maxBytes must be between 1 and 25 MiB");
  let url = safeDownloadUrl(input);
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 30000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) throw new TypeError("timeoutMs must be between 1000 and 120000");
  const timer = setTimeout(() => controller.abort(new Error("Attachment download timed out")), timeoutMs);
  try {
    let response;
    for (let redirects = 0; ; redirects++) {
      response = await fetchImpl(url, { method: "GET", redirect: "manual", signal: controller.signal, headers: { accept: "*/*" } });
      if (response.status < 300 || response.status >= 400) break;
      if (redirects >= 4) throw new Error("Attachment download exceeded the redirect limit");
      try { await response.body?.cancel?.(); } catch {}
      const location = response.headers?.get?.("location");
      if (!location) throw new Error("Attachment download returned an invalid redirect");
      url = safeDownloadUrl(new URL(location, url).toString());
    }
    if (!response.ok) {
      const error = new Error("Attachment download failed with HTTP " + response.status);
      error.code = "FCA_ATTACHMENT_DOWNLOAD_FAILED";
      error.status = response.status;
      throw error;
    }
    const declared = Number(response.headers?.get?.("content-length") || 0);
    if (declared > maxBytes) throw new RangeError("Attachment download exceeds the configured byte limit");
    const buffer = await readResponseBytes(response, maxBytes);
    return Object.freeze({
      buffer, size: buffer.length,
      mimeType: (response.headers?.get?.("content-type") || "application/octet-stream").split(";")[0].trim().toLowerCase(),
      fileName: filenameFromDisposition(response.headers?.get?.("content-disposition")),
      url: url.toString()
    });
  } catch (error) {
    if (controller.signal.aborted) {
      const timeout = new Error("Attachment download timed out");
      timeout.code = "FCA_ATTACHMENT_DOWNLOAD_TIMEOUT";
      throw timeout;
    }
    throw error;
  } finally { clearTimeout(timer); }
}

module.exports = {
  MAX_IMAGE_UPLOAD_BYTES, MAX_ATTACHMENT_UPLOAD_BYTES, MAX_ATTACHMENT_DOWNLOAD_BYTES,
  MAX_ATTACHMENT_COUNT, MIME_BY_EXTENSION, detectImageMime, readImageInput,
  readAttachmentInput, downloadAttachment, safeDownloadUrl
};
