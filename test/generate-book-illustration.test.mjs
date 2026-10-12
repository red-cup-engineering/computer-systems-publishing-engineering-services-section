import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateBookIllustration } from "../scripts/generate-book-illustration.mjs";

test("generated book images prepend the bible's visual style and declare model provenance", async () => {
  const directory = mkdtempSync(join(tmpdir(), "book-image-"));
  try {
    const manifestPath = join(directory, "ebook.json");
    writeFileSync(join(directory, "story-bible.json"), JSON.stringify({ visualStyle: { palette: ["rust", "ice blue"], medium: "linocut", motifs: ["bridges"] } }));
    writeFileSync(manifestPath, JSON.stringify({ slug: "fixture", storyBible: "story-bible.json" }));
    let receivedPrompt;
    const result = await generateBookIllustration({ manifestPath, prompt: "June at the window", path: "art/june.png", alt: "June looks through a frosted window" }, {
      generate: async (prompt) => { receivedPrompt = prompt; return { buffer: Buffer.from("PNG fixture"), provider: "stub", model: "flux-stub", sourceWidthPx: 100, targetWidthPx: 200, upscaled: true, upscaleNote: null }; },
      now: () => "2026-09-27T12:00:00.000Z",
    });
    assert.match(receivedPrompt, /palette: rust, ice blue; medium: linocut; motifs: bridges/u);
    assert.ok(readFileSync(result.imagePath).length > 0);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    assert.equal(manifest.assets[0].provenance.model, "flux-stub");
    assert.equal(manifest.assets[0].alt, "June looks through a frosted window");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
