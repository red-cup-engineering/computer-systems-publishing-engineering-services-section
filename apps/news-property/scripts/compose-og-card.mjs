#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { composeOgCard } from "../src/images.mjs";

/**
 * Read a JSON options file matching composeOgCard's options and compose the
 * Open Graph card it describes.
 * @param {string} optionsPath path to a JSON file: {headline, kicker?, propertyName?, wordmarkSvg?, palette?, heroImagePath?, out}
 * @returns {Promise<{path:string, width:number, height:number}>}
 */
export async function composeOgCardFromFile(optionsPath) {
  const options = JSON.parse(await readFile(optionsPath, "utf8"));
  return composeOgCard(options);
}

async function main() {
  const [optionsPath] = process.argv.slice(2);
  if (!optionsPath) {
    console.error("usage: compose-og-card.mjs <options.json>");
    process.exitCode = 1;
    return;
  }
  const result = await composeOgCardFromFile(optionsPath);
  console.log(`wrote ${result.path} (${result.width}x${result.height})`);
}

/**
 * True when this module was invoked directly as the process entry point,
 * including through a symlink (an npm bin shim, a release symlink) -- a
 * plain string compare against process.argv[1] fails for those and
 * silently no-ops instead.
 * @returns {boolean}
 */
function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return fileURLToPath(import.meta.url) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}
