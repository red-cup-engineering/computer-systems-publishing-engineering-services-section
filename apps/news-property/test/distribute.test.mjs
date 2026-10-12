import { test } from "node:test";
import assert from "node:assert/strict";
import {
  diffManifestRoutes,
  submitIndexNow,
  publishWebSub,
  postBluesky,
  distributeBuild,
} from "../src/distribute.mjs";

/**
 * A minimal fetch-shaped Response for fakes.
 * @param {object} input
 * @param {number} [input.status]
 * @param {object} [input.json]
 * @returns {{ok: boolean, status: number, json: () => Promise<object>}}
 */
function fakeResponse({ status = 200, json = {} } = {}) {
  return { ok: status >= 200 && status < 300, status, json: async () => json };
}

/** A fetch fake that must never be called; fails the test if it is. */
function unreachableFetch() {
  return async (...args) => {
    throw new Error(`fetch must not be called, was called with ${JSON.stringify(args[0])}`);
  };
}

test("diffManifestRoutes: no previous manifest marks every route new", () => {
  const manifest = { routes: [{ url: "https://x.example/a", hash: "1" }, { url: "https://x.example/b", hash: "2" }] };
  const changes = diffManifestRoutes(manifest, null);
  assert.deepEqual(changes, [
    { url: "https://x.example/a", status: "new" },
    { url: "https://x.example/b", status: "new" },
  ]);
});

test("diffManifestRoutes: unchanged hash is not reported, changed hash is, removed route is not reported", () => {
  const previous = { routes: [
    { url: "https://x.example/a", hash: "1" },
    { url: "https://x.example/b", hash: "2" },
    { url: "https://x.example/gone", hash: "9" },
  ] };
  const current = { routes: [
    { url: "https://x.example/a", hash: "1" },
    { url: "https://x.example/b", hash: "2-changed" },
    { url: "https://x.example/c", hash: "3" },
  ] };
  const changes = diffManifestRoutes(current, previous);
  assert.deepEqual(changes, [
    { url: "https://x.example/b", status: "changed" },
    { url: "https://x.example/c", status: "new" },
  ]);
});

test("diffManifestRoutes: tolerates an artifacts-shaped manifest", () => {
  const manifest = { artifacts: [{ url: "https://x.example/a", contentHash: "abc" }] };
  assert.deepEqual(diffManifestRoutes(manifest, null), [{ url: "https://x.example/a", status: "new" }]);
});

test("submitIndexNow: request body shape against a fake fetch", async () => {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    return fakeResponse({ status: 200 });
  };
  const receipt = await submitIndexNow({
    key: "the-key",
    keyLocation: "https://koios.news/the-key.txt",
    host: "koios.news",
    urls: ["https://koios.news/a", "https://koios.news/b"],
    fetch,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.indexnow.org/indexnow");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers["content-type"], "application/json; charset=utf-8");
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.host, "koios.news");
  assert.equal(body.key, "the-key");
  assert.equal(body.keyLocation, "https://koios.news/the-key.txt");
  assert.deepEqual(body.urlList, ["https://koios.news/a", "https://koios.news/b"]);
  assert.equal(receipt.channel, "indexnow");
  assert.equal(receipt.attempted, true);
  assert.equal(receipt.status, "ok");
});

test("submitIndexNow: refuses with a reason when the key is absent, never calling fetch", async () => {
  const receipt = await submitIndexNow({ host: "koios.news", urls: ["https://koios.news/a"], fetch: unreachableFetch() });
  assert.equal(receipt.attempted, false);
  assert.equal(receipt.status, "refused");
  assert.match(receipt.reason, /missing-credential/);
});

test("submitIndexNow: refuses when there are no changed urls", async () => {
  const receipt = await submitIndexNow({ key: "k", host: "koios.news", urls: [], fetch: unreachableFetch() });
  assert.equal(receipt.status, "refused");
  assert.match(receipt.reason, /no-changed-urls/);
});

test("publishWebSub: form body shape against a fake fetch", async () => {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    return fakeResponse({ status: 204 });
  };
  const receipt = await publishWebSub({
    hub: "https://pubsubhubbub.example/hub",
    topics: ["https://koios.news/rss.xml", "https://koios.news/atom.xml"],
    fetch,
  });
  assert.equal(calls[0].url, "https://pubsubhubbub.example/hub");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers["content-type"], "application/x-www-form-urlencoded");
  const form = new URLSearchParams(calls[0].options.body);
  assert.equal(form.get("hub.mode"), "publish");
  assert.deepEqual(form.getAll("hub.url"), ["https://koios.news/rss.xml", "https://koios.news/atom.xml"]);
  assert.equal(receipt.status, "ok");
});

test("publishWebSub: refuses with a reason when the hub is absent, never calling fetch", async () => {
  const receipt = await publishWebSub({ topics: ["https://koios.news/rss.xml"], fetch: unreachableFetch() });
  assert.equal(receipt.attempted, false);
  assert.match(receipt.reason, /missing-config/);
});

test("postBluesky: session then record, in order, with the session token forwarded", async () => {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("com.atproto.server.createSession")) {
      return fakeResponse({ status: 200, json: { accessJwt: "jwt-123", did: "did:plc:abc" } });
    }
    if (url.endsWith("com.atproto.repo.createRecord")) {
      return fakeResponse({ status: 200, json: { uri: "at://did:plc:abc/app.bsky.feed.post/1" } });
    }
    throw new Error(`unexpected url ${url}`);
  };
  const receipt = await postBluesky({
    handle: "koios.bsky.social",
    appPassword: "app-pass",
    text: "New from Koios: https://koios.news/a",
    url: "https://koios.news/a",
    fetch,
    now: () => "2026-09-02T00:00:00.000Z",
  });
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /createSession$/);
  assert.match(calls[1].url, /createRecord$/);
  assert.deepEqual(JSON.parse(calls[0].options.body), { identifier: "koios.bsky.social", password: "app-pass" });
  assert.equal(calls[1].options.headers.authorization, "Bearer jwt-123");
  const recordBody = JSON.parse(calls[1].options.body);
  assert.equal(recordBody.repo, "did:plc:abc");
  assert.equal(recordBody.collection, "app.bsky.feed.post");
  assert.equal(recordBody.record.text, "New from Koios: https://koios.news/a");
  assert.equal(recordBody.record.createdAt, "2026-09-02T00:00:00.000Z");
  assert.equal(recordBody.record.facets.length, 1);
  assert.equal(recordBody.record.facets[0].features[0].uri, "https://koios.news/a");
  assert.equal(receipt.status, "ok");
  assert.equal(receipt.uri, "at://did:plc:abc/app.bsky.feed.post/1");
});


test("postBluesky: an accepted sanitized image is uploaded then embedded with alt text", async () => {
  const calls = [];
  const blob = { $type: "blob", ref: { $link: "bafkreiimage" }, mimeType: "image/png", size: 4 };
  const fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("com.atproto.server.createSession")) return fakeResponse({ status: 200, json: { accessJwt: "jwt", did: "did:plc:abc" } });
    if (url.endsWith("com.atproto.repo.uploadBlob")) return fakeResponse({ status: 200, json: { blob } });
    if (url.endsWith("com.atproto.repo.createRecord")) return fakeResponse({ status: 200, json: { uri: "at://did:plc:abc/app.bsky.feed.post/media" } });
    throw new Error(`unexpected url ${url}`);
  };
  const bytes = new Uint8Array([137,80,78,71]);
  const receipt = await postBluesky({
    handle: "koios.bsky.social",
    appPassword: "app-pass",
    stories: [{
      text: "New story https://koios.news/posts/a/",
      url: "https://koios.news/posts/a/",
      image: { bytes, mimeType: "image/png", alt: "Royal-blue editorial illustration of the article topic.", sanitized: true, aspectRatio: { width: 1200, height: 675 } },
    }],
    fetch,
    now: () => "2026-10-04T17:00:00.000Z",
  });
  assert.equal(receipt.status, "ok");
  assert.equal(calls.length, 3);
  assert.match(calls[1].url, /uploadBlob$/u);
  assert.equal(calls[1].options.headers.authorization, "Bearer jwt");
  assert.equal(calls[1].options.headers["content-type"], "image/png");
  assert.equal(calls[1].options.body, bytes);
  const record = JSON.parse(calls[2].options.body).record;
  assert.equal(record.embed.$type, "app.bsky.embed.images");
  assert.equal(record.embed.images[0].alt, "Royal-blue editorial illustration of the article topic.");
  assert.deepEqual(record.embed.images[0].image, blob);
  assert.deepEqual(record.embed.images[0].aspectRatio, { width: 1200, height: 675 });
});

test("postBluesky: image packets fail closed before upload when acceptance requirements are missing", async () => {
  const base = {
    handle: "koios.bsky.social",
    appPassword: "app-pass",
    text: "Story https://koios.news/a",
    url: "https://koios.news/a",
  };
  const sessionOnly = async (url) => {
    if (url.endsWith("com.atproto.server.createSession")) return fakeResponse({ status: 200, json: { accessJwt: "jwt", did: "did:plc:abc" } });
    throw new Error(`unexpected image upload: ${url}`);
  };
  for (const [image, reason] of [
    [{ bytes: new Uint8Array([1]), mimeType: "image/png", alt: "", sanitized: true }, "alt-required"],
    [{ bytes: new Uint8Array([1]), mimeType: "image/png", alt: "alt", sanitized: false }, "metadata-not-sanitized"],
    [{ bytes: new Uint8Array([1]), mimeType: "image/gif", alt: "alt", sanitized: true }, "mime-unsupported"],
  ]) {
    const receipt = await postBluesky({ ...base, stories: [{ text: base.text, url: base.url, image }], fetch: sessionOnly });
    assert.equal(receipt.status, "error");
    assert.match(receipt.posts[0].reason, new RegExp(reason));
  }
});

test("postBluesky: refuses with a reason when the app password is absent, never calling fetch", async () => {
  const receipt = await postBluesky({
    handle: "koios.bsky.social",
    text: "hello",
    url: "https://koios.news/a",
    fetch: unreachableFetch(),
  });
  assert.equal(receipt.attempted, false);
  assert.match(receipt.reason, /missing-credential/);
  assert.match(receipt.reason, /BLUESKY_APP_PASSWORD/);
});

test("distributeBuild: diffs manifests and runs every channel, one receipt each", async () => {
  const property = {
    name: "Koios News",
    origin: "https://koios.news",
    distribution: {
      indexNow: { key: "the-key" },
      websubHub: "https://pubsubhubbub.example/hub",
      blueskyHandle: "koios.bsky.social",
    },
  };
  const manifest = { routes: [{ url: "https://koios.news/posts/a-story/", hash: "1" }] };
  const calls = [];
  const fetch = async (url, options) => {
    calls.push(url);
    if (url === "https://api.indexnow.org/indexnow") return fakeResponse({ status: 200 });
    if (url === "https://pubsubhubbub.example/hub") return fakeResponse({ status: 204 });
    if (url.endsWith("com.atproto.server.createSession")) return fakeResponse({ status: 200, json: { accessJwt: "jwt", did: "did:plc:x" } });
    if (url.endsWith("com.atproto.repo.createRecord")) return fakeResponse({ status: 200, json: { uri: "at://did:plc:x/app.bsky.feed.post/1" } });
    throw new Error(`unexpected url ${url} ${JSON.stringify(options)}`);
  };

  const { routes, receipts } = await distributeBuild({ property, manifest, previousManifest: null, env: { BLUESKY_APP_PASSWORD: "app-pass" }, fetch });

  assert.deepEqual(routes, [{ url: "https://koios.news/posts/a-story/", status: "new" }]);
  assert.equal(receipts.length, 3);
  assert.deepEqual(receipts.map((r) => r.channel), ["indexnow", "websub", "bluesky"]);
  assert.equal(receipts[0].status, "ok");
  assert.equal(receipts[1].status, "ok");
  assert.equal(receipts[2].status, "ok");
  assert.ok(calls.includes("https://api.indexnow.org/indexnow"));
  assert.ok(calls.includes("https://pubsubhubbub.example/hub"));
});

test("distributeBuild: an unconfigured channel refuses without blocking the others", async () => {
  const property = { name: "Koios News", origin: "https://koios.news", distribution: {} };
  const manifest = { routes: [{ url: "https://koios.news/posts/a-story/", hash: "1" }] };
  const fetch = async () => { throw new Error("no channel is configured; fetch must not be called"); };

  const { receipts } = await distributeBuild({ property, manifest, previousManifest: null, env: {}, fetch });

  assert.equal(receipts.length, 3);
  for (const receipt of receipts) {
    assert.equal(receipt.attempted, false);
    assert.equal(receipt.status, "refused");
    assert.ok(typeof receipt.reason === "string" && receipt.reason.length > 0);
  }
});
