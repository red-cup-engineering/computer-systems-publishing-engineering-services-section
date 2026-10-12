import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildProperty } from "../src/build.mjs";

const here = dirname(fileURLToPath(import.meta.url));

/** Every file under a directory, as absolute paths. */
function walk(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

test("a build publishes nothing that identifies the build machine", () => {
  const scratch = mkdtempSync(join(tmpdir(), "news-property-machine-local-"));
  try {
    const contentDir = join(scratch, "content");
    const outputDir = join(scratch, "public");
    cpSync(join(here, "fixtures", "content"), contentDir, { recursive: true });
    const property = JSON.parse(readFileSync(join(here, "fixtures", "property.json"), "utf8"));
    buildProperty({ property, contentDir, outputDir, asOf: new Date("2026-07-20T00:00:00Z") });
    const machineLocal = [scratch, here, homedir()].filter((value) => value.length > 1);
    const leaks = [];
    for (const file of walk(outputDir)) {
      const bytes = readFileSync(file);
      if (bytes.includes(0)) continue;
      const text = bytes.toString("utf8");
      for (const needle of machineLocal) if (text.includes(needle)) leaks.push(`${file.slice(outputDir.length)} embeds a build-machine path`);
      if (/(?<![\w/])\/home\/[a-z_][\w-]*\//u.test(text)) leaks.push(`${file.slice(outputDir.length)} embeds a home-directory path`);
    }
    assert.deepEqual(leaks, []);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
