"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { MAX_IMAGE_UPLOAD_BYTES, MAX_ATTACHMENT_DOWNLOAD_BYTES, readImageInput, readAttachmentInput, downloadAttachment, safeDownloadUrl } = require("../src/compat/imageUpload");

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

test("reads bounded PNG buffers and readable streams", async () => {
  const fromBuffer = await readImageInput(png);
  assert.equal(fromBuffer.mimeType, "image/png");
  assert.equal(fromBuffer.fileName, "upload.png");
  assert.equal(fromBuffer.size, png.length);
  const stream = Readable.from([png.subarray(0, 4), png.subarray(4)]);
  stream.path = "/tmp/avatar.png";
  const fromStream = await readImageInput(stream);
  assert.equal(fromStream.fileName, "avatar.png");
  assert.equal(fromStream.mimeType, "image/png");
});

test("rejects unsupported, empty, and oversized image uploads", async () => {
  await assert.rejects(readImageInput(Buffer.from("not an image")), /valid JPEG, PNG, GIF, or WebP/);
  await assert.rejects(readImageInput(Buffer.alloc(0)), /empty/);
  await assert.rejects(readImageInput(Buffer.concat([png, Buffer.alloc(MAX_IMAGE_UPLOAD_BYTES)])), /10 MiB/);
});


test("reads generic image, video, audio and document attachments with bounded streams", async () => {
  const pdf = Buffer.from("%PDF-1.7 test");
  const file = await readAttachmentInput(Object.assign(Readable.from([pdf]), { path: "/tmp/report.pdf" }));
  assert.equal(file.mimeType, "application/pdf");
  assert.equal(file.kind, "file");
  assert.equal(file.fileName, "report.pdf");
  const mp4 = Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0]);
  const video = await readAttachmentInput(mp4, { maxBytes: 1024 });
  assert.equal(video.mimeType, "video/mp4");
  assert.equal(video.kind, "video");
  await assert.rejects(readAttachmentInput(Buffer.alloc(MAX_IMAGE_UPLOAD_BYTES + 1)), /10 MiB/);
});

test("downloads only bounded HTTPS Facebook media URLs without credentials", async () => {
  assert.equal(safeDownloadUrl("https://scontent.xx.fbcdn.net/file.jpg").hostname, "scontent.xx.fbcdn.net");
  assert.throws(() => safeDownloadUrl("http://scontent.xx.fbcdn.net/file.jpg"), /HTTPS/);
  assert.throws(() => safeDownloadUrl("https://evil.example/file.jpg"), /Facebook media host/);
  const bytes = Buffer.from("downloaded media");
  const result = await downloadAttachment("https://scontent.xx.fbcdn.net/file.jpg", {
    fetchImpl: async () => new Response(bytes, { status: 200, headers: { "content-type": "image/jpeg", "content-disposition": 'attachment; filename="photo.jpg"' } })
  });
  assert.deepEqual(result.buffer, bytes);
  assert.equal(result.fileName, "photo.jpg");
  assert.equal(result.mimeType, "image/jpeg");
  await assert.rejects(downloadAttachment("https://scontent.xx.fbcdn.net/file.jpg", {
    maxBytes: 2, fetchImpl: async () => new Response(bytes, { status: 200 })
  }), /configured byte limit/);
});

test("reads local attachment paths with file-size and filename bounds", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omega-fca-upload-"));
  const filePath = path.join(dir, "report.pdf");
  try {
    const pdf = Buffer.from("%PDF-1.7 local file");
    await fs.writeFile(filePath, pdf);
    const result = await readAttachmentInput(filePath);
    assert.equal(result.fileName, "report.pdf");
    assert.equal(result.mimeType, "application/pdf");
    assert.equal(result.kind, "file");
    await assert.rejects(readAttachmentInput(filePath, { maxBytes: 4 }), /10 MiB|byte limit/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});



test("normalizes Windows-style attachment paths without leaking directory segments", async () => {
  const input = Object.assign(Buffer.from("%PDF-1.7 test"), { name: "C:\\private\\folder\\report.pdf" });
  const result = await readAttachmentInput(input);
  assert.equal(result.fileName, "report.pdf");
  assert.equal(result.mimeType, "application/pdf");
});

test("maps any aborted media request to the stable download-timeout error", async () => {
  await assert.rejects(downloadAttachment("https://scontent.xx.fbcdn.net/file.bin", {
    timeoutMs: 1000,
    fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("request aborted")), { once: true });
    })
  }), error => error.code === "FCA_ATTACHMENT_DOWNLOAD_TIMEOUT");
});


test("classifies GIF, MP4 and ID3 audio by file signatures", async () => {
  const gif = await readAttachmentInput(Buffer.from("GIF89a" + "payload"), { maxBytes: 1024 });
  assert.equal(gif.mimeType, "image/gif");
  assert.equal(gif.kind, "image");
  const mp4 = await readAttachmentInput(Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0]), { maxBytes: 1024 });
  assert.equal(mp4.mimeType, "video/mp4");
  assert.equal(mp4.kind, "video");
  const mp3 = await readAttachmentInput(Buffer.from("ID3" + "audio"), { maxBytes: 1024 });
  assert.equal(mp3.mimeType, "audio/mpeg");
  assert.equal(mp3.kind, "audio");
});
