"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const { MAX_IMAGE_UPLOAD_BYTES, readImageInput } = require("../src/compat/imageUpload");

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
