import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createStaticBrowserDevServer } from "../src/serve-static-browser-tree.mjs";

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
  const root = await mkdtemp(join(tmpdir(), "serve-static-browser-tree-"));
  try {
    await mkdir(join(root, "web", "pig"), { recursive: true });
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "vendor-pkg"), { recursive: true });
    await writeFile(join(root, "web", "index.html"), "<title>Fixture</title>");
    await writeFile(join(root, "web", "pig", "index.html"), "<title>Pig</title>");
    await writeFile(join(root, "src", "engine.mts"), "export const n: number = 1;\n");
    await writeFile(join(root, "vendor-pkg", "runtime.mjs"), "export const vendor = true;\n");
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("redirect mode: GET / redirects to /web/index.html rather than rewriting in place", async () => {
  await withFixtureRoot(async (root) => {
    await withServer(createStaticBrowserDevServer({ rootDirectory: root }), async (base) => {
      const res = await fetch(`${base}/`, { redirect: "manual" });
      assert.equal(res.status, 302);
      assert.equal(res.headers.get("location"), "/web/index.html");
    });
  });
});

test("redirect mode: ordinary paths resolve directly under rootDirectory, mirroring the filesystem", async () => {
  await withFixtureRoot(async (root) => {
    await withServer(createStaticBrowserDevServer({ rootDirectory: root }), async (base) => {
      const res = await fetch(`${base}/web/index.html`);
      assert.equal(res.status, 200);
      assert.match(await res.text(), /<title>Fixture/);
    });
  });
});

test("pretty-urls mode: GET / serves web/index.html directly, no redirect", async () => {
  await withFixtureRoot(async (root) => {
    await withServer(createStaticBrowserDevServer({ rootDirectory: root, frontDoor: "pretty-urls" }), async (base) => {
      const res = await fetch(`${base}/`, { redirect: "manual" });
      assert.equal(res.status, 200);
      assert.match(await res.text(), /<title>Fixture/);
    });
  });
});

test("pretty-urls mode: a trailing-slash path resolves to that directory's index.html under web/", async () => {
  await withFixtureRoot(async (root) => {
    await withServer(createStaticBrowserDevServer({ rootDirectory: root, frontDoor: "pretty-urls" }), async (base) => {
      const res = await fetch(`${base}/pig/`);
      assert.equal(res.status, 200);
      assert.match(await res.text(), /<title>Pig/);
    });
  });
});

test("pretty-urls mode: a fully-qualified /src/ path still resolves straight under rootDirectory", async () => {
  await withFixtureRoot(async (root) => {
    await withServer(createStaticBrowserDevServer({ rootDirectory: root, frontDoor: "pretty-urls" }), async (base) => {
      const res = await fetch(`${base}/src/engine.mts`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get("content-type") ?? "", /javascript/);
    });
  });
});

test("a .mts request is served stripped, valid JavaScript", async () => {
  await withFixtureRoot(async (root) => {
    await withServer(createStaticBrowserDevServer({ rootDirectory: root }), async (base) => {
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
    const server = createStaticBrowserDevServer({
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

test("a path-traversal attempt is rejected, not served", async () => {
  await withFixtureRoot(async (root) => {
    await withServer(createStaticBrowserDevServer({ rootDirectory: root }), async (base) => {
      const res = await fetch(`${base}/..%2f..%2f..%2fetc%2fpasswd`);
      assert.notEqual(res.status, 200);
    });
  });
});

test("an unknown path 404s rather than throwing a raw server error", async () => {
  await withFixtureRoot(async (root) => {
    await withServer(createStaticBrowserDevServer({ rootDirectory: root }), async (base) => {
      const res = await fetch(`${base}/this/path/does/not/exist.txt`);
      assert.equal(res.status, 404);
    });
  });
});
