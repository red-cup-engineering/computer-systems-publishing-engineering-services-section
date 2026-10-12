/** @module images -- news-property image domain: OG card composition, hero prompts, per-article image custody. */

import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;
const HEADLINE_MEASURE_CHARS = 22;
const HEADLINE_FONT_SIZE = 64;
const HEADLINE_LINE_HEIGHT = 74;
const HEADLINE_MAX_LINES = 3;
const KICKER_FONT_SIZE = 26;
const FOOTER_FONT_SIZE = 24;
const MARGIN = 80;
const HOUSE_HERO_STYLE_SUFFIX =
  "editorial illustration, muted cream and ink palette, one red accent, no text";

/**
 * Check whether a path exists on disk.
 * @param {string} targetPath
 * @returns {Promise<boolean>}
 */
async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Escape text for safe inclusion inside SVG markup.
 * @param {string} text
 * @returns {string}
 */
function escapeXml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Greedy word wrap at a fixed character measure. Deterministic: same input
 * text and measure always produce the same lines.
 * @param {string} text
 * @param {number} maxChars
 * @param {number} [maxLines]
 * @returns {string[]}
 */
function wrapText(text, maxChars, maxLines = Infinity) {
  const words = String(text ?? "").trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1]}…`;
    return kept;
  }
  return lines;
}

/**
 * Build the deterministic text/scrim overlay SVG composited over the OG
 * card's base (a hero image or a flat palette-surface panel).
 * @param {{headline:string, kicker?:string, propertyName?:string, palette?:object, hasHero:boolean}} opts
 * @returns {string}
 */
function buildOverlaySvg({ headline, kicker, propertyName, palette, hasHero }) {
  const ink = palette?.ink ?? "#1a1a1a";
  const surface = palette?.surface ?? "#f7f3e9";
  const accent = palette?.accent ?? "#b3272d";
  const textColor = hasHero ? surface : ink;

  const lines = wrapText(headline, HEADLINE_MEASURE_CHARS, HEADLINE_MAX_LINES);
  const footerY = OG_HEIGHT - MARGIN / 2;
  const headlineBottom = footerY - 56;
  const headlineTop = headlineBottom - (lines.length - 1) * HEADLINE_LINE_HEIGHT;
  const tspans = lines
    .map((line, i) => `<tspan x="${MARGIN}" y="${headlineTop + i * HEADLINE_LINE_HEIGHT}">${escapeXml(line)}</tspan>`)
    .join("");

  const scrim = hasHero
    ? `<defs><linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
         <stop offset="0%" stop-color="#000000" stop-opacity="0"/>
         <stop offset="55%" stop-color="#000000" stop-opacity="0.35"/>
         <stop offset="100%" stop-color="#000000" stop-opacity="0.8"/>
       </linearGradient></defs>
       <rect x="0" y="0" width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="url(#scrim)"/>`
    : `<rect x="0" y="0" width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="${surface}"/>`;

  const kickerMarkup = kicker
    ? `<text x="${MARGIN}" y="${MARGIN - 12}" font-family="Georgia, 'Times New Roman', serif" font-size="${KICKER_FONT_SIZE}" font-weight="700" letter-spacing="4" fill="${accent}">${escapeXml(
        String(kicker).toUpperCase()
      )}</text>`
    : "";

  const footerMarkup = propertyName
    ? `<text x="${MARGIN}" y="${OG_HEIGHT - MARGIN / 2}" font-family="Georgia, 'Times New Roman', serif" font-size="${FOOTER_FONT_SIZE}" fill="${textColor}">${escapeXml(
        propertyName
      )}</text>`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">
${scrim}
${kickerMarkup}
<text font-family="Georgia, 'Times New Roman', serif" font-size="${HEADLINE_FONT_SIZE}" font-weight="700" fill="${textColor}">${tspans}</text>
${footerMarkup}
</svg>`;
}

/**
 * Compose a deterministic 1200x630 Open Graph card as a PNG: a headline
 * wrapped at a fixed measure, an optional kicker and property name, an
 * optional wordmark, over a hero image when given or a flat palette-surface
 * panel otherwise. Pure encoding -- no inference.
 * @param {{headline:string, kicker?:string, propertyName?:string, wordmarkSvg?:string, palette?:object, heroImagePath?:string, out:string}} opts
 * @returns {Promise<{path:string, width:number, height:number}>}
 * @throws {Error} when headline or out is missing
 */
export async function composeOgCard({ headline, kicker, propertyName, wordmarkSvg, palette, heroImagePath, out }) {
  if (!headline) throw new Error("composeOgCard requires headline");
  if (!out) throw new Error("composeOgCard requires out");

  const hasHero = Boolean(heroImagePath);
  const base = hasHero
    ? sharp(heroImagePath).resize(OG_WIDTH, OG_HEIGHT, { fit: "cover", position: "centre" })
    : sharp({
        create: {
          width: OG_WIDTH,
          height: OG_HEIGHT,
          channels: 3,
          background: palette?.surface ?? "#f7f3e9",
        },
      });

  const overlaySvg = buildOverlaySvg({ headline, kicker, propertyName, palette, hasHero });
  const layers = [{ input: Buffer.from(overlaySvg, "utf8"), top: 0, left: 0 }];

  if (wordmarkSvg) {
    try {
      const wordmarkPng = await sharp(wordmarkSvg).resize({ height: 40 }).png().toBuffer();
      const meta = await sharp(wordmarkPng).metadata();
      layers.push({ input: wordmarkPng, top: MARGIN / 2, left: OG_WIDTH - MARGIN - (meta.width ?? 0) });
    } catch {
      // wordmark is decorative; an unreadable path never blocks card composition
    }
  }

  await mkdir(path.dirname(out), { recursive: true });
  const buffer = await base
    .composite(layers)
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toBuffer();
  await writeFile(out, buffer);

  return { path: out, width: OG_WIDTH, height: OG_HEIGHT };
}

/**
 * Build a deterministic hero-image prompt from a post's headline, section,
 * and keywords, closed with the house editorial style suffix.
 * @param {{headline:string, section?:string, keywords?:string[]}} post
 * @returns {string}
 * @throws {Error} when post.headline is missing
 */
export function heroPromptFor(post) {
  if (!post?.headline) throw new Error("heroPromptFor requires post.headline");
  const sectionPrefix = post.section ? `${post.section} news: ` : "";
  const keywordSuffix =
    Array.isArray(post.keywords) && post.keywords.length ? `, ${post.keywords.join(", ")}` : "";
  return `${sectionPrefix}${post.headline}${keywordSuffix}. ${HOUSE_HERO_STYLE_SUFFIX}`;
}

/**
 * Ensure a post's hero and Open Graph images exist under the content root,
 * generating only what is missing (idempotent). The hero itself is
 * generated by the injected `generate` function -- keeps this module free
 * of any script-layer or network dependency, per import stratification.
 * @param {{post:{slug:string, headline:string, section?:string, keywords?:string[]}, contentRoot:string, property?:{name?:string, images?:{hero?:string}, theme?:{palette?:object, wordmarkSvg?:string}}, generate?:(opts:{prompt:string, out:string})=>Promise<{refused:boolean, reason?:string}>}} opts
 * @returns {Promise<{image:(string|null), ogCard:string}>}
 * @throws {Error} when post.slug or contentRoot is missing, or when images.hero is "generate" but no generate function was given
 */
export async function ensureArticleImages({ post, contentRoot, property, generate }) {
  if (!post?.slug) throw new Error("ensureArticleImages requires post.slug");
  if (!contentRoot) throw new Error("ensureArticleImages requires contentRoot");

  const imagePath = path.join(contentRoot, "assets", "images", `${post.slug}.png`);
  const ogCardPath = path.join(contentRoot, "assets", "og", `${post.slug}.png`);

  const heroPolicy = property?.images?.hero ?? "none";
  let heroReady = await pathExists(imagePath);

  if (heroPolicy === "generate" && !heroReady) {
    if (typeof generate !== "function") {
      throw new Error("ensureArticleImages requires a generate function when images.hero is 'generate'");
    }
    const result = await generate({ prompt: heroPromptFor(post), out: imagePath });
    heroReady = !result?.refused;
  }

  if (!(await pathExists(ogCardPath))) {
    await composeOgCard({
      headline: post.headline,
      kicker: post.section,
      propertyName: property?.name,
      wordmarkSvg: property?.theme?.wordmarkSvg,
      palette: property?.theme?.palette,
      heroImagePath: heroReady ? imagePath : undefined,
      out: ogCardPath,
    });
  }

  return { image: heroReady ? imagePath : null, ogCard: ogCardPath };
}
