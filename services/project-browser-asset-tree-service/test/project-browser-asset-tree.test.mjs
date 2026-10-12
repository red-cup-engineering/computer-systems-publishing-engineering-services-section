import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { buildCloudflareStaticAssetTree } from "../src/project-browser-asset-tree.mjs";

test("HTML entries acquire new transitive imports without a vendor list; private source stays outside publication", async () => {
  const root = await mkdtemp(join(tmpdir(), "browser-closure-"));
  try {
    for (const dir of ["web/js", "web/css", "src", "node_modules/dice"]) await mkdir(join(root, dir), { recursive: true });
    await writeFile(join(root, "node_modules/dice/package.json"), JSON.stringify({ name: "dice", type: "module", exports: "./index.mjs" }));
    await writeFile(join(root, "node_modules/dice/index.mjs"), "export const value = 42;");
    await writeFile(join(root, "web/js/app.mjs"), "import { value } from 'dice'; globalThis.publishedAnswer = value;");
    await writeFile(join(root, "web/index.html"), '<!doctype html><title>Dice</title><script type="importmap">{"imports":{"dice":"/missing-vendor.mjs"}}</script><script type="module" src="js/app.mjs"></script><script type="module">globalThis.inlineAnswer = 7;</script>');
    await writeFile(join(root, "web/css/style.css"), "body { color: blue; }");
    await writeFile(join(root, "src/private.json"), "private");
    await writeFile(join(root, "web/js/server.mjs"), "import 'node:fs';");
    const output = await buildCloudflareStaticAssetTree({ rootDirectory: root });
    const html = await readFile(join(output, "web/index.html"), "utf8");
    assert.ok(!html.includes("importmap"));
    assert.ok(html.includes('src="/web/js/app.mjs"'));
    assert.equal(await readFile(join(output, "web/css/style.css"), "utf8"), "body { color: blue; }");
    await assert.rejects(readFile(join(output, "src/private.json")), { code: "ENOENT" });
    await assert.rejects(readFile(join(output, "web/js/server.mjs")), { code: "ENOENT" });
    await import(pathToFileURL(join(output, "web/js/app.mjs")) + "?first");
    assert.equal(globalThis.publishedAnswer, 42);
    const inline = [...html.matchAll(/src="([^"]+)"/g)].map((match) => match[1]).find((path) => path.includes(".module-"));
    await import(pathToFileURL(join(output, inline)));
    assert.equal(globalThis.inlineAnswer, 7);
    await writeFile(join(root, "node_modules/dice/index.mjs"), "export { value } from './new-leaf.mjs';");
    await writeFile(join(root, "node_modules/dice/new-leaf.mjs"), "export const value = 84;");
    await buildCloudflareStaticAssetTree({ rootDirectory: root });
    await import(pathToFileURL(join(output, "web/js/app.mjs")) + "?changed");
    assert.equal(globalThis.publishedAnswer, 84);
    await writeFile(join(root, "web/js/app.mjs"), "import 'does-not-exist';");
    await assert.rejects(buildCloudflareStaticAssetTree({ rootDirectory: root }), /Build failed/);
    await import(pathToFileURL(join(output, "web/js/app.mjs")) + "?after-failure");
    assert.equal(globalThis.publishedAnswer, 84, "a failed build retains the usable publication");
  } finally { delete globalThis.publishedAnswer; delete globalThis.inlineAnswer; await rm(root, { recursive: true, force: true }); }
});

test("publication refuses paths that could destroy authored files and obsolete vendor plans", async () => {
  const root = await mkdtemp(join(tmpdir(), "browser-path-"));
  try {
    for (const outputDirectory of ["..", ".", "web", "web/nested"]) await assert.rejects(buildCloudflareStaticAssetTree({ rootDirectory: root, outputDirectory }));
    await assert.rejects(buildCloudflareStaticAssetTree({ rootDirectory: root, copies: [] }), /obsolete/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
