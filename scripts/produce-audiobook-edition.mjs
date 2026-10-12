#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { listChapters } from "@red-cup-engineering/ebook-engineering-services-section";
import { deriveSoundScoreNarrationLayer } from "@red-cup-engineering/ebook-engineering-services-section/narration-script";
import { scoreFromNarrationLayer } from "@red-cup-engineering/voice-audio-services-section/audioplay-model";
import { audiobookEditionSpecification } from "@red-cup-engineering/voice-audio-services-section";
import { automatedListeningProof, fabricateAudiobookEdition } from "../src/audiobook-production.mjs";

export async function produceAudiobookEdition(configPath) {
  const absoluteConfig = resolve(configPath), root = dirname(absoluteConfig);
  const config = JSON.parse(readFileSync(absoluteConfig, "utf8"));
  const ebookPath = resolve(root, config.ebook), ebook = JSON.parse(readFileSync(ebookPath, "utf8"));
  const bookDir = resolve(dirname(ebookPath), ebook.bookDir ?? ".");
  const storyBible = JSON.parse(readFileSync(resolve(dirname(ebookPath), ebook.storyBible), "utf8"));
  const narrationLayer = deriveSoundScoreNarrationLayer({ slug: ebook.slug, title: ebook.title, author: ebook.author, language: config.language ?? "en-US", storyBible, chapters: listChapters(bookDir).map((path) => ({ path, text: readFileSync(path, "utf8") })) });
  const synthesizerModule = await import(config.synthesizer.module);
  if (typeof synthesizerModule.synthesizeSpeech !== "function") throw new Error(`${config.synthesizer.module} does not export synthesizeSpeech`);
  const soundScore = scoreFromNarrationLayer(narrationLayer);
  const source = { narrationLayer, soundScore, storyBible, voiceSettings: storyBible.voices ?? {}, synthesizer: { provenanceDigest: config.synthesizer.provenanceDigest }, coverPath: resolve(root, config.cover), distDir: resolve(root, config.distDir) };
  const candidate = audiobookEditionSpecification(source);
  if (config.records.soundScore) writeFileSync(resolve(root, config.records.soundScore), `${JSON.stringify(soundScore, null, 2)}\n`);
  const fabrication = await fabricateAudiobookEdition(candidate, source, { synthesizeSpeech: synthesizerModule.synthesizeSpeech, maximumSynthesisCharacters: config.maximumSynthesisCharacters ?? config.maxSegmentCharacters ?? 3000 });
  writeFileSync(resolve(root, config.records.specification), `${JSON.stringify(fabrication.specification ?? candidate, null, 2)}\n`);
  writeFileSync(resolve(root, config.records.fabrication), `${JSON.stringify(fabrication, null, 2)}\n`);
  if (fabrication.status !== "fabricated-awaiting-acceptance") throw new Error(`${fabrication.code}: ${fabrication.message}`);
  const { transcribeMedia } = await import("@red-cup-engineering/computer-inference-engine/audio/transcription");
  const proof = await automatedListeningProof(fabrication, narrationLayer, { transcribe: transcribeMedia, threshold: config.transcriptionWordErrorThreshold ?? 0.08 });
  writeFileSync(resolve(root, config.records.automatedProof), `${JSON.stringify(proof, null, 2)}\n`);
  return { soundScore, specification: fabrication.specification, fabrication, automatedProof: proof };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const configPath = process.argv[2];
  if (!configPath) throw new Error("usage: produce-audiobook-edition.mjs <audiobook.json>");
  produceAudiobookEdition(configPath).then((result) => console.log(JSON.stringify({ status: result.fabrication.status, artifacts: result.fabrication.artifacts, automatedProof: result.automatedProof.findings.length }, null, 2))).catch((error) => { console.error(error); process.exitCode = 1; });
}
