import { test } from "node:test";
import assert from "node:assert/strict";
import { sha256Hex } from "@red-cup-engineering/cryptographic-computer-data-engineering-services-section/integrity";
import { mkdtemp, mkdir, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { composeOgCard, heroPromptFor, ensureArticleImages } from "../src/images.mjs";
import { renderArticleArtSvg } from "../src/render/article-art.mjs";
import { generateHeroImage } from "../scripts/generate-hero-image.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, "fixtures", "images");
const HERO_FIXTURE = path.join(FIXTURES, "hero-fixture.png");
const WORDMARK_FIXTURE = path.join(FIXTURES, "wordmark.svg");

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const PALETTE = {
  ink: "#1a1a1a",
  surface: "#f7f3e9",
  accent: "#b3272d",
};

function sha256(buffer) {
  return sha256Hex(buffer);
}

async function withTmpDir(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), "news-property-images-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function exists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

test("composeOgCard produces a 1200x630 PNG", async () => {
  await withTmpDir(async (dir) => {
    const out = path.join(dir, "card.png");
    const result = await composeOgCard({
      headline: "Council approves new river crossing after years of delay",
      kicker: "world",
      propertyName: "Koios.News",
      palette: PALETTE,
      out,
    });
    assert.equal(result.width, 1200);
    assert.equal(result.height, 630);
    const meta = await sharp(out).metadata();
    assert.equal(meta.width, 1200);
    assert.equal(meta.height, 630);
    assert.equal(meta.format, "png");
  });
});

test("composeOgCard is byte-deterministic across two runs with the same inputs", async () => {
  await withTmpDir(async (dir) => {
    const opts = {
      headline: "Council approves new river crossing after years of delay",
      kicker: "world",
      propertyName: "Koios.News",
      wordmarkSvg: WORDMARK_FIXTURE,
      palette: PALETTE,
      heroImagePath: HERO_FIXTURE,
    };
    const first = await composeOgCard({ ...opts, out: path.join(dir, "a.png") });
    const second = await composeOgCard({ ...opts, out: path.join(dir, "b.png") });
    const [bufA, bufB] = await Promise.all([readFile(first.path), readFile(second.path)]);
    assert.equal(sha256(bufA), sha256(bufB));
  });
});

test("composeOgCard composites a hero image as the background when given", async () => {
  await withTmpDir(async (dir) => {
    const withHero = await composeOgCard({
      headline: "Headline over a hero image",
      palette: PALETTE,
      heroImagePath: HERO_FIXTURE,
      out: path.join(dir, "with-hero.png"),
    });
    const withoutHero = await composeOgCard({
      headline: "Headline over a hero image",
      palette: PALETTE,
      out: path.join(dir, "without-hero.png"),
    });
    const [bufWith, bufWithout] = await Promise.all([readFile(withHero.path), readFile(withoutHero.path)]);
    assert.notEqual(sha256(bufWith), sha256(bufWithout));
  });
});

test("composeOgCard wraps a long headline at the fixed measure", async () => {
  await withTmpDir(async (dir) => {
    const out = path.join(dir, "long.png");
    const result = await composeOgCard({
      headline:
        "A very long headline that certainly runs past any single line's measure and must wrap across several lines of text",
      palette: PALETTE,
      out,
    });
    assert.equal(result.width, 1200);
    const meta = await sharp(out).metadata();
    assert.equal(meta.height, 630);
  });
});

test("composeOgCard requires headline and out", async () => {
  await assert.rejects(() => composeOgCard({ out: "/tmp/x.png" }), /requires headline/);
  await assert.rejects(() => composeOgCard({ headline: "x" }), /requires out/);
});

test("heroPromptFor builds a deterministic prompt from headline, section, and keywords", () => {
  const post = { headline: "Council approves new river crossing", section: "world", keywords: ["infrastructure", "council"] };
  const first = heroPromptFor(post);
  const second = heroPromptFor(post);
  assert.equal(first, second);
  assert.match(first, /Council approves new river crossing/);
  assert.match(first, /world news:/);
  assert.match(first, /infrastructure, council/);
  assert.match(first, /editorial illustration, muted cream and ink palette, one red accent, no text/);
});

test("heroPromptFor requires post.headline", () => {
  assert.throws(() => heroPromptFor({}), /requires post.headline/);
});

test("generateHeroImage with an injected fake provider writes the file and its provenance sidecar", async () => {
  await withTmpDir(async (dir) => {
    async function fakeProvider() {
      return { provider: "fake-provider", model: "fake-model", base64: TINY_PNG_BASE64, mimeType: "image/png" };
    }
    const out = path.join(dir, "hero.png");
    const result = await generateHeroImage({ prompt: "a prompt", out, provider: fakeProvider, targetWidth: 16 });

    assert.equal(result.refused, false);
    assert.equal(result.imagePath, out);
    assert.ok(await exists(out));
    assert.ok(await exists(result.provenancePath));

    const provenance = JSON.parse(await readFile(result.provenancePath, "utf8"));
    assert.equal(provenance.provider, "fake-provider");
    assert.equal(provenance.model, "fake-model");
    assert.equal(provenance.promptUsed, "a prompt");
    assert.equal(provenance.outputPath, out);
  });
});

test("generateHeroImage returns a typed refusal instead of throwing when credentials are missing", async () => {
  await withTmpDir(async (dir) => {
    async function missingCredentialProvider() {
      throw new Error("API_KEY_GOOGLE_GEMINI is not set in process.env");
    }
    const out = path.join(dir, "hero.png");
    const result = await generateHeroImage({ prompt: "a prompt", out, provider: missingCredentialProvider });

    assert.equal(result.refused, true);
    assert.match(result.reason, /API_KEY_GOOGLE_GEMINI is not set/);
    assert.equal(await exists(out), false);
  });
});

test("generateHeroImage requires prompt and out", async () => {
  await assert.rejects(() => generateHeroImage({ out: "/tmp/x.png" }), /requires prompt/);
  await assert.rejects(() => generateHeroImage({ prompt: "x" }), /requires out/);
});

test("ensureArticleImages generates only what is missing, then is idempotent on the second call", async () => {
  await withTmpDir(async (dir) => {
    let calls = 0;
    async function fakeGenerate({ out }) {
      calls += 1;
      await mkdir(path.dirname(out), { recursive: true });
      await sharp({ create: { width: 40, height: 30, channels: 3, background: "#3a5f3a" } })
        .png()
        .toFile(out);
      return { refused: false, imagePath: out };
    }

    const post = { slug: "council-approves-crossing", headline: "Council approves new river crossing", section: "world" };
    const property = { name: "Koios.News", images: { hero: "generate" }, theme: { palette: PALETTE } };

    const first = await ensureArticleImages({ post, contentRoot: dir, property, generate: fakeGenerate });
    assert.equal(calls, 1);
    assert.equal(first.image, path.join(dir, "assets", "images", "council-approves-crossing.png"));
    assert.equal(first.ogCard, path.join(dir, "assets", "og", "council-approves-crossing.png"));
    assert.ok(await exists(first.image));
    assert.ok(await exists(first.ogCard));

    const second = await ensureArticleImages({ post, contentRoot: dir, property, generate: fakeGenerate });
    assert.equal(calls, 1, "generate must not be called again once the hero image already exists");
    assert.deepEqual(second, first);
  });
});

test("ensureArticleImages with hero policy 'none' composes only the OG card", async () => {
  await withTmpDir(async (dir) => {
    const post = { slug: "no-hero-story", headline: "A story with no hero image policy", section: "opinion" };
    const property = { name: "Koios.News", images: { hero: "none" }, theme: { palette: PALETTE } };

    const result = await ensureArticleImages({ post, contentRoot: dir, property });
    assert.equal(result.image, null);
    assert.ok(await exists(result.ogCard));
    await assert.doesNotReject(() => access(path.join(dir, "assets", "og", "no-hero-story.png")));
    await assert.rejects(() => access(path.join(dir, "assets", "images", "no-hero-story.png")));
  });
});

test("ensureArticleImages requires a generate function when images.hero is 'generate'", async () => {
  await withTmpDir(async (dir) => {
    const post = { slug: "story", headline: "Headline", section: "world" };
    const property = { images: { hero: "generate" } };
    await assert.rejects(
      () => ensureArticleImages({ post, contentRoot: dir, property }),
      /requires a generate function/
    );
  });
});

test("fallback article art is deterministic SVG with the article title", () => {
  const input = { title: "The grid is changing", sectionTitle: "Technology", sourceDigest: "a".repeat(64), propertyName: "Koios.News" };
  const first = renderArticleArtSvg(input);
  assert.equal(first, renderArticleArtSvg(input));
  assert.match(first, /<svg/);
  assert.match(first, /The grid is changing/);
  assert.match(first, /TECHNOLOGY/);
});

test("ensureArticleImages requires post.slug and contentRoot", async () => {
  await assert.rejects(() => ensureArticleImages({ post: {}, contentRoot: "/tmp" }), /requires post.slug/);
  await assert.rejects(() => ensureArticleImages({ post: { slug: "x" } }), /requires contentRoot/);
});
