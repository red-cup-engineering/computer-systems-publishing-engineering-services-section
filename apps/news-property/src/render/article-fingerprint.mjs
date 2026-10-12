/** One article record produces its inspectable facts and matching SVG/PNG marks. */
import { createHash } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";

const WIDTH = 1200;
const HEIGHT = 675;
const CELL = 40;
const TOP = 45;
const COLORS = ["#f4f1e8", "#ece7d8", "#121212", "#d11a1a", "#4f6d7a", "#d2b24c"];
const rgb = COLORS.map((color) => Buffer.from(color.slice(1), "hex"));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const stable = (value) => Array.isArray(value) ? value.map(stable)
  : value !== null && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]))
    : value;
const pattern = (bytes, col, row) => {
  const position = row * 30 + col;
  return (bytes[position % bytes.length] ^ bytes[(position * 13 + row) % bytes.length]) % COLORS.length;
};

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, checksum]);
}

function png(bytes) {
  const stride = WIDTH * 3;
  const raw = Buffer.alloc((stride + 1) * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    const offset = y * (stride + 1) + 1;
    for (let x = 0; x < WIDTH; x += 1) {
      const color = y < TOP || y >= TOP + 15 * CELL ? rgb[2]
        : rgb[pattern(bytes, Math.floor(x / CELL), Math.floor((y - TOP) / CELL))];
      color.copy(raw, offset + x * 3);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(WIDTH, 0);
  header.writeUInt32BE(HEIGHT, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

export function renderBrandPng(property) {
  return png(Buffer.from(sha256(`${property.name}\n${property.tagline ?? ""}`), "hex"));
}

function svg(bytes) {
  const cells = Array.from({ length: 15 * 30 }, (_, position) => {
    const col = position % 30;
    const row = Math.floor(position / 30);
    return `<rect x="${col * CELL}" y="${TOP + row * CELL}" width="${CELL}" height="${CELL}" fill="${COLORS[pattern(bytes, col, row)]}"/>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-labelledby="title desc">
<title id="title">Koios.News article fingerprint</title><desc id="desc">Article-specific geometric mark derived from the accompanying facts record.</desc>
<rect width="${WIDTH}" height="${HEIGHT}" fill="#121212"/>${cells}</svg>
`;
}

export function renderArticleFingerprint(post, property) {
  const facts = {
    kind: "producing-content.article-fingerprint.facts", slug: post.slug,
    url: new URL(`/posts/${post.slug}`, property.origin).href, headline: post.title,
    summary: post.description, datePublished: post.publishedAt ?? post.date,
    author: post.author, section: post.sectionTitle, keywords: post.keywords,
    tags: post.tags, references: post.referenceRecords.map((reference) => reference.url),
    ...(post.license ? { license: post.license } : {}),
    ...(post.licenseUrl ? { licenseUrl: post.licenseUrl } : {}),
    ...(post.syndicationRights ? { syndicationRights: post.syndicationRights } : {}),
    wordCount: post.body.trim().split(/\s+/u).length, bodySha256: sha256(post.body),
    sourceSha256: post.sourceDigest, correctionCount: post.corrections.length,
    correctionState: post.corrections.length ? "corrected" : "current",
  };
  const serialization = JSON.stringify(stable(facts));
  const hash = sha256(serialization);
  const base = `fingerprints/${post.slug}`;
  const carrier = { kind: "producing-content.article-fingerprint", facts, serialization, sha256: hash,
    encoding: { serialization: "producing-content.stable-json.v1", digest: "sha256",
      visible: "koios.digest-grid.v1", metadata: "none" },
    jsonUrl: `/${base}.json`, svgUrl: `/${base}.svg`, pngUrl: `/${base}.png` };
  const bytes = Buffer.from(hash, "hex");
  return new Map([[ `${base}.json`, `${JSON.stringify(carrier)}\n` ],
    [ `${base}.svg`, svg(bytes) ], [ `${base}.png`, png(bytes) ]]);
}
