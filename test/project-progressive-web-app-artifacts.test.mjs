import assert from "node:assert/strict";
import test from "node:test";
import { projectProgressiveWebAppArtifacts, createProgressiveWebAppProjector } from "../scripts/project-progressive-web-app-artifacts.mjs";

const CONFIG = {
  manifest: {
    name: "Field Notebook",
    shortName: "Notebook",
    description: "An offline field notebook.",
    startUrl: "/",
    display: "standalone",
    backgroundColor: "#f7f5ed",
    themeColor: "#17352b",
    orientation: "portrait-primary",
    categories: ["education", "utilities"],
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
  },
  precache: { additionalUrls: ["/api/bootstrap"] },
};

const INVENTORY = new Map([
  ["index.html", { body: "<!doctype html><title>Notebook</title>" }],
  ["app.js", { body: "console.log('ready')" }],
  ["icon.svg", { body: new Uint8Array([60, 115, 118, 103, 62]) }],
  ["notes/index.html", { body: "notes" }],
]);

test("projects a deterministic manifest and artifact-driven service worker", () => {
  const first = projectProgressiveWebAppArtifacts({ artifacts: INVENTORY, config: CONFIG });
  const second = projectProgressiveWebAppArtifacts({ artifacts: new Map([...INVENTORY].reverse()), config: CONFIG });
  assert.deepEqual(first.diagnostics, []);
  assert.deepEqual(second, first);
  const manifest = JSON.parse(first.artifacts.find(({ path }) => path === "manifest.webmanifest").body);
  assert.deepEqual(manifest, {
    name: "Field Notebook", short_name: "Notebook", description: "An offline field notebook.",
    start_url: "/", display: "standalone", background_color: "#f7f5ed", theme_color: "#17352b",
    orientation: "portrait-primary", categories: ["education", "utilities"],
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
  });
  const worker = first.artifacts.find(({ path }) => path === "service-worker.js");
  assert.equal(worker.cacheControl, "no-cache");
  assert.match(worker.body, /const PRECACHE=\["\/","\/api\/bootstrap","\/app.js","\/icon.svg","\/manifest.webmanifest","\/notes\/"\]/);
  assert.match(worker.body, /const CACHE_NAME="notebook-[a-f0-9]{16}"/);
  assert.match(worker.body, /key\.startsWith\(CACHE_PREFIX\)/);
  assert.match(worker.body, /event\.request\.mode==="navigate"/);
  assert.match(worker.body, /new URL\(event\.request\.url\)\.origin===self\.location\.origin/);
  assert.doesNotThrow(() => new Function(worker.body));
});

test("content changes revise the default cache while an explicit cache name stays fixed", () => {
  const before = projectProgressiveWebAppArtifacts({ artifacts: INVENTORY, config: CONFIG });
  const changed = new Map(INVENTORY); changed.set("app.js", { body: "console.log('changed')" });
  const after = projectProgressiveWebAppArtifacts({ artifacts: changed, config: CONFIG });
  const cache = (result) => result.artifacts.find(({ path }) => path === "service-worker.js").body.match(/const CACHE_NAME=([^;]+);/)[1];
  assert.notEqual(cache(before), cache(after));
  const pinned = { ...CONFIG, cacheName: "release-42" };
  assert.equal(cache(projectProgressiveWebAppArtifacts({ artifacts: INVENTORY, config: pinned })), '"release-42"');
  assert.equal(cache(projectProgressiveWebAppArtifacts({ artifacts: changed, config: pinned })), '"release-42"');
});

test("supports exact precache selection and configurable offline behavior", () => {
  const result = projectProgressiveWebAppArtifacts({
    artifacts: INVENTORY,
    config: {
      ...CONFIG,
      cacheNamePrefix: "field-shell",
      precache: { includePaths: ["index.html", "app.js"], excludePaths: ["app.js"] },
      offlineFallback: null,
      runtimeCaching: false,
      skipWaiting: false,
      claimClients: false,
      offlineResponse: { body: "No connection", status: 504, mediaType: "text/plain" },
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const worker = result.artifacts.find(({ path }) => path === "service-worker.js").body;
  assert.match(worker, /const PRECACHE=\["\/","\/manifest.webmanifest"\]/);
  assert.match(worker, /const OFFLINE_FALLBACK=null/);
  assert.match(worker, /const RUNTIME_CACHING=false/);
  assert.doesNotMatch(worker, /skipWaiting/);
  assert.doesNotMatch(worker, /clients\.claim/);
  assert.match(worker, /new Response\("No connection",\{status:504/);
});

test("fails closed on unsafe configuration, missing selections, and target collisions", () => {
  const inventory = new Map(INVENTORY);
  inventory.set("manifest.webmanifest", { body: "occupied" });
  const result = projectProgressiveWebAppArtifacts({
    artifacts: inventory,
    config: {
      manifest: { name: "", startUrl: "https://outside.example/", icons: [{ src: "//outside/icon.png" }] },
      cacheNamePrefix: "not safe",
      precache: { includePaths: ["missing.js"], additionalUrls: ["https://outside.example/api"] },
    },
  });
  assert.ok(result.diagnostics.some(({ code, subject }) => code === "PWA-003" && subject === "manifest.webmanifest"));
  assert.ok(result.diagnostics.some(({ code, subject }) => code === "PWA-002" && subject === "missing.js"));
  assert.ok(result.diagnostics.every(({ severity }) => severity === "error"));
  assert.equal(result.artifacts.some(({ path }) => path === "manifest.webmanifest"), false);
  assert.equal(result.artifacts.some(({ path }) => path === "service-worker.js"), true);
  assert.doesNotThrow(() => new Function(result.artifacts.find(({ path }) => path === "service-worker.js").body));
});

test("factory exposes the build-projector contract seam", async () => {
  const projector = createProgressiveWebAppProjector(CONFIG, { name: "site-pwa", priority: 120 });
  assert.deepEqual({ name: projector.name, priority: projector.priority }, { name: "site-pwa", priority: 120 });
  const contribution = await projector.project({ artifacts: INVENTORY });
  assert.deepEqual(contribution.diagnostics, []);
  assert.deepEqual(contribution.artifacts.map(({ path }) => path), ["manifest.webmanifest", "service-worker.js"]);
});
