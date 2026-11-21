"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
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
  }), /25 MiB/);
});
