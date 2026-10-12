#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  generateImageWithFallback,
  buildProvenance,
  DEFAULT_PROVIDERS,
} from "@red-cup-engineering/computer-inference-engine/image/image-generation";

/**
 * Generate one article hero image through the image-generation team's
 * provider-fallback API (Cloudflare Workers AI free lane first, Gemini and
 * OpenRouter as paid fallbacks) and write it plus its provenance sidecar
 * beside it. Never throws for provider failure -- including missing
 * credentials in the environment the image team reads -- so a newsroom
 * pulse can proceed without a hero image; it returns a typed refusal
 * instead.
 * @param {{prompt:string, out:string, provider?:Function, providers?:Array<Function>, fetchImpl?:typeof fetch, targetWidth?:number, now?:()=>string}} opts
 * @returns {Promise<{refused:boolean, reason?:string, imagePath?:string, provenancePath?:string, provenance?:object}>}
 * @throws {Error} when prompt or out is missing (a usage error, not a provider failure)
 */
export async function generateHeroImage({
  prompt,
  out,
  provider,
  providers,
  fetchImpl,
  targetWidth,
  now = () => new Date().toISOString(),
} = {}) {
  if (!prompt) throw new Error("generateHeroImage requires prompt");
  if (!out) throw new Error("generateHeroImage requires out");

  const selectedProviders = providers ?? (provider ? [provider] : DEFAULT_PROVIDERS);

  let generated;
  try {
    generated = await generateImageWithFallback(prompt, {
      providers: selectedProviders,
      fetchImpl,
      targetWidth,
    });
  } catch (err) {
    return { refused: true, reason: err.message };
  }

  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, generated.buffer);

  const provenance = buildProvenance({
    provider: generated.provider,
    model: generated.model,
    promptUsed: prompt,
    generatedAt: now(),
    sourceWidthPx: generated.sourceWidthPx,
    targetWidthPx: generated.targetWidthPx,
    upscaled: generated.upscaled,
    upscaleNote: generated.upscaleNote,
    outputPath: out,
  });
  const ext = path.extname(out);
  const provenancePath = `${out.slice(0, out.length - ext.length)}.provenance.json`;
  await writeFile(provenancePath, JSON.stringify(provenance, null, 2), "utf8");

  return { refused: false, imagePath: out, provenancePath, provenance };
}

async function main() {
  const [prompt, out] = process.argv.slice(2);
  if (!prompt || !out) {
    console.error("usage: generate-hero-image.mjs <prompt> <out>");
    process.exitCode = 1;
    return;
  }
  const result = await generateHeroImage({ prompt, out });
  if (result.refused) {
    console.error(`refused: ${result.reason}`);
    process.exitCode = 1;
    return;
  }
  console.log(`wrote ${result.imagePath} (provider=${result.provenance.provider} model=${result.provenance.model})`);
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
