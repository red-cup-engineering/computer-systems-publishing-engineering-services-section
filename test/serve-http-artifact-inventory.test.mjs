import assert from "node:assert/strict";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { send } from "@red-cup-engineering/http-services-section/response";
import { artifactInventory } from "../scripts/serve-http-artifact-inventory.mjs";

function handler(inventory, options) {
  return artifactInventory(inventory, options).resources[0].handler;
}

function ctx(pathname) {
  return { req: { url: pathname }, url: new URL(pathname, "https://example.test") };
}

class ResponseRecorder {
  headers = new Map();
  statusCode = 200;
  body = undefined;
  hasHeader(name) { return this.headers.has(name.toLowerCase()); }
  getHeader(name) { return this.headers.get(name.toLowerCase()); }
  setHeader(name, value) { this.headers.set(name.toLowerCase(), value); return this; }
  writeHead(status, headers = {}) {
    this.statusCode = status;
    for (const [name, value] of Object.entries(headers)) this.setHeader(name, value);
    return this;
  }
  end(body) { this.body = body; return this; }
  addTrailers() {}
}

async function transport(representation, { method = "GET", headers = {} } = {}) {
  const response = new ResponseRecorder();
  await send({ method, headers }, response, representation, Date.now());
  return response;
}

test("serves direct artifacts and directory indexes with shared media types", () => {
  const inventory = new Map([
    ["index.html", "home"],
    ["guide/index.html", "guide"],
    ["app/data.json", "{}"],
  ]);
  const serve = handler(inventory);
  assert.deepEqual(serve(ctx("/")), {
    type: "text/html", body: "home", etag: '"e83249bd3ba79932e16fb1fb5100dafade9954c2"',
    cacheControl: "public, max-age=0, must-revalidate",
  });
  assert.equal(serve(ctx("/guide/")).body, "guide");
  assert.equal(serve(ctx("/guide")).body, "guide");
  assert.equal(serve(ctx("/app/data.json")).type, "application/json");
  assert.deepEqual(artifactInventory(inventory).resources[0].methods, ["GET", "HEAD"]);
});

test("preserves binary artifacts and serves a configured 404 fallback", () => {
  const bytes = new Uint8Array([0, 255, 9]);
  const serve = handler(new Map([["images/logo.bin", bytes], ["404.html", "missing"]]), { notFoundPath: "404.html" });
  const image = serve(ctx("/images/logo.bin"));
  assert.deepEqual(image.body, Buffer.from(bytes));
  assert.equal(image.type, "application/octet-stream");
  assert.equal(image.cacheControl, "public, max-age=0, must-revalidate");
  assert.equal(typeof image.etag, "string");
  assert.deepEqual(serve(ctx("/missing")), {
    status: 404, type: "text/html", body: "missing",
    etag: '"5a013c49508291c6816ac388f93a2c11973086ed"', cacheControl: "no-store",
  });
});

test("honors representation metadata carried by artifact records", () => {
  const serve = handler(new Map([["feed.rss.xml", {
    body: "<rss/>",
    mediaType: "application/rss+xml; charset=utf-8",
    cacheControl: "public, max-age=60",
    etag: '"release-feed"',
  }]]));
  assert.deepEqual(serve(ctx("/feed.rss.xml")), {
    type: "application/rss+xml; charset=utf-8",
    body: "<rss/>",
    cacheControl: "public, max-age=60",
    etag: '"release-feed"',
  });
});

test("rejects malformed and traversal-shaped request paths before inventory lookup", () => {
  const serve = handler(new Map([["secret.txt", "secret"], ["404.html", "missing"]]), { notFoundPath: "404.html" });
  for (const path of ["/%2e%2e/secret.txt", "/../secret.txt", "/%5csecret.txt", "/%E0%A4%A"]) {
    assert.equal(serve(ctx(path)).status, 404, path);
  }
});

test("validates configuration and Map-like inventory inputs", () => {
  assert.throws(() => artifactInventory({}), /Map-like inventory/);
  assert.throws(() => artifactInventory(new Map(), { index: ["../index.html"] }), /index entry/);
  assert.throws(() => artifactInventory(new Map(), { notFoundPath: "/404.html" }), /notFoundPath/);
  assert.throws(() => handler(new Map([["index.html", "home"]]), { cacheControl: 42 })(ctx("/")), /cache-control policy/);
});

test("shared HTTP core realizes validators, byte ranges, HEAD, and compression", async () => {
  const body = "ordinary artifact delivery ".repeat(100);
  const representation = handler(new Map([["index.html", body]]))(ctx("/"));
  const initial = await transport(representation);
  assert.equal(initial.statusCode, 200);
  assert.equal(initial.getHeader("cache-control"), "public, max-age=0, must-revalidate");
  assert.equal(initial.getHeader("accept-ranges"), "bytes");
  const etag = initial.getHeader("etag");
  assert.ok(etag);

  const unchanged = await transport(representation, { headers: { "if-none-match": etag } });
  assert.equal(unchanged.statusCode, 304);

  const range = await transport(representation, { headers: { range: "bytes=0-7" } });
  assert.equal(range.statusCode, 206);
  assert.equal(range.body.toString(), "ordinary");

  const head = await transport(representation, { method: "HEAD" });
  assert.equal(head.statusCode, 200);
  assert.equal(head.body, undefined);

  const compressed = await transport(representation, { headers: { "accept-encoding": "gzip" } });
  assert.equal(compressed.getHeader("content-encoding"), "gzip");
  assert.equal(gunzipSync(compressed.body).toString(), body);
});
