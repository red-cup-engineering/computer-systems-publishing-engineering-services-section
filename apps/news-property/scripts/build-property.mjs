#!/usr/bin/env node
/** Build a configured news property without embedding property-specific code. */
import { readFileSync, realpathSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildProperty, declaredPropertyInputs, parsePost } from "../src/build.mjs";
export function buildConfiguredProperty(configPath, outputDir) {
  const absoluteConfig = resolve(configPath);
  const property = JSON.parse(readFileSync(absoluteConfig, "utf8"));
  return buildProperty({ property, ...declaredPropertyInputs(property, dirname(absoluteConfig)), outputDir: resolve(outputDir) });
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try { return fileURLToPath(import.meta.url) === realpathSync(process.argv[1]); } catch { return false; }
}

if (isMainModule()) {
  const [configPath, outputDir] = process.argv.slice(2);
  if (configPath === "--check-post" && outputDir && process.argv.length === 4) {
    try {
      const postPath = resolve(outputDir);
      const post = parsePost(readFileSync(postPath, "utf8"), basename(postPath));
      process.stdout.write(`${JSON.stringify({ disposition: "parseable", path: postPath, slug: post.slug, draft: post.draft, publicationAuthorized: false })}\n`);
    } catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
  } else if (configPath === "--check-post" || !configPath || !outputDir) {
    process.stderr.write("usage: news-property-build <property.json> <public-directory> | --check-post <post.md>\n");
    process.exitCode = 1;
  } else {
    try { process.stdout.write(`${JSON.stringify(buildConfiguredProperty(configPath, outputDir))}\n`); }
    catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
  }
}
