import { makeNiUri } from "@red-cup-engineering/uri-services-section/ni-uri";
import { canonicalJson } from "@red-cup-engineering/json-services-section/canonical-json";
import { parseJsonValue } from "@red-cup-engineering/json-services-section/parse-json-value";
import { createFileStore } from "@red-cup-engineering/immutable-content-custody-service/file-store";
import { createImmutableContentCustody } from "@red-cup-engineering/immutable-content-custody-service";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { admitArtifactFabricationRealizationPlan, admitArtifactFabricationSpecification } from "@red-cup-engineering/computer-data-engineering-services-section/artifact-fabrication";
import { audiobookMasteringSpecification, describeAudiobookEditionSource, wordErrorRate } from "@red-cup-engineering/voice-audio-services-section";

const ni = makeNiUri;
const semanticId = (value) => ni(Buffer.from(JSON.stringify(value)));

function command(program, args, options = {}) {
  const result = spawnSync(program, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, ...options });
  if (result.error && result.status !== 0) throw result.error;
  if (result.status !== 0) throw new Error(`${program} exited ${result.status}: ${(result.stderr || result.stdout).trim()}`);
  return result;
}

function fileEvidence(path) {
  const bytes = readFileSync(path);
  return Object.freeze({ path: resolve(path), bytes: bytes.byteLength, sha256: ni(bytes) });
}

function duration(path) {
  const result = command("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "json", path]);
  return Number(JSON.parse(result.stdout).format.duration);
}

function audioMeasurement(path) {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-i", path, "-af", "astats=metadata=1:reset=0", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const values = (name) => [...output.matchAll(new RegExp(`${name}:\\s*(-?inf|-?\\d+(?:\\.\\d+)?)`, "gu"))].map((match) => match[1] === "-inf" ? -Infinity : Number(match[1]));
  const rms = values("RMS level dB").filter(Number.isFinite).at(-1);
  const peak = values("Peak level dB").filter(Number.isFinite).at(-1);
  const floor = values("Noise floor dB").at(-1) ?? -Infinity;
  const policy = audiobookMasteringSpecification;
  return Object.freeze({ rmsDb: rms, peakDb: peak, noiseFloorDb: floor, conforms: rms >= policy.rmsDb.minimum && rms <= policy.rmsDb.maximum && peak <= policy.peakDbMaximum && floor <= policy.noiseFloorDbMaximum });
}

const escapeMetadata = (value) => String(value).replace(/([=;#\\\n])/gu, "\\$1");
const statSafe = (path) => { try { return statSync(path).isFile(); } catch { return false; } };

function concatFile(path, paths) {
  writeFileSync(path, paths.map((entry) => `file '${resolve(entry).replaceAll("'", "'\\''")}'`).join("\n") + "\n");
}

function splitAtLimit(text, maximum) {
  if (text.length <= maximum) return [text];
  const pieces = [];
  let rest = text;
  while (rest.length > maximum) {
    const boundary = Math.max(rest.lastIndexOf(" ", maximum), 1);
    pieces.push(rest.slice(0, boundary).trim());
    rest = rest.slice(boundary).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

/** Group stable sentence primitives only at the provider boundary. */
export function groupNarrationForSynthesis(events, maximumCharacters = 3000) {
  if (!Number.isInteger(maximumCharacters) || maximumCharacters < 100) throw new RangeError("maximumCharacters must be an integer of at least 100");
  const groups = [];
  let current = null;
  const flush = () => { if (current) groups.push(Object.freeze(current)); current = null; };
  for (const event of events) {
    if (event.type === "cue") {
      flush();
      if (event.text) for (const text of splitAtLimit(event.text, maximumCharacters)) groups.push(Object.freeze({ type: "speech", text, unitIds: [event.id ?? event.cue], speakerId: event.speakerId, voice: event.voice, style: event.style, anchor: null }));
      else groups.push(event);
      continue;
    }
    const pieces = splitAtLimit(event.text, maximumCharacters);
    for (const text of pieces) {
      const key = `${event.anchor.chapter}\u0000${event.anchor.paragraph}\u0000${event.speakerId}\u0000${JSON.stringify(event.voice)}\u0000${event.style}`;
      if (!current || current.key !== key || current.text.length + text.length + 1 > maximumCharacters) {
        flush();
        current = { type: "speech", key, text, unitIds: [event.id], speakerId: event.speakerId, voice: event.voice, style: event.style, anchor: { chapter: event.anchor.chapter, paragraph: event.anchor.paragraph } };
      } else {
        current.text += ` ${text}`;
        current.unitIds.push(event.id);
      }
    }
  }
  flush();
  return Object.freeze(groups.map(({ key: _key, ...group }) => Object.freeze(group)));
}

function synthesisRequest(group, layer, source) {
  const selected = group.voice ?? source.voiceSettings?.narrator ?? { id: "default" };
  return { text: group.text, voice: selected.id, style: group.style ?? selected.style ?? "narration", language: layer.language, pronunciations: source.storyBible.pronunciations ?? [], format: "wav", sampleRate: audiobookMasteringSpecification.sampleRate };
}

/** Interpret a sound-score narration layer into mastered audiobook artifacts. */
export async function fabricateAudiobookEdition(specificationCandidate, source, { synthesizeSpeech, ffmpeg = command, maximumSynthesisCharacters = 3000 } = {}) {
  if (typeof synthesizeSpeech !== "function") throw new TypeError("synthesizeSpeech capability is required");
  const layer = source.narrationLayer ?? source.narrationScript;
  const specification = specificationCandidate?.type === "ArtifactFabricationSpecification" ? specificationCandidate : admitArtifactFabricationSpecification(specificationCandidate);
  if (specification.type === "ArtifactFabricationSpecificationRefusal") return specification;
  const described = describeAudiobookEditionSource(source);
  if (specification.projections.some((projection) => projection.configuration?.editionInputDigest !== described.editionInputDigest)) return Object.freeze({ type: "AudiobookEditionFabricationResult", version: 1, status: "refused", code: "EDITION_INPUT_DIGEST_MISMATCH" });
  const plan = admitArtifactFabricationRealizationPlan(specification, { type: "ArtifactFabricationRealizationPlanCandidate", version: 1, artifactId: specification.artifact.id, specificationDigest: specification.specificationDigest, projectionIds: specification.projections.map(({ id }) => id), acceptanceObligationIds: specification.acceptanceObligations.map(({ id }) => id) });
  if (plan.type === "ArtifactFabricationRealizationPlanRefusal") return plan;
  const out = resolve(source.distDir); mkdirSync(out, { recursive: true });
  const work = join(out, ".audiobook-work"); mkdirSync(work, { recursive: true });
  const silence = async (seconds) => {
    const path = join(work, `silence-${seconds}.wav`);
    if (!statSafe(path)) ffmpeg("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", `anullsrc=r=${audiobookMasteringSpecification.sampleRate}:cl=mono`, "-t", String(seconds), "-c:a", "pcm_s16le", path]);
    return path;
  };
  const store = createFileStore(join(work, "content"));
  const custody = createImmutableContentCustody({ store, maximumBytes: 64 * 1024 * 1024 });
  const provenance = new Map(), chapterArtifacts = [], segmentEvidence = [];
  for (const chapter of layer.chapters) {
    const parts = [];
    for (const group of groupNarrationForSynthesis(chapter.events, maximumSynthesisCharacters)) {
      if (group.type === "cue") {
        if (group.durationSeconds > 0) parts.push(await silence(group.durationSeconds));
        continue;
      }
      const request = synthesisRequest(group, layer, source);
      const contentDigest = semanticId(request);
      const input = { type: "AudiobookSynthesisInput", version: 1, request, synthesizer: source.synthesizer.provenanceDigest, normalization: { sampleRate: audiobookMasteringSpecification.sampleRate, channels: audiobookMasteringSpecification.channels, codec: "pcm_s16le" } };
      const inputDigest = ni(Buffer.from(canonicalJson(input)));
      const token = inputDigest.split(";").at(-1), receiptKey = `synthesis/${token}.json`;
      const storedReceipt = await store.get(receiptKey);
      let receipt = storedReceipt ? parseJsonValue(Buffer.from(storedReceipt.body).toString("utf8")) : null;
      if (receipt && (receipt.type !== "AudiobookSynthesisReceipt" || receipt.version !== 1 || receipt.inputDigest !== inputDigest)) throw new Error("synthesis receipt does not bind this input");
      let retained = receipt ? await custody.get(receipt.audio) : null;
      const normalized = join(work, `${token}-44100.wav`);
      if (!retained) {
        const made = await synthesizeSpeech(request);
        if (!made?.bytes || !made?.provenance) throw new Error("synthesizeSpeech must return bytes and provenance");
        const raw = join(work, `${token}.wav`);
        writeFileSync(raw, Buffer.from(made.bytes));
        ffmpeg("ffmpeg", ["-y", "-v", "error", "-i", raw, "-ar", String(audiobookMasteringSpecification.sampleRate), "-ac", String(audiobookMasteringSpecification.channels), "-c:a", "pcm_s16le", normalized]);
        const bytes = readFileSync(normalized);
        const audio = await custody.put({ ni: ni(bytes), bytes, mediaType: "audio/wav" });
        receipt = { type: "AudiobookSynthesisReceipt", version: 1, inputDigest, audio, provenance: made.provenance };
        await store.putCurrent(receiptKey, { body: Buffer.from(canonicalJson(receipt)), mediaType: "application/json" });
      } else writeFileSync(normalized, retained.bytes);
      provenance.set(ni(Buffer.from(canonicalJson(receipt.provenance))), receipt.provenance);
      parts.push(normalized);
      segmentEvidence.push({ id: group.unitIds.join("+"), unitIds: group.unitIds, chapter: chapter.index, contentDigest, synthesisInputDigest: inputDigest, audio: receipt.audio, text: group.text, path: normalized, durationSeconds: duration(normalized) });
    }
    const concat = join(work, `${String(chapter.index).padStart(2, "0")}.concat.txt`); concatFile(concat, parts);
    const path = join(out, `${String(chapter.index).padStart(2, "0")}-${layer.slug}.mp3`);
    ffmpeg("ffmpeg", ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", concat, "-af", "loudnorm=I=-19:TP=-3.5:LRA=7", "-ar", String(audiobookMasteringSpecification.sampleRate), "-ac", String(audiobookMasteringSpecification.channels), "-c:a", "libmp3lame", "-b:a", "192k", "-metadata", `title=${chapter.title}`, "-metadata", `artist=${layer.author}`, "-metadata", `comment=${layer.disclosure}`, path]);
    chapterArtifacts.push({ index: chapter.index, title: chapter.title, ...fileEvidence(path), durationSeconds: duration(path), audio: audioMeasurement(path) });
  }
  const chapterList = join(work, "chapters.concat.txt"); concatFile(chapterList, chapterArtifacts.map(({ path }) => path));
  let startMs = 0;
  const chapters = chapterArtifacts.map((chapter) => { const start = startMs; startMs += Math.round(chapter.durationSeconds * 1000); return { ...chapter, startMs: start, endMs: startMs }; });
  const metadata = join(work, "chapters.ffmetadata");
  writeFileSync(metadata, `;FFMETADATA1\ntitle=${escapeMetadata(layer.title)}\nartist=${escapeMetadata(layer.author)}\ncomment=${escapeMetadata(layer.disclosure)}\n${chapters.map((chapter) => `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${chapter.startMs}\nEND=${chapter.endMs}\ntitle=${escapeMetadata(chapter.title)}\n`).join("")}`);
  const m4b = join(out, `${layer.slug}.m4b`);
  ffmpeg("ffmpeg", ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", chapterList, "-i", resolve(source.coverPath), "-f", "ffmetadata", "-i", metadata, "-map", "0:a", "-map", "1:v", "-map_metadata", "2", "-map_chapters", "2", "-c:a", "aac", "-b:a", "192k", "-c:v", "mjpeg", "-disposition:v", "attached_pic", "-movflags", "+faststart", m4b]);
  return Object.freeze({ type: "AudiobookEditionFabricationResult", version: 1, status: "fabricated-awaiting-acceptance", specification, plan, artifacts: Object.freeze({ chapterMp3s: chapters, m4b: { ...fileEvidence(m4b), durationSeconds: duration(m4b) } }), segments: Object.freeze(segmentEvidence), synthesizerProvenance: Object.freeze([...provenance].map(([digest, value]) => ({ digest, value }))), formatEvidence: Object.freeze({ mastering: audiobookMasteringSpecification, scoreCues: layer.chapters.map(({ index, events }) => ({ chapter: index, cues: events.filter(({ type }) => type === "cue") })), disclosure: layer.disclosure }), pendingAcceptanceObligationIds: ["independent-listening-proof"] });
}

/** First-pass proof using an injected transcribeMedia-compatible systems capability. */
export async function automatedListeningProof(fabrication, narrationLayer, { transcribe, threshold = 0.08, proofer = "computer-inference-engine Whisper" } = {}) {
  if (typeof transcribe !== "function") throw new TypeError("transcribe capability is required");
  const chapterReports = [], findings = [];
  for (const chapter of fabrication.artifacts.chapterMp3s) {
    const layerChapter = narrationLayer.chapters[chapter.index - 1];
    const reference = layerChapter.events.filter((event) => event.text).map(({ text }) => text).join(" ");
    const transcript = await transcribe(chapter.path, { expected: reference });
    chapterReports.push({ chapter: chapter.index, path: chapter.path, transcript, wordErrorRate: wordErrorRate(reference, transcript) });
    for (const segment of fabrication.segments.filter((item) => item.chapter === chapter.index)) {
      const heard = await transcribe(segment.path, { expected: segment.text });
      const segmentWer = wordErrorRate(segment.text, heard);
      if (segmentWer > threshold) findings.push({ id: `transcription-${segment.id}`, severity: "error", resolution: "open", chapter: chapter.index, segment: segment.id, unitIds: segment.unitIds, wordErrorRate: segmentWer, threshold, expected: segment.text, heard, claim: `segment word error rate ${segmentWer.toFixed(3)} exceeds ${threshold}` });
    }
  }
  return Object.freeze({ type: "AudiobookEditionProof", version: 1, editionInputDigest: fabrication.specification.projections[0].configuration.editionInputDigest, artifacts: { chapterMp3s: fabrication.artifacts.chapterMp3s.map(({ sha256 }) => sha256), m4b: fabrication.artifacts.m4b.sha256 }, proofer, producer: "automated-fabricator", provedAt: new Date().toISOString(), method: "Whisper transcription of every mastered chapter and rendered synthesis group; word error rate against the sound-score narration layer.", automated: true, threshold, chapterReports, findings });
}
