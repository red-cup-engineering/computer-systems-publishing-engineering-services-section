import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createBrowserAssetDevServer, configuredDevServerPort } from "../src/serve-browser-asset-tree.mjs";

// Some sandboxed network namespaces report `listen()`'s callback before the socket actually
// accepts connections, so the first connection attempt can see ECONNREFUSED against a listener
// that is genuinely up moments later — retry briefly rather than treating that as a real failure.
async function waitUntilReachable(base, attempts = 20, delayMs = 25) {
  for (let i = 0; i < attempts; i++) {
    try {
      await fetch(`${base}/`, { redirect: "manual" });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

async function withServer(server, fn) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  try {
    await waitUntilReachable(base);
    await fn(base);
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
}

async function withFixtureRoot(fn) {
  const root = await mkdtemp(join(tmpdir(), "serve-browser-asset-tree-"));
  try {
    await mkdir(join(root, "web"), { recursive: true });
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "vendor-pkg"), { recursive: true });
    await writeFile(join(root, "web", "index.html"), "<title>Fixture</title>");
    await writeFile(join(root, "src", "engine.mts"), "export const n: number = 1;\n");
    await writeFile(join(root, "vendor-pkg", "runtime.mjs"), "export const vendor = true;\n");
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("GET / redirects to /web/index.html rather than rewriting the response in place", async () => {
  await withFixtureRoot(async (root) => {
    const server = createBrowserAssetDevServer({ rootDirectory: root });
    await withServer(server, async (base) => {
      const res = await fetch(`${base}/`, { redirect: "manual" });
      assert.equal(res.status, 302);
      assert.equal(res.headers.get("location"), "/web/index.html");
    });
  });
});

test("GET /web/index.html serves the real document", async () => {
  await withFixtureRoot(async (root) => {
    const server = createBrowserAssetDevServer({ rootDirectory: root });
    await withServer(server, async (base) => {
      const res = await fetch(`${base}/web/index.html`);
      assert.equal(res.status, 200);
      assert.match(await res.text(), /<title>Fixture/);
    });
  });
});

test("GET /src/engine.mts serves stripped, valid JavaScript", async () => {
  await withFixtureRoot(async (root) => {
    const server = createBrowserAssetDevServer({ rootDirectory: root });
    await withServer(server, async (base) => {
      const res = await fetch(`${base}/src/engine.mts`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get("content-type") ?? "", /javascript/);
      const text = await res.text();
      assert.doesNotMatch(text, /: number/, "type annotations must be stripped");
      assert.match(text, /export const n\s*=\s*1;/);
    });
  });
});

test("a declared vendor prefix is served from its own on-disk root", async () => {
  await withFixtureRoot(async (root) => {
    const server = createBrowserAssetDevServer({
      rootDirectory: root,
      vendorRoots: { "/vendor/pkg/": join(root, "vendor-pkg") },
    });
    await withServer(server, async (base) => {
      const res = await fetch(`${base}/vendor/pkg/runtime.mjs`);
      assert.equal(res.status, 200);
      assert.match(await res.text(), /vendor = true/);
    });
  });
});

test("GET /api/manifest returns the declared manifest as JSON, only when one is declared", async () => {
  await withFixtureRoot(async (root) => {
    const withManifest = createBrowserAssetDevServer({ rootDirectory: root, manifest: { id: "fixture" } });
    await withServer(withManifest, async (base) => {
      const res = await fetch(`${base}/api/manifest`);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { id: "fixture" });
    });

    const withoutManifest = createBrowserAssetDevServer({ rootDirectory: root });
    await withServer(withoutManifest, async (base) => {
      const res = await fetch(`${base}/api/manifest`);
      assert.notEqual(res.status, 200);
    });
  });
});

test("a path-traversal attempt against a .mts request is rejected, not served", async () => {
  await withFixtureRoot(async (root) => {
    const server = createBrowserAssetDevServer({ rootDirectory: root });
    await withServer(server, async (base) => {
      const res = await fetch(`${base}/..%2f..%2f..%2fetc%2fpasswd.mts`);
      assert.notEqual(res.status, 200);
    });
  });
});

test("an unknown path 404s rather than throwing a raw server error", async () => {
  await withFixtureRoot(async (root) => {
    const server = createBrowserAssetDevServer({ rootDirectory: root });
    await withServer(server, async (base) => {
      const res = await fetch(`${base}/this/path/does/not/exist.txt`);
      assert.equal(res.status, 404);
    });
  });
});

test("configuredDevServerPort prefers argv, then PORT env, then the default", () => {
  assert.equal(configuredDevServerPort({ argv: ["node", "server.mjs", "9001"], env: {}, defaultPort: 8000 }), 9001);
  assert.equal(configuredDevServerPort({ argv: ["node", "server.mjs"], env: { PORT: "9002" }, defaultPort: 8000 }), 9002);
  assert.equal(configuredDevServerPort({ argv: ["node", "server.mjs"], env: {}, defaultPort: 8000 }), 8000);
});
