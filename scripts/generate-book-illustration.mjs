#!/usr/bin/env node
/** Generate one declared book image through the house inference engine. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { buildProvenance, generateImageWithFallback } from "@red-cup-engineering/computer-inference-engine/image/image-generation";

function visualStylePrompt(visualStyle) {
  if (visualStyle === undefined) return "";
  if (!visualStyle || typeof visualStyle !== "object" || Array.isArray(visualStyle)) throw new Error("story bible visualStyle must be an object");
  const parts = Object.entries(visualStyle).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : typeof value === "object" ? JSON.stringify(value) : value}`);
  return `Canon visual style — ${parts.join("; ")}. `;
}

/**
 * @param {{manifestPath:string,prompt:string,path:string,alt:string,role?:string}} request
 * @param {{generate?:typeof generateImageWithFallback,now?:()=>string}} capabilities
 */
export async function generateBookIllustration(request, { generate = generateImageWithFallback, now = () => new Date().toISOString() } = {}) {
  const manifestPath = resolve(request.manifestPath);
  const bookDir = dirname(manifestPath);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (typeof request.prompt !== "string" || request.prompt.trim() === "") throw new Error("an illustration prompt is required");
  if (typeof request.alt !== "string" || request.alt.trim() === "") throw new Error("generated illustrations require non-empty alt text");
  if (!request.path || !/\.png$/iu.test(request.path)) throw new Error("generated illustration path must end in .png");
  const role = request.role ?? "illustration";
  if (!["illustration", "chapter-art", "ornament"].includes(role)) throw new Error("generated illustration role must be illustration, chapter-art, or ornament");
  const storyBible = manifest.storyBible ? JSON.parse(readFileSync(resolve(bookDir, manifest.storyBible), "utf8")) : {};
  const promptUsed = `${visualStylePrompt(storyBible.visualStyle)}${request.prompt.trim()}`;
  const generated = await generate(promptUsed);
  const imagePath = resolve(bookDir, request.path);
  if (relative(bookDir, imagePath).startsWith("..")) throw new Error("generated illustration path must stay inside the book directory");
  mkdirSync(dirname(imagePath), { recursive: true });
  writeFileSync(imagePath, generated.buffer);
  const generatedAt = now();
  const provenance = buildProvenance({
    provider: generated.provider, model: generated.model, promptUsed, generatedAt,
    sourceWidthPx: generated.sourceWidthPx, targetWidthPx: generated.targetWidthPx,
    upscaled: generated.upscaled, upscaleNote: generated.upscaleNote, outputPath: request.path,
  });
  const provenancePath = imagePath.replace(/\.png$/iu, ".provenance.json");
  writeFileSync(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`, "utf8");
  const declaration = { path: request.path, alt: request.alt.trim(), role, provenance: { ...provenance, sidecar: relative(bookDir, provenancePath) } };
  const assets = manifest.assets ?? [];
  const existing = assets.findIndex((asset) => asset.path === request.path);
  if (existing === -1) assets.push(declaration); else assets[existing] = declaration;
  manifest.assets = assets;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { imagePath, provenancePath, promptUsed, asset: declaration };
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { prompt: { type: "string" }, path: { type: "string" }, alt: { type: "string" }, role: { type: "string" } } });
  if (!positionals[0] || !values.prompt || !values.path || !values.alt) throw new Error("usage: generate-book-illustration.mjs <ebook.json> --prompt <text> --path <image.png> --alt <text> [--role illustration|chapter-art|ornament]");
  console.log(JSON.stringify(await generateBookIllustration({ manifestPath: positionals[0], prompt: values.prompt, path: values.path, alt: values.alt, role: values.role }), null, 2));
}
