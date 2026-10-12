#!/usr/bin/env node
/**
 * Distribute one news-property build: read {propertyPath, manifestPath,
 * previousManifestPath} as JSON on stdin, run every configured distribution
 * channel against the manifest diff, and print the per-channel receipts to
 * stdout as JSON.
 */
import { readFile } from "node:fs/promises";
import { distributeBuild } from "../src/distribute.mjs";

/**
 * Read a readable stream to completion and parse it as JSON.
 * @param {NodeJS.ReadableStream} stream
 * @returns {Promise<object>}
 * @throws {TypeError} when the stream is empty
 */
async function readStdinJson(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim() === "") throw new TypeError("distribute-build requires a JSON object on stdin");
  return JSON.parse(text);
}

/**
 * Load a JSON file, returning null when it does not exist (a first build has
 * no previous manifest).
 * @param {string} filePath
 * @returns {Promise<object|null>}
 */
async function readJsonOrNull(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function main() {
  const input = await readStdinJson(process.stdin);
  if (typeof input.propertyPath !== "string" || input.propertyPath.trim() === "") {
    throw new TypeError("distribute-build stdin requires propertyPath");
  }
  if (typeof input.manifestPath !== "string" || input.manifestPath.trim() === "") {
    throw new TypeError("distribute-build stdin requires manifestPath");
  }
  const property = JSON.parse(await readFile(input.propertyPath, "utf8"));
  const manifest = JSON.parse(await readFile(input.manifestPath, "utf8"));
  const previousManifest = typeof input.previousManifestPath === "string" && input.previousManifestPath.trim() !== ""
    ? await readJsonOrNull(input.previousManifestPath)
    : null;

  const { receipts } = await distributeBuild({ property, manifest, previousManifest, env: process.env, fetch });
  process.stdout.write(`${JSON.stringify(receipts, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
