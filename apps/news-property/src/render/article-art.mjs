/** Deterministic, reader-visible SVG art for an article without a supplied hero. */
import { sha256 } from "@red-cup-engineering/cryptographic-computer-data-engineering-services-section/hash";

function escapeXml(value) {
  return String(value)
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&apos;");
}

function linesFor(title) {
  const words = title.trim().split(/\s+/u).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > 23 && line) { lines.push(line); line = word; } else line = candidate;
  }
  if (line) lines.push(line);
  if (lines.length > 3) lines.splice(2, lines.length - 2, `${lines.slice(2).join(" ").slice(0, 21)}…`);
  return lines;
}

/**
 * Render an article's fallback artwork. Its geometry is seeded from the
 * editorial source digest, so it remains stable for the same article while
 * still giving every story a distinct image in the reader-facing publication.
 * @param {{title:string, sectionTitle?:string, sourceDigest?:string, propertyName?:string, palette?:{ink?:string,surface?:string,accent?:string}}} article
 * @returns {string}
 */
export function renderArticleArtSvg(article) {
  const palette = article.palette ?? {};
  const ink = palette.ink ?? "#121212";
  const surface = palette.surface ?? "#f4f1e8";
  const accent = palette.accent ?? "#d11a1a";
  const digest = sha256(article.sourceDigest ?? article.title);
  const planes = Array.from({ length: 14 }, (_, index) => {
    const x = 44 + (digest[index] % 10) * 108;
    const y = 112 + (digest[index + 14] % 4) * 76;
    const width = 44 + (digest[index + 7] % 5) * 46;
    const height = 30 + (digest[index + 21] % 4) * 34;
    const opacity = (0.16 + (digest[index + 3] % 45) / 100).toFixed(2);
    return `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${index % 4 === 0 ? accent : ink}" opacity="${opacity}"/>`;
  }).join("");
  const title = linesFor(article.title).map((line, index) =>
    `<tspan x="70" dy="${index === 0 ? 0 : 70}">${escapeXml(line)}</tspan>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 675" role="img" aria-labelledby="title description">
<title id="title">${escapeXml(article.title)}</title>
<desc id="description">A deterministic editorial illustration for ${escapeXml(article.propertyName ?? "this article")}.</desc>
<rect width="1200" height="675" fill="${surface}"/>
<path d="M60 58H1140M60 82H1140M60 593H1140M60 617H1140" stroke="${ink}" stroke-width="8"/>
${planes}
<text x="70" y="130" fill="${accent}" font-family="Arial, sans-serif" font-size="23" font-weight="800" letter-spacing="5">${escapeXml((article.sectionTitle ?? "NEWS").toUpperCase())}</text>
<text x="70" y="410" fill="${ink}" font-family="Georgia, serif" font-size="66" font-weight="700">${title}</text>
<text x="70" y="570" fill="${ink}" font-family="Arial, sans-serif" font-size="22" font-weight="800" letter-spacing="3">${escapeXml((article.propertyName ?? "").toUpperCase())}</text>
</svg>
`;
}
