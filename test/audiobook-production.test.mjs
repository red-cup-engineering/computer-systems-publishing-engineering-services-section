import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { acceptAudiobookEdition, audiobookEditionSpecification } from "@red-cup-engineering/voice-audio-services-section";
import { automatedListeningProof, fabricateAudiobookEdition } from "../src/audiobook-production.mjs";

function toneWav(seconds = 1.2, sampleRate = 44100) {
  const samples = Math.round(seconds * sampleRate), dataBytes = samples * 2;
  const bytes = Buffer.alloc(44 + dataBytes);
  bytes.write("RIFF", 0); bytes.writeUInt32LE(36 + dataBytes, 4); bytes.write("WAVEfmt ", 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(sampleRate, 24); bytes.writeUInt32LE(sampleRate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write("data", 36); bytes.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples; i++) bytes.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * i / sampleRate) * 6000), 44 + i * 2);
  return bytes;
}

function run(program, args) {
  const result = spawnSync(program, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw result.error ?? new Error(result.stderr);
  return result.stdout;
}

const narrate = (chapter, paragraph, text, id) => ({ type: "narrate", id, digest: id, anchor: { chapter, paragraph, sentence: 0, contentDigest: id }, kind: "paragraph", text, speakerId: "test", voice: { id: "test" }, style: "plain" });

test("a stub synthesizer fabricates score cues, chapter MP3s, a marked M4B, loud masters, and reusable edition records", async () => {
  const dir = mkdtempSync(join(tmpdir(), "audiobook-fixture-"));
  try {
    const cover = join(dir, "cover.jpg");
    run("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=navy:s=600x600", "-frames:v", "1", cover]);
    const narrationLayer = { type: "SoundScoreNarrationLayer", version: 1, slug: "fixture", title: "Fixture Book", author: "Test Author", language: "en-US", disclosure: "This audiobook is narrated by a synthesized voice.", digest: `ni:///sha-256;${"A".repeat(43)}`, chapters: [
      { index: 1, path: "01.md", title: "One", events: [{ type: "cue", cue: "room-tone", durationSeconds: 0.75 }, narrate("01.md", 0, "One", "one"), narrate("01.md", 1, "Repeated paragraph.", "repeat-one"), { type: "cue", cue: "room-tone", durationSeconds: 2 }] },
      { index: 2, path: "02.md", title: "Two", events: [{ type: "cue", cue: "room-tone", durationSeconds: 0.75 }, narrate("02.md", 0, "Two", "two"), narrate("02.md", 1, "Repeated paragraph.", "repeat-two"), { type: "cue", cue: "room-tone", durationSeconds: 2 }] },
    ] };
    const source = { narrationLayer, storyBible: { type: "StoryBible", version: 1, pronunciations: [] }, voiceSettings: { narrator: { id: "test" } }, synthesizer: { provenanceDigest: `ni:///sha-256;${"B".repeat(43)}` }, coverPath: cover, distDir: join(dir, "dist") };
    const candidate = audiobookEditionSpecification(source);
    assert.equal(candidate.type, "ArtifactFabricationSpecificationCandidate");
    let calls = 0;
    const fabrication = await fabricateAudiobookEdition(candidate, source, { synthesizeSpeech: async () => { calls++; return { bytes: toneWav(), provenance: { provider: "fixture", model: "tone-v1" } }; } });
    assert.equal(fabrication.status, "fabricated-awaiting-acceptance");
    assert.equal(fabrication.artifacts.chapterMp3s.length, 2);
    assert.equal(calls, 3, "identical content-hash requests are synthesized once");
    assert.equal(fabrication.synthesizerProvenance.length, 1);
    assert.equal(fabrication.formatEvidence.scoreCues[0].cues[0].durationSeconds, 0.75);
    for (const chapter of fabrication.artifacts.chapterMp3s) {
      assert.ok(readFileSync(chapter.path).subarray(0, 3).toString() === "ID3" || readFileSync(chapter.path).subarray(0, 2).toString("hex") === "fffb");
      assert.ok(chapter.durationSeconds > 3);
      assert.equal(chapter.audio.conforms, true, JSON.stringify(chapter.audio));
      assert.match(chapter.sha256, /^ni:\/\/\/sha-256;/u);
      const mp3 = JSON.parse(run("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name,sample_rate,bit_rate", "-of", "json", chapter.path])).streams[0];
      assert.equal(mp3.codec_name, "mp3");
      assert.equal(mp3.sample_rate, "44100");
      assert.equal(mp3.bit_rate, "192000");
    }
    const probe = JSON.parse(run("ffprobe", ["-v", "error", "-show_chapters", "-show_streams", "-show_format", "-of", "json", fabrication.artifacts.m4b.path]));
    assert.deepEqual(probe.chapters.map((chapter) => chapter.tags.title), ["One", "Two"]);
    assert.equal(probe.format.tags.title, "Fixture Book");
    assert.equal(probe.format.tags.comment, narrationLayer.disclosure);
    assert.ok(probe.streams.some((stream) => stream.codec_type === "video" && stream.disposition.attached_pic === 1));
    const automated = await automatedListeningProof(fabrication, narrationLayer, { transcribe: async (_path, { expected }) => expected });
    assert.deepEqual(automated.chapterReports.map(({ wordErrorRate }) => wordErrorRate), [0, 0]);
    assert.deepEqual(automated.findings, []);
    const flagged = await automatedListeningProof(fabrication, narrationLayer, { transcribe: async (_path, { expected }) => expected === "Repeated paragraph." ? "wrong" : expected });
    assert.deepEqual(flagged.findings.map(({ unitIds }) => unitIds), [["repeat-one"], ["repeat-two"]]);
    assert.equal(acceptAudiobookEdition(fabrication, automated).code, "INDEPENDENT_LISTENER_REQUIRED");
    const proof = { ...automated, automated: false, proofer: "independent listener", producer: "audiobook fabricator", automatedFirstPass: { chapterWordErrorRates: [0, 0] }, findings: [] };
    const acceptance = acceptAudiobookEdition(fabrication, proof, { now: "2026-09-27T00:00:00Z" });
    assert.equal(acceptance.status, "accepted");
    assert.equal(acceptance.artifacts.m4b.sha256, fabrication.artifacts.m4b.sha256);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
