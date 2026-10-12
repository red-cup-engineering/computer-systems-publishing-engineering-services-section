/**
 * `build`: a property record plus a content root produces `public/` — every
 * surface in the news-property specification §5, byte-deterministic, sealed
 * by a `manifest.json`. Generalizes the Koios.News static-delivery-current
 * carrier's parsing and sealing law
 * (`koios-news/static-delivery-current/src/publication.mjs`:
 * `parsePost`/`readPosts`/`safeWrite`/`stagedArtifacts`/manifest) to an
 * arbitrary property record rather than one hard-coded origin and section
 * set.
 */
import { sha256Hex } from "@red-cup-engineering/cryptographic-computer-data-engineering-services-section/integrity";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { buildTheme } from "./render/theme.mjs";
import { renderArticleArtSvg } from "./render/article-art.mjs";
import { renderArticleFingerprint, renderBrandPng } from "./render/article-fingerprint.mjs";
import { renderCoverage, renderNinjs, renderPublicationProvenance, renderSourceRoll } from "./render/public-records.mjs";
import { renderMarkdown, escapeHtml } from "./render/markdown.mjs";
import { faviconSvg, webManifest, absoluteUrl } from "./render/head.mjs";
import { renderRss, renderAtom, renderJsonFeed } from "./render/feeds.mjs";
import { renderSitemap, renderNewsSitemap, renderRobotsTxt, renderAdsTxt } from "./render/sitemaps.mjs";
import { buildSearchIndex, searchClientScript } from "./render/search-index.mjs";
import { shareClientScript } from "./render/share-client.mjs";
import { houseAdClientScript } from "./render/house-ad-client.mjs";
import { renderClaimArchive } from "./render/claim-archive.mjs";
import {
  renderHomePage, renderSectionPage, renderArticlePage, renderSyndicatedArticle, renderDeskPage, renderAuthorPage,
  renderTagPage, renderTopicPage, renderArchiveIndexPage, renderArchiveYearPage, renderArchiveMonthPage,
  renderMastheadPage, renderStaticPage, renderSearchPage, render404Page,
} from "./render/templates.mjs";
import { slugify } from "@red-cup-engineering/computer-text-content-engineering-services-section/slugify-text";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/u;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)?$/u;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const XML_INVALID_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const STRUCTURED_ARRAY_FIELDS = new Set(["claims", "omissions", "corrections"]);
const STRING_ARRAY_FIELDS = new Set(["categories", "tags", "keywords"]);
const PAGE_SIZE = 12;

const digest = (bytes) => sha256Hex(bytes);
const bytewise = (left, right) => Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));

function safeFeedText(value, file, field) {
  if (XML_INVALID_CONTROL.test(value)) throw new Error(`${file}: ${field} contains a control character not permitted in RSS or Atom`);
  return value;
}

/**
 * @param {string} raw
 * @param {string} key
 * @returns {string|boolean|null|string[]|object[]}
 */
function scalar(raw, key) {
  const value = raw.trim();
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null" || value === "~") return null;
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    if (value.startsWith('"')) { try { return JSON.parse(value); } catch { throw new Error(`invalid quoted scalar: ${value}`); } }
    return value.slice(1, -1).replace(/''/gu, "'");
  }
  if (value.startsWith("[") && value.endsWith("]")) {
    let decoded;
    try { decoded = JSON.parse(value); } catch { throw new Error(`only JSON arrays are supported: ${value}`); }
    if (!Array.isArray(decoded)) throw new Error(`only JSON arrays are supported: ${value}`);
    if (STRUCTURED_ARRAY_FIELDS.has(key)) {
      if (!decoded.every((item) => item !== null && typeof item === "object" && !Array.isArray(item))) {
        throw new Error(`${key} must be a JSON array of objects: ${value}`);
      }
      return decoded;
    }
    if (!decoded.every((item) => typeof item === "string")) throw new Error(`only JSON string arrays are supported: ${value}`);
    return decoded;
  }
  return value;
}

/**
 * Extract `id -> URL` from a front matter `references:` block (a CSL-JSON-ish
 * nested YAML list, as the Koios.News corpus writes it). Only the two fields
 * inline citations need are read; every other reference field is left to the
 * editorial pipeline that produced the front matter. Not a general YAML
 * parser — it reads exactly the two-space list, four-space field
 * indentation the corpus uses and ignores anything nested deeper.
 * @param {string[]} frontMatterLines the front-matter lines (between the `---` delimiters)
 * @returns {{urls:Map<string,string>,records:object[]}}
 */
function parseReferences(frontMatterLines) {
  const urls = new Map();
  const records = [];
  const start = frontMatterLines.findIndex((line) => /^references:\s*$/u.test(line));
  if (start === -1) return { urls, records };
  const unquote = (raw) => raw.trim().replace(/^"(.*)"$/u, "$1").replace(/^'(.*)'$/u, "$1");
  let current = {};
  const commit = () => {
    if (current.id && current.URL) {
      let parsed;
      try { parsed = new URL(current.URL); } catch { throw new Error(`invalid reference URL: ${current.URL}`); }
      if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error(`unsafe reference URL: ${current.URL}`);
      urls.set(current.id, parsed.toString());
      records.push({ id: current.id, url: parsed.toString(), title: current.title || parsed.hostname,
        type: current.type || "webpage", containerTitle: current["container-title"] || parsed.hostname });
    }
    current = {};
  };
  const setField = (key, raw) => {
    if (["id", "URL", "title", "type", "container-title"].includes(key)) current[key] = unquote(raw);
  };
  for (let index = start + 1; index < frontMatterLines.length; index += 1) {
    const line = frontMatterLines[index];
    if (line.trim() !== "" && !/^\s/u.test(line)) break;
    const item = /^\s{2}-\s+(.*)$/u.exec(line);
    if (item) {
      commit();
      const field = /^([A-Za-z0-9_-]+):\s*(.*)$/u.exec(item[1]);
      if (field) setField(field[1], field[2]);
      continue;
    }
    const field = /^\s{4}([A-Za-z0-9_-]+):\s*(.*)$/u.exec(line);
    if (field) setField(field[1], field[2]);
  }
  commit();
  return { urls, records };
}

function originalPermalink(frontMatterLines) {
  let inKoios = false;
  for (const line of frontMatterLines) {
    if (/^\S/u.test(line)) inKoios = /^koios:\s*$/u.test(line);
    else if (inKoios) {
      const match = /^  original_permalink:\s*(.*)$/u.exec(line);
      if (match) return scalar(match[1], "original_permalink");
    }
  }
  return undefined;
}

function articleAdUnit(frontMatterLines) {
  let inKoios = false;
  let inAdUnits = false;
  for (const line of frontMatterLines) {
    if (/^\S/u.test(line)) {
      inKoios = /^koios:\s*$/u.test(line);
      inAdUnits = false;
    } else if (inKoios && /^  \S/u.test(line)) {
      inAdUnits = /^  ad_units:\s*$/u.test(line);
    } else if (inAdUnits) {
      const match = /^    a_ads:\s*["']?(\d+)["']?\s*$/u.exec(line);
      if (match) return match[1];
    }
  }
  return undefined;
}

/**
 * Build a `renderMarkdown` `citation` option that turns `[@id]` markers into
 * numbered links against a post's parsed `references:` map, numbered in
 * order of first appearance within the article. A citation naming an id
 * absent from `references:` renders as an unresolved marker rather than a
 * dead link.
 * @param {Map<string,string>} references
 * @returns {(ids: string[], raw: string) => string}
 */
export function citationRenderer(references) {
  const numbering = new Map();
  let next = 1;
  return (ids) => ids.map((id) => {
    const href = references.get(id);
    if (href === undefined) return `<span class="citation citation--missing" title="unresolved citation: ${escapeHtml(id)}">[?]</span>`;
    if (!numbering.has(id)) { numbering.set(id, next); next += 1; }
    return `<a class="citation" href="${escapeHtml(href)}" title="${escapeHtml(id)}">[${numbering.get(id)}]</a>`;
  }).join("");
}

/**
 * A deliberately narrow front-matter codec for the fields the specification
 * names (§5): the public editorial fields plus the optional `claims`,
 * `omissions`, and `corrections` ledgers, given as single-line JSON arrays of
 * objects. Nested indented blocks (a `references:` or `koios:` block, say)
 * are not public-carrier input and are skipped, matching the retired Koios
 * carrier's codec.
 * @param {string} source raw file contents
 * @param {string} file file name, for error messages
 * @returns {object} a frozen, parsed post
 */
/**
 * The article prose the page renders under its own masthead. A Content Mill
 * manuscript carries its title and dek as its first blocks (the evidence law
 * binds those exact bytes), so the page omits them where the template already
 * renders the same title and dek; the body itself stays byte-exact.
 */
function articleProse(post) {
  const blocks = post.body.split(/\n{2,}/u);
  if (blocks[0]?.trim() !== `# ${post.title.trim()}`) return post.body;
  const masthead = [post.dek, post.description].filter((text) => typeof text === "string").map((text) => text.trim());
  return blocks.slice(masthead.includes(blocks[1]?.trim()) ? 2 : 1).join("\n\n");
}

/**
 * The standfirst the page shows under its headline: the dek, unless it restates the article's
 * opening paragraph, which the reader meets next. The dek stays the post's summary everywhere else.
 */
function standfirst(post, prose) {
  if (!post.dek) return undefined;
  const words = (text) => text.replace(/!?\[([^\]]*)\]\([^)]*\)/gu, "$1").replace(/[^\p{L}\p{N}]+/gu, " ").trim().toLowerCase();
  const dek = words(post.dek);
  const lede = words(prose.split(/\n{2,}/u).find((block) => block.trim() && !block.trimStart().startsWith("#")) ?? "");
  return dek && lede && (lede.startsWith(dek) || dek.startsWith(lede)) ? undefined : post.dek;
}

export function parsePost(source, file) {
  const lines = source.replace(/\r\n?/gu, "\n").split("\n");
  if (lines[0] !== "---") throw new Error(`${file}: missing opening front-matter delimiter`);
  const close = lines.indexOf("---", 1);
  if (close < 0) throw new Error(`${file}: missing closing front-matter delimiter`);
  const frontMatter = Object.create(null);
  for (const line of lines.slice(1, close)) {
    if (line.trim() === "" || /^\s/u.test(line)) continue;
    const match = /^([^:#][^:]*):(?:\s(.*))?$/u.exec(line);
    if (!match) throw new Error(`${file}: malformed front-matter line: ${line}`);
    const key = match[1].trim();
    if (Object.hasOwn(frontMatter, key)) throw new Error(`${file}: duplicate front-matter key ${key}`);
    frontMatter[key] = scalar(match[2] ?? "", key);
  }
  const body = lines.slice(close + 1).join("\n").trim();
  const stem = file.replace(/\.md$/u, "");
  const { title, date, draft } = frontMatter;
  const withdrawn = frontMatter.withdrawn ?? false;
  if (typeof withdrawn !== "boolean" || (withdrawn && !draft)) throw new Error(`${file}: withdrawn requires draft: true`);
  const slug = frontMatter.slug ?? stem;
  if (typeof title !== "string" || title.trim() === "") throw new Error(`${file}: title must be a non-empty string`);
  if (typeof date !== "string" || !ISO_DAY.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw new Error(`${file}: date must be YYYY-MM-DD`);
  const publishedAt = frontMatter.published_at;
  if (publishedAt !== undefined &&
      (typeof publishedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(publishedAt) ||
        !Number.isFinite(Date.parse(publishedAt)) || new Date(publishedAt).toISOString() !== publishedAt.replace(/Z$/u, ".000Z") ||
        !publishedAt.startsWith(`${date}T`))) {
    throw new Error(`${file}: published_at must be a real UTC instant on the article date (YYYY-MM-DDTHH:MM:SSZ)`);
  }
  if (typeof draft !== "boolean") throw new Error(`${file}: draft must be true or false`);
  if (typeof slug !== "string" || !SLUG.test(slug)) throw new Error(`${file}: slug must be lowercase URL-safe words`);
  if (slug !== stem) throw new Error(`${file}: slug must equal filename stem (${stem})`);
  if (body === "") throw new Error(`${file}: article body is empty`);
  if (frontMatter.section !== undefined && (typeof frontMatter.section !== "string" || frontMatter.section.trim() === "")) {
    throw new Error(`${file}: section must be a non-empty string when present`);
  }
  if (frontMatter.modified !== undefined && (typeof frontMatter.modified !== "string" || !ISO_INSTANT.test(frontMatter.modified))) {
    throw new Error(`${file}: modified must be an ISO 8601 date or instant`);
  }
  for (const field of ["description", "summary", "dek", "image", "imageAlt", "imageCredit"]) {
    if (frontMatter[field] !== undefined && typeof frontMatter[field] !== "string") throw new Error(`${file}: ${field} must be a string when present`);
  }
  const publicStrings = (field) => {
    const values = Array.isArray(frontMatter[field]) && STRING_ARRAY_FIELDS.has(field)
      ? [...new Set(frontMatter[field].map((value) => value.trim()).filter(Boolean))] : [];
    if (values.length > 64 || values.some((value) => value.length > 128 || /[\u0000-\u001f\u007f]/u.test(value))) throw new Error(`${file}: ${field} contains unsafe or excessive public metadata`);
    return values;
  };
  const publicScalar = (field) => typeof frontMatter[field] === "string" && frontMatter[field].trim() ? frontMatter[field].trim() : undefined;
  const claims = Array.isArray(frontMatter.claims) ? frontMatter.claims.map((claim, index) => {
    if (typeof claim.text !== "string" || claim.text.trim() === "") throw new Error(`${file}: claims[${index}].text must be a non-empty string`);
    return { text: claim.text.trim(), ...(typeof claim.source === "string" && claim.source.trim() ? { source: claim.source.trim() } : {}) };
  }) : [];
  const omissions = Array.isArray(frontMatter.omissions) ? frontMatter.omissions.map((omission, index) => {
    if (typeof omission.text !== "string" || omission.text.trim() === "") throw new Error(`${file}: omissions[${index}].text must be a non-empty string`);
    return { text: omission.text.trim() };
  }) : [];
  const corrections = Array.isArray(frontMatter.corrections) ? frontMatter.corrections.map((entry, index) => {
    if (typeof entry.date !== "string" || !ISO_DAY.test(entry.date)) throw new Error(`${file}: corrections[${index}].date must be YYYY-MM-DD`);
    if (typeof entry.note !== "string" || entry.note.trim() === "") throw new Error(`${file}: corrections[${index}].note must be a non-empty string`);
    return { date: entry.date, note: entry.note.trim() };
  }) : [];
  const keywords = publicStrings("keywords");
  const license = publicScalar("license");
  const licenseUrl = publicScalar("license_url");
  const syndicationRights = publicScalar("syndication_rights");
  if ((licenseUrl !== undefined || syndicationRights !== undefined) && license === undefined) throw new Error(`${file}: license_url and syndication_rights need a license value`);
  if (licenseUrl !== undefined) {
    let parsed;
    try { parsed = new URL(licenseUrl); } catch { throw new Error(`${file}: license_url must be an absolute HTTPS URL`); }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error(`${file}: license_url must be an absolute HTTPS URL without credentials`);
  }
  const publicTitle = safeFeedText(title.trim(), file, "title");
  const author = safeFeedText(publicScalar("author") ?? "Staff", file, "author");
  const description = safeFeedText((frontMatter.description ?? frontMatter.summary ?? body.split(/\n\s*\n/u)[0]).trim(), file, "description");
  const categories = publicStrings("categories");
  const { urls: references, records: referenceRecords } = parseReferences(lines.slice(1, close));
  return Object.freeze({
    file, title: publicTitle, date, publishedAt, draft, withdrawn, originalPermalink: originalPermalink(lines.slice(1, close)), slug, body, author, authorSlug: slugify(author),
    description, dek: publicScalar("dek"), section: publicScalar("section"), modified: publicScalar("modified"),
    image: publicScalar("image"), imageAlt: publicScalar("imageAlt"), imageCredit: publicScalar("imageCredit"),
    categories, tags: [...new Set([...publicStrings("tags"), ...keywords])], keywords, references, referenceRecords,
    claims: Object.freeze(claims), omissions: Object.freeze(omissions), corrections: Object.freeze(corrections),
    license, licenseUrl, syndicationRights, adUnit: articleAdUnit(lines.slice(1, close)), sourceDigest: digest(source),
  });
}

/**
 * The post sources a build reads: every `.md` under the content root's post directory, overlaid
 * by filename with the property's published-post ledger. The tracked corpus keeps each routine
 * post at its admitted `draft: true` bytes; the ledger holds the promoted projection that was
 * actually published, so the ledger wins. An absent ledger is an empty one: nothing published yet.
 * @param {string} contentDir
 * @param {string} postsDirectory
 * @param {string} [publishedPostsDir]
 * @returns {{name:string,source:string}[]}
 */
function postSources(contentDir, postsDirectory, publishedPostsDir) {
  const postsDir = resolve(contentDir, postsDirectory);
  const postsRelative = relative(resolve(contentDir), postsDir);
  if (postsRelative === ".." || postsRelative.startsWith(`..${sep}`)) throw new Error(`content posts directory escaped content root: ${postsDirectory}`);
  if (!existsSync(postsDir) || !statSync(postsDir).isDirectory()) throw new Error(`content posts directory does not exist: ${postsDir}`);
  const sources = new Map();
  const read = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".md")) sources.set(entry.name, readFileSync(join(directory, entry.name), "utf8"));
    }
  };
  read(postsDir);
  if (publishedPostsDir !== undefined && existsSync(publishedPostsDir)) {
    if (!statSync(publishedPostsDir).isDirectory()) throw new Error(`published posts ledger is not a directory: ${publishedPostsDir}`);
    read(publishedPostsDir);
  }
  return [...sources].sort(([left], [right]) => bytewise(left, right)).map(([name, source]) => ({ name, source }));
}

/**
 * Read and parse every published post under `contentDir/posts` (overlaid by the published-post
 * ledger, when the property declares one), sorted newest-first then by slug.
 * @param {string} contentDir
 * @param {Record<string,string>} [legacyPublishedSections] explicit custody
 * mapping for a corpus whose already-published articles predate `section:`.
 * @param {string} [postsDirectory="posts"] the post directory relative to
 * the content root. `.` supports an admitted, flat routine corpus.
 * @param {string} [defaultPublishedSection] an explicit section assigned by
 * a property to legacy published posts which predate section metadata.
 * @param {string} [publishedPostsDir] the property's published-post ledger.
 * @returns {object[]}
 */
export function readPosts(contentDir, legacyPublishedSections = {}, postsDirectory = "posts", defaultPublishedSection = undefined, publishedPostsDir = undefined) {
  const posts = postSources(contentDir, postsDirectory, publishedPostsDir).map(({ name, source }) => parsePost(source, name));
  const seen = new Set();
  for (const post of posts) { if (seen.has(post.slug)) throw new Error(`duplicate post slug: ${post.slug}`); seen.add(post.slug); }
  return Object.freeze(posts.filter((post) => !post.draft).map((post) => {
    const section = post.section ?? legacyPublishedSections[post.slug] ?? defaultPublishedSection;
    if (typeof section !== "string" || section.trim() === "") {
      throw new Error(`${post.file}: published post needs a section (add front matter or content.legacyPublishedSections)`);
    }
    return { ...post, section: section.trim() };
  }).sort((left, right) => bytewise(right.publishedAt ?? right.date, left.publishedAt ?? left.date) || bytewise(left.slug, right.slug)));
}

/**
 * Write bytes to a path guaranteed to stay inside `root`.
 * @param {string} root
 * @param {string} relativePath
 * @param {string|Buffer} bytes
 */
export function safeWrite(root, relativePath, bytes) {
  const path = resolve(root, relativePath);
  const rel = relative(root, path);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`)) throw new Error(`output path escaped build root: ${relativePath}`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
}

/**
 * Walk a built output directory, returning a sorted digest of every file.
 * @param {string} outputDir
 * @returns {{file:string,sha256:string,bytes:number}[]}
 */
export function stagedArtifacts(outputDir) {
  const artifacts = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => bytewise(left.name, right.name))) {
      const path = join(directory, entry.name);
      const file = relative(outputDir, path).split(sep).join("/");
      if (entry.isSymbolicLink()) throw new Error(`output must not contain symlinks: ${file}`);
      if (entry.isDirectory()) { visit(path); continue; }
      if (!entry.isFile()) throw new Error(`output contains unsupported entry: ${file}`);
      const bytes = readFileSync(path);
      artifacts.push({ file, sha256: digest(bytes), bytes: bytes.length });
    }
  };
  visit(outputDir);
  return artifacts.sort((left, right) => bytewise(left.file, right.file));
}

/**
 * Route path for a post's article page.
 * @param {object} post
 * @returns {string}
 */
const articlePath = (post) => `posts/${post.slug}/index.html`;

/**
 * Group posts by year and month for the archive.
 * @param {object[]} posts newest first
 * @returns {{year:string,count:number,months:{month:string,count:number,posts:object[]}[]}[]}
 */
function groupArchive(posts) {
  const years = new Map();
  for (const post of posts) {
    const [year, month] = post.date.split("-");
    const byMonth = years.get(year) ?? new Map();
    const entries = byMonth.get(month) ?? [];
    entries.push(post);
    byMonth.set(month, entries);
    years.set(year, byMonth);
  }
  return [...years.entries()]
    .map(([year, byMonth]) => {
      const months = [...byMonth.entries()]
        .map(([month, entries]) => ({ month, count: entries.length, posts: [...entries].sort((left, right) => bytewise(right.publishedAt ?? right.date, left.publishedAt ?? left.date) || bytewise(left.slug, right.slug)) }))
        .sort((left, right) => bytewise(right.month, left.month));
      return { year, count: months.reduce((sum, month) => sum + month.count, 0), months };
    })
    .sort((left, right) => bytewise(right.year, left.year));
}

/**
 * Group posts by a taxonomy field (`tags` or `categories`) into slugged
 * entries.
 * @param {object[]} posts
 * @param {"tags"|"categories"} field
 * @returns {{slug:string,title:string,posts:object[]}[]}
 */
function groupTaxonomy(posts, field) {
  const entries = new Map();
  for (const post of posts) {
    for (const title of post[field]) {
      const slug = slugify(title);
      if (slug === "") continue;
      const entry = entries.get(slug) ?? { slug, title, posts: [] };
      if (bytewise(title, entry.title) < 0) entry.title = title;
      entry.posts.push(post);
      entries.set(slug, entry);
    }
  }
  return [...entries.values()]
    .map((entry) => ({ ...entry, posts: [...entry.posts].sort((left, right) => bytewise(right.date, left.date) || bytewise(left.slug, right.slug)) }))
    .sort((left, right) => bytewise(left.slug, right.slug));
}

function publicPost(post, property) {
  return { slug: post.slug, title: post.title, url: absoluteUrl(property.origin, `/posts/${post.slug}`), published: post.publishedAt ?? post.date };
}

function groupBibliography(posts, property) {
  const domains = new Map();
  for (const post of posts) {
    for (const record of post.referenceRecords) {
      const domain = new URL(record.url).hostname.replace(/^www\./u, "");
      const references = domains.get(domain) ?? new Map();
      const entry = references.get(record.url) ?? {
        id: record.id, title: record.title, url: record.url, domain, type: record.type,
        sourceKind: "unknown", author: [], containerTitle: record.containerTitle, citedBy: [],
      };
      const citation = entry.citedBy.find((item) => item.slug === post.slug);
      if (citation) {
        if (!citation.citationIds.includes(record.id)) citation.citationIds.push(record.id);
      } else {
        entry.citedBy.push({ slug: post.slug, title: post.title,
          url: absoluteUrl(property.origin, `/posts/${post.slug}`), citationIds: [record.id] });
      }
      references.set(record.url, entry);
      domains.set(domain, references);
    }
  }
  return [...domains.entries()].sort(([left], [right]) => bytewise(left, right)).map(([domain, references]) => {
    const entries = [...references.values()].sort((left, right) => bytewise(left.url, right.url));
    return { kind: "producing-content.domain-bibliography", domain,
      url: absoluteUrl(property.origin, `/bibliography/${domain}`), sourceKind: "unknown",
      citationCount: entries.length,
      articleCount: new Set(entries.flatMap((entry) => entry.citedBy.map((item) => item.slug))).size,
      references: entries };
  });
}

function unavailableArticle(property, slug) {
  const url = escapeHtml(absoluteUrl(property.origin, `/posts/${slug}/`));
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, follow"><link rel="canonical" href="${url}">
<title>Article unavailable — ${escapeHtml(property.name)}</title></head>
<body><main><h1>Article unavailable</h1><p>This historical address previously served an article, but its source is currently marked as a draft. It is not part of the published ${escapeHtml(property.name)} corpus.</p>
<p>For a question about this page, visit <a href="/corrections/">Corrections</a>. <a href="/archive/">Browse published articles</a>.</p></main></body></html>`;
}

function cspOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error(`CSP provider must use credential-free HTTPS: ${value}`);
  return url.origin;
}

function assetHeaders(property) {
  const adOrigin = property.monetization?.houseAds?.server ? ` ${cspOrigin(property.monetization.houseAds.server)}` : "";
  const aadsOrigin = property.monetization?.aads ? " https://acceptable.a-ads.com" : "";
  return `/*
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'${adOrigin}; frame-src 'self'${aadsOrigin}; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
  Referrer-Policy: strict-origin-when-cross-origin
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
`;
}

/**
 * Resolve an article's Open Graph card: `/assets/og/<slug>.png` when the
 * content root's assets carry it, else the property's configured default,
 * else the article's hero image. Image files are never generated here — per
 * the specification's images section, that is a hero/OG-composition
 * responsibility elsewhere in the app.
 * @param {object} post
 * @param {object} property
 * @param {string} contentDir
 * @returns {string|undefined} absolute URL, or undefined when nothing is available
 */
function resolveOgImage(post, property, contentDir) {
  const perArticle = join(contentDir, "assets", "og", `${post.slug}.png`);
  if (existsSync(perArticle)) return absoluteUrl(property.origin, `/assets/og/${post.slug}.png`);
  if (property.images?.defaultOgImage) return absoluteUrl(property.origin, property.images.defaultOgImage);
  return absoluteUrl(property.origin, `/fingerprints/${post.slug}.png`);
}

/**
 * Build a property's complete site into `outputDir`.
 * @param {object} input
 * @param {object} input.property the property record (specification §3)
 * @param {string} input.contentDir the content root (`posts/`, optional `assets/`, optional `measure/most-read.json`)
 * @param {string} input.outputDir directory to write into; created if absent
 * @returns {{outputDir:string,publishedPostCount:number,manifestSha256:string}}
 */
/**
 * The inputs a property record declares, resolved against the directory that holds it. Every
 * builder of a property builds it from these, so one record defines one site: a build that drops a
 * declared input (its claim store, say) would publish a different site under the same origin.
 */
export function declaredPropertyInputs(property, propertyDir, { stateRoot } = {}) {
  const root = property?.content?.root;
  if (typeof root !== "string" || root.trim() === "") throw new TypeError("property.content.root is required");
  const published = property.content.publishedPosts;
  if (published !== undefined && (typeof published !== "string" || published.trim() === "" || isAbsolute(published) || published.split(/[\\/]/u).includes(".."))) {
    throw new TypeError("property.content.publishedPosts must be a path inside the property state root");
  }
  return Object.freeze({
    contentDir: resolve(propertyDir, root),
    ...(property.content.claimStore ? { claimStoreDir: resolve(propertyDir, property.content.claimStore) } : {}),
    ...(property.content.sourceFeeds ? { sourceFeedsPath: resolve(propertyDir, property.content.sourceFeeds) } : {}),
    ...(published ? { publishedPostsDir: resolve(stateRoot ?? propertyStateRoot(property), published) } : {}),
  });
}

/**
 * Where a property's operational state lives: the newsroom that publishes it keeps its published-post
 * ledger there, outside the tracked corpus. `NEWS_PROPERTY_STATE_ROOT` names it for a host that
 * keeps state elsewhere.
 */
export function propertyStateRoot(property, environment = process.env) {
  if (typeof environment.NEWS_PROPERTY_STATE_ROOT === "string" && environment.NEWS_PROPERTY_STATE_ROOT !== "") return resolve(environment.NEWS_PROPERTY_STATE_ROOT);
  if (typeof property?.name !== "string" || property.name.trim() === "" || /[\\/]/u.test(property.name)) throw new TypeError("property.name must name one state directory");
  return join(environment.XDG_STATE_HOME || join(homedir(), ".local", "state"), "561-group", "news-property", property.name);
}

export function buildProperty({ property, contentDir, outputDir, claimStoreDir, sourceFeedsPath, publishedPostsDir, asOf = new Date() }) {
  if (typeof property !== "object" || property === null) throw new TypeError("property is required");
  if (typeof contentDir !== "string" || typeof outputDir !== "string") throw new TypeError("contentDir and outputDir are required");
  const postsDirectory = property.content?.postsDirectory ?? "posts";
  const recordNamespace = property.records?.namespace ?? "news-property";
  if (typeof recordNamespace !== "string" || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u.test(recordNamespace)) throw new TypeError("property.records.namespace is invalid");
  const recordKind = (name) => `${recordNamespace}.${name}/v1`;
  const posts = readPosts(resolve(contentDir), property.content?.legacyPublishedSections, postsDirectory, property.content?.defaultPublishedSection, publishedPostsDir);
  const sections = new Map((property.sections ?? []).map((section) => [section.slug, section]));
  const enriched = posts.map((post) => {
    const section = sections.get(post.section);
    if (section === undefined) throw new Error(`${post.file}: unknown section "${post.section}"`);
    const image = post.image ?? `/assets/article-art/${post.slug}.svg`;
    return {
      ...post,
      image,
      imageAlt: post.imageAlt ?? `Illustration for ${post.title}`,
      sectionTitle: section.title,
      ogImage: resolveOgImage({ ...post, image }, property, contentDir),
    };
  });

  const theme = buildTheme(property.theme);
  const files = new Map();
  const set = (path, contents) => files.set(path, contents);
  const aliasPaths = new Set();
  const redirects = new Map();
  const setAlias = (path, canonical) => {
    if (files.has(path)) throw new Error(`historical address conflicts with a canonical page: ${path}`);
    const source = `/${path.replace(/index\.html$/u, "")}`;
    const target = canonical.endsWith("/") ? canonical : `${canonical}/`;
    for (const address of [source, source.slice(0, -1)]) {
      if (redirects.has(address) && redirects.get(address) !== target) throw new Error(`historical address has conflicting targets: ${address}`);
      redirects.set(address, target);
    }
  };
  const setJson = (path, value) => set(path, `${JSON.stringify(value, null, 2)}\n`);
  set("_headers", assetHeaders(property));
  const indexNowKey = property.distribution?.indexNow?.key;
  if (indexNowKey != null) {
    if (typeof indexNowKey !== "string" || !/^[A-Za-z0-9-]{8,128}$/u.test(indexNowKey)) {
      throw new Error("distribution.indexNow.key must be 8–128 letters, digits, or hyphens");
    }
    set(`${indexNowKey}.txt`, indexNowKey);
  }
  const adVerification = property.monetization?.aads?.verification;
  if (adVerification) {
    if (!SLUG.test(adVerification.slug) || !enriched.some((post) => post.slug === adVerification.slug)) {
      throw new Error("A-Ads verification article must be published");
    }
  }

  if (claimStoreDir) {
    if (!existsSync(claimStoreDir) || !statSync(claimStoreDir).isDirectory()) throw new Error(`claim store directory does not exist: ${claimStoreDir}`);
    const records = [];
    for (const category of readdirSync(claimStoreDir, { withFileTypes: true }).filter((entry) => entry.isDirectory() && SLUG.test(entry.name)).sort((a, b) => bytewise(a.name, b.name))) {
      for (const entry of readdirSync(join(claimStoreDir, category.name), { withFileTypes: true }).filter((item) => item.isFile() && item.name.endsWith(".json")).sort((a, b) => bytewise(a.name, b.name))) {
        const slug = entry.name.slice(0, -5);
        if (!SLUG.test(slug)) throw new Error(`invalid claim store slug: ${category.name}/${entry.name}`);
        const bytes = readFileSync(join(claimStoreDir, category.name, entry.name));
        const record = JSON.parse(bytes.toString("utf8"));
        if (record.subject !== slug || !Array.isArray(record.claims)) throw new Error(`invalid claim store record: ${category.name}/${entry.name}`);
        records.push({ category: category.name, slug, bytes, record });
      }
    }
    for (const [path, contents] of renderClaimArchive(property, records, enriched)) set(path, contents);
  }

  set("assets/site.css", theme.css);
  set("assets/search.js", searchClientScript());
  set("assets/share.js", shareClientScript());
  if (property.monetization?.houseAds?.server) set("assets/house-ad.js", houseAdClientScript());
  set("favicon.svg", faviconSvg(property.name, theme.seeds.accent, theme.seeds.ink));
  set("og.png", renderBrandPng(property));
  set("manifest.webmanifest", `${JSON.stringify(webManifest({ name: property.name, accent: theme.seeds.accent, surface: theme.seeds.surface }), null, 2)}\n`);
  for (const post of enriched) {
    if (post.image === `/assets/article-art/${post.slug}.svg`) {
      set(`assets/article-art/${post.slug}.svg`, renderArticleArtSvg({
        title: post.title,
        sectionTitle: post.sectionTitle,
        sourceDigest: post.sourceDigest,
        propertyName: property.name,
        palette: theme.seeds,
      }));
    }
    for (const [path, contents] of renderArticleFingerprint(post, property)) set(path, contents);
  }
  set("coverage.json", renderCoverage(enriched, property));
  set("ninjs.json", renderNinjs(enriched, property, citationRenderer));
  set("publication-provenance.json", renderPublicationProvenance(enriched, contentDir, property));
  for (const [path, contents] of renderSourceRoll(property, sourceFeedsPath, renderStaticPage)) set(path, contents);

  set("index.html", renderHomePage({ property, posts: enriched, mostRead: readMostRead(contentDir, enriched), asOf }));

  const bySection = new Map();
  for (const post of enriched) {
    if (!bySection.has(post.section)) bySection.set(post.section, []);
    bySection.get(post.section).push(post);
  }
  for (const section of property.sections ?? []) {
    const sectionPosts = bySection.get(section.slug) ?? [];
    const totalPages = Math.max(1, Math.ceil(sectionPosts.length / PAGE_SIZE));
    for (let page = 1; page <= totalPages; page += 1) {
      const path = page === 1 ? `sections/${section.slug}/index.html` : `sections/${section.slug}/page/${page}/index.html`;
      set(path, renderSectionPage({ property, section, posts: sectionPosts, page }));
    }
  }

  const feedPosts = [];
  for (const post of enriched) {
    const prose = articleProse(post);
    const rendered = renderMarkdown(prose, { citation: citationRenderer(post.references), baseUrl: absoluteUrl(property.origin, `/posts/${post.slug}/`) });
    const renderedPost = { ...post, dek: standfirst(post, prose), bodyHtml: rendered };
    feedPosts.push({ ...feedPost(post), contentHtml: renderSyndicatedArticle(property, renderedPost) });
    set(articlePath(post), renderArticlePage({ property, post: renderedPost, allPosts: enriched }));
    if (post.slug === adVerification?.slug) {
      const verificationPath = `posts/${post.slug}.html`;
      set(verificationPath, renderArticlePage({ property, post: renderedPost, allPosts: enriched, noindex: true }));
      aliasPaths.add(verificationPath);
    }
    const [year, month, day] = post.date.split("-");
    for (const historicalSlug of new Set([post.slug, slugify(post.title), slugify(post.title.replace(/['’]/gu, ""))])) {
      if (!historicalSlug) continue;
      const historicalPath = `${year}/${month}/${day}/${historicalSlug}/index.html`;
      if (post.slug === adVerification?.slug && historicalSlug === post.slug) {
        set(historicalPath, renderArticlePage({ property, post: renderedPost, allPosts: enriched,
          verificationArticleUnit: adVerification.historicalArticleUnit }));
        aliasPaths.add(historicalPath);
      } else {
        setAlias(historicalPath, `/posts/${post.slug}`);
      }
    }
  }

  for (const section of property.sections ?? []) {
    set(`desks/${section.slug}/index.html`, renderDeskPage(property, section, bySection.get(section.slug) ?? []));
  }
  setJson("desks.json", { kind: recordKind("public-desks"), deskCount: (property.sections ?? []).length,
    desks: (property.sections ?? []).map((section) => ({ slug: section.slug, title: section.title,
      description: section.description ?? "", url: absoluteUrl(property.origin, `/sections/${section.slug}/`),
      publishedPostCount: (bySection.get(section.slug) ?? []).length })) });
  set("desks/index.html", renderStaticPage(property, "Desks", "/desks/",
    `<ul>${(property.sections ?? []).map((section) =>
      `<li><a href="/sections/${section.slug}/">${escapeHtml(section.title)}</a> (${(bySection.get(section.slug) ?? []).length} articles)</li>`).join("")}</ul>`));

  for (const [slug, target] of Object.entries(property.content?.historicalAuthorRoutes ?? {})) {
    if (!SLUG.test(slug) || !/^\/(?:about|masthead|standards|corrections|desks\/[a-z0-9-]+)\/$/u.test(target)) {
      throw new Error(`invalid historical author route: ${slug}`);
    }
    setAlias(`authors/${slug}/index.html`, target);
  }
  const authorSlugs = new Set(enriched.map((post) => post.authorSlug));
  for (const authorSlug of authorSlugs) {
    const name = enriched.find((post) => post.authorSlug === authorSlug)?.author ?? authorSlug;
    const record = { slug: authorSlug, name, bio: property.masthead?.bylineDescriptions?.[authorSlug] ??
      (name.startsWith(`${property.name} `) && name.endsWith(" Desk") ? "A coverage desk byline, not an individual employee. See the masthead for our publishing method." : "") };
    const authorPosts = enriched.filter((post) => post.authorSlug === authorSlug);
    set(`authors/${authorSlug}/index.html`, renderAuthorPage(property, record, authorPosts));
  }

  const tags = groupTaxonomy(enriched, "tags");
  for (const tag of tags) {
    set(`tags/${tag.slug}/index.html`, renderTagPage(property, tag, tag.posts));
    setJson(`tags/${tag.slug}.json`, { kind: recordKind("static-tag"), slug: tag.slug, title: tag.title,
      url: absoluteUrl(property.origin, `/tags/${tag.slug}`), posts: tag.posts.map((post) => publicPost(post, property)) });
    setAlias(`tag/${tag.slug}/index.html`, `/tags/${tag.slug}`);
  }
  setJson("tags.json", { kind: recordKind("static-tag-index"), items: tags.map((tag) => ({
    slug: tag.slug, title: tag.title, count: tag.posts.length,
    url: absoluteUrl(property.origin, `/tags/${tag.slug}`), latestPublished: tag.posts[0]?.date,
  })) });
  set("tags/index.html", renderStaticPage(property, "Tags", "/tags/",
    `<ul>${tags.map((tag) => `<li><a href="/tags/${tag.slug}/">${escapeHtml(tag.title)}</a> (${tag.posts.length})</li>`).join("")}</ul>`));
  const topics = groupTaxonomy(enriched, "categories");
  for (const topic of topics) {
    set(`topics/${topic.slug}/index.html`, renderTopicPage(property, topic, topic.posts));
    setJson(`topics/${topic.slug}.json`, { kind: recordKind("static-topic"), slug: topic.slug, title: topic.title,
      url: absoluteUrl(property.origin, `/topics/${topic.slug}`), posts: topic.posts.map((post) => publicPost(post, property)) });
    setAlias(`category/${topic.slug}/index.html`, `/topics/${topic.slug}`);
  }
  for (const historicalSlug of property.content?.legacyCategorySlugs ?? []) {
    if (!SLUG.test(historicalSlug)) throw new Error(`invalid historical category: ${historicalSlug}`);
    setAlias(`category/${historicalSlug}/index.html`, "/topics/");
  }
  setJson("topics.json", { kind: recordKind("static-topic-index"), items: topics.map((topic) => ({
    slug: topic.slug, title: topic.title, count: topic.posts.length,
    url: absoluteUrl(property.origin, `/topics/${topic.slug}`), latestPublished: topic.posts[0]?.date,
  })) });
  set("topics/index.html", renderStaticPage(property, "Topics", "/topics/",
    `<ul>${topics.map((topic) => `<li><a href="/topics/${topic.slug}/">${escapeHtml(topic.title)}</a> (${topic.posts.length})</li>`).join("")}</ul>`));

  // Former public articles that are now drafts retain an honest, noindex notice.
  // The content file owns its historical URL and withdrawal state; no parallel registry is needed.
  for (const entry of postSources(contentDir, postsDirectory, publishedPostsDir)) {
    const draft = parsePost(entry.source, entry.name);
    if (!draft.draft || !(draft.withdrawn || draft.originalPermalink)) continue;
    const slug = draft.slug;
    set(`posts/${slug}/index.html`, unavailableArticle(property, slug));
    aliasPaths.add(`posts/${slug}/index.html`);
    if (draft.originalPermalink) {
      const former = new URL(draft.originalPermalink);
      if (former.origin !== new URL(property.origin).origin || !/^\/\d{4}\/\d{2}\/\d{2}\/[a-z0-9-]+\/$/u.test(former.pathname) || former.search || former.hash) {
        throw new Error(`${entry.name}: original_permalink must be a dated article URL on ${property.origin}`);
      }
      setAlias(`${former.pathname.slice(1)}index.html`, `/posts/${slug}`);
    }
    // Only the two previously recorded withdrawals had public taxonomy routes.
    if (!draft.withdrawn) continue;
    for (const title of draft.tags) {
      const tag = slugify(title);
      if (!tag || tags.some((entry) => entry.slug === tag)) continue;
      const page = `tags/${tag}/index.html`;
      if (!files.has(page)) setAlias(page, "/tags/");
      setJson(`tags/${tag}.json`, { kind: recordKind("static-tag"), slug: tag, title,
        url: absoluteUrl(property.origin, `/tags/${tag}`), posts: [] });
    }
    for (const title of draft.categories) {
      const topic = slugify(title);
      if (!topic || topics.some((entry) => entry.slug === topic)) continue;
      const page = `topics/${topic}/index.html`;
      if (!files.has(page)) setAlias(page, "/topics/");
      setJson(`topics/${topic}.json`, { kind: recordKind("static-topic"), slug: topic, title,
        url: absoluteUrl(property.origin, `/topics/${topic}`), posts: [] });
    }
  }

  const bibliography = groupBibliography(enriched, property);
  setJson("bibliography.json", { kind: "producing-content.site-bibliography",
    count: bibliography.reduce((sum, domain) => sum + domain.citationCount, 0),
    domainCount: bibliography.length, domains: bibliography });
  set("bibliography/index.html", renderStaticPage(property, "Sources", "/bibliography/",
    `<p>Sources cited by published ${escapeHtml(property.name)} articles.</p><ul>${bibliography.map((entry) =>
      `<li><a href="/bibliography/${escapeHtml(entry.domain)}/">${escapeHtml(entry.domain)}</a> (${entry.citationCount})</li>`).join("")}</ul>`));
  for (const entry of bibliography) {
    setJson(`bibliography/${entry.domain}.json`, entry);
    set(`bibliography/${entry.domain}/index.html`, renderStaticPage(property, entry.domain,
      `/bibliography/${entry.domain}/`,
      `<p>${entry.citationCount} cited sources across ${entry.articleCount} articles.</p><ul>${entry.references.map((reference) =>
        `<li><a href="${escapeHtml(reference.url)}">${escapeHtml(reference.title)}</a> · cited in ${reference.citedBy.map((article) =>
          `<a href="/posts/${article.slug}/">${escapeHtml(article.title)}</a>`).join(", ")}</li>`).join("")}</ul>`));
  }

  const archive = groupArchive(enriched);
  setJson("archive.json", { kind: recordKind("static-archive"), years: archive.map((year) => ({
    year: year.year, months: year.months.map((month) => ({
      month: month.month, posts: month.posts.map((post) => publicPost(post, property)),
    })),
  })) });
  set("archive/index.html", renderArchiveIndexPage(property, archive.map((year) => ({ year: year.year, count: year.count }))));
  for (const year of archive) {
    set(`archive/${year.year}/index.html`, renderArchiveYearPage(property, year.year, year.months.flatMap((month) => month.posts)));
    for (const month of year.months) set(`archive/${year.year}/${month.month}/index.html`, renderArchiveMonthPage(property, year.year, month.month, month.posts));
  }

  set("masthead/index.html", renderMastheadPage(property));
  set("standards/index.html", renderStaticPage(property, "Standards", "/standards/",
    "<p>We report from named sources and link the underlying documents when available. We distinguish what a source says from what the evidence establishes and identify analysis as analysis.</p><p>Software assists research, drafting, and publication. A cited source is evidence for a claim, not an endorsement of every conclusion in an article. We correct material errors on the affected article and in the public corrections register.</p>"));
  set("corrections/index.html", renderStaticPage(property, "Corrections", "/corrections/",
    `<p>Material corrections are recorded with the affected article. Each correction names its date and what changed.</p><p><a href="/corrections.json">Read the public corrections register</a>.</p>`));
  const corrections = enriched.flatMap((post) => post.corrections.map((entry) => ({
    article: publicPost(post, property), date: entry.date, note: entry.note,
  })));
  setJson("corrections.json", { kind: "producing-content.correction-register",
    correctionCount: corrections.length, articleCount: new Set(corrections.map((entry) => entry.article.slug)).size,
    policy: "Material corrections are recorded in the article and this public register.",
    corrections, constraint: "Generated from published article frontmatter; an empty register is not proof no error exists." });
  setJson("standards.json", { kind: "producing-content.editorial-standards", publication: property.name,
    publicAuditUrl: absoluteUrl(property.origin, "/newswire-audit.json"), publicArticleCount: enriched.length,
    policies: ["Attribute factual claims to named sources.", "Distinguish source claims from independently verified reporting.",
      "Record material corrections on the article and in the public register."] });
  set("about/index.html", renderStaticPage(property, "About", "/about/",
    `<p>${property.name} is a news publication of ${escapeHtml(property.masthead.publisher)}.</p><p>${escapeHtml(property.masthead.editorialMethod)}</p><p>The publication carries advertising and offers a paid briefing. See ${property.monetization?.aads?.units?.length ? '<a href="/advertise/">how to advertise</a>, ' : ''}our <a href="/standards/">editorial standards</a>, <a href="/corrections/">corrections</a>, and <a href="/masthead/">coverage desks</a>.</p>`));
  if (property.monetization?.aads?.units?.length) {
    const units = property.monetization.aads.units;
    const unitList = units.map((unit) => `<li><a href="https://aads.com/ad_units/${encodeURIComponent(unit)}">AADS unit ${escapeHtml(unit)}</a></li>`).join("");
    set("advertise/index.html", renderStaticPage(property, `Advertise on ${property.name}`, "/advertise/",
      `<p>${escapeHtml(property.name)} carries advertising alongside its articles. Advertisers can buy placement through <a href="https://aads.com/">AADS</a>; ${escapeHtml(property.name)} does not take payment for these units directly.</p>` +
      `<p>To target this publication, create an AADS campaign and add these ad units under Campaign → Targeting → Add Ad Units:</p><ul>${unitList}</ul>` +
      `<p>The units appear at the top and bottom of pages and within articles. Placement and delivery depend on AADS campaign settings and available impressions. <a href="https://help.aads.com/en/article/how-to-adjust-campaign-targeting-1f1uxah/">AADS explains campaign targeting</a>.</p>` +
      `<p>Advertising does not buy editorial coverage. Our <a href="/standards/">editorial standards</a> and <a href="/corrections/">corrections policy</a> apply independently of advertisers.</p>`));
  }
  set("privacy/index.html", renderStaticPage(property, "Privacy", "/privacy/",
    `<p>This site does not build reader profiles or store reader identifiers for advertising.</p>${property.monetization?.aads ?
      `<p>Visible advertising placements load frames from A-Ads. That provider receives a request when a reader loads the frame; ${escapeHtml(property.name)} receives aggregate performance reports, not person-level ad data.</p>` : ""}`));

  set("search/index.html", renderSearchPage(property));
  set("search.json", `${JSON.stringify(buildSearchIndex(enriched), null, 2)}\n`);

  set("404.html", render404Page(property));

  set("feed.xml", renderRss(feedPosts, property));
  set("feed.atom", renderAtom(feedPosts, property));
  set("feed.json", renderJsonFeed(feedPosts, property));
  const channels = [
    { kind: "rss", title: "RSS", href: absoluteUrl(property.origin, "/feed.xml"), mediaType: "application/rss+xml" },
    { kind: "atom", title: "Atom", href: absoluteUrl(property.origin, "/feed.atom"), mediaType: "application/atom+xml" },
    { kind: "json-feed", title: "JSON Feed", href: absoluteUrl(property.origin, "/feed.json"), mediaType: "application/feed+json" },
  ];
  setJson("circulating.json", { kind: "producing-content.circulation-reading", channels, identifierPolicy: "none" });
  setJson("syndicating.json", { kind: "producing-content.syndication-reading",
    surfaces: [
      ...channels.map((channel) => ({ kind: "feed", href: channel.href, mediaType: channel.mediaType })),
      ...["sitemap.xml", "news-sitemap.xml"].map((path) => ({
        kind: "sitemap", href: absoluteUrl(property.origin, `/${path}`), mediaType: "application/xml" })),
      ...["topics.json", "tags.json", "archive.json", "bibliography.json", "desks.json", "corrections.json"].map((path) => ({
        kind: "record", href: absoluteUrl(property.origin, `/${path}`), mediaType: "application/json" })),
    ] });
  setJson("operations.json", { kind: recordKind("static-operations"),
    provenance: { carrier: "@red-cup-engineering/news-property", canonicalOrigin: property.origin,
      operationsInput: null, generatedAt: "deterministic-from-input" },
    publicPostCount: enriched.length, newestPublished: enriched[0]?.publishedAt ?? enriched[0]?.date ?? null,
    status: "generated-without-operations-input" });
  set("operations/index.html", renderStaticPage(property, "Publication operations", "/operations/",
    `<p>${enriched.length} published articles in this build. Most recent article: ${escapeHtml(enriched[0]?.date ?? "none")}.</p><p>This static build does not attest that automated publishing is running.</p>`));
  set("newswire-audit.json", `${JSON.stringify({
    kind: recordKind("static-editorial-audit"), generatedFrom: "front-matter-only",
    provenance: { carrier: "@red-cup-engineering/news-property", canonicalOrigin: property.origin,
      inputOrder: "publication instant or date descending then slug", generatedAt: "deterministic-from-input" },
    posts: enriched.map((post) => ({ slug: post.slug, url: absoluteUrl(property.origin, `/posts/${post.slug}`),
      published: post.publishedAt ?? post.date, sourceSha256: post.sourceDigest, status: "published-front-matter-draft-false", categories: post.categories })),
  }, null, 2)}\n`);

  const dated = (path, date) => ({
    path: `/${path === "index.html" ? "" : path.replace(/index\.html$/u, "")}`,
    ...(date ? { lastmod: date } : {}),
  });
  const claimRecordPage = (path) => /^claims\/[^/]+\/[^/]+\/index\.html$/u.test(path);
  const sitemapEntries = [...files.keys()]
    .filter((path) => path.endsWith(".html") && path !== "404.html" && !aliasPaths.has(path) && !claimRecordPage(path))
    .map((path) => {
      const post = enriched.find((candidate) => articlePath(candidate) === path);
      return dated(path, post?.modified ?? post?.publishedAt ?? post?.date);
    });
  set("sitemap.xml", renderSitemap(sitemapEntries, property));
  set("news-sitemap.xml", renderNewsSitemap(enriched, property, asOf));
  set("robots.txt", renderRobotsTxt(property));
  const adsTxt = renderAdsTxt(property);
  if (adsTxt !== undefined) set("ads.txt", adsTxt);
  if (redirects.size > 2_000) throw new Error("historical addresses exceed the static redirect limit");
  if (redirects.size) set("_redirects", `${[...redirects].sort(([left], [right]) => bytewise(left, right))
    .map(([source, target]) => `${source} ${target} 301`).join("\n")}\n`);

  if (existsSync(outputDir)) throw new Error(`output directory already exists: ${outputDir}. Remove it before building, or choose a fresh directory.`);
  for (const [path, contents] of [...files].sort(([left], [right]) => bytewise(left, right))) safeWrite(outputDir, path, contents);

  const artifacts = stagedArtifacts(outputDir);
  const articleTitles = new Map(enriched.map((post) => [
    absoluteUrl(property.origin, `/posts/${post.slug}/`), post.title,
  ]));
  const routes = [...new Set(sitemapEntries.map((entry) => absoluteUrl(property.origin, entry.path === "" ? "/" : entry.path)))]
    .map((absolute) => {
      const relPath = absolute.slice(property.origin.length) || "/";
      const file = relPath === "/" ? "index.html" : `${relPath.replace(/^\//u, "").replace(/\/$/u, "")}/index.html`;
      const artifact = artifacts.find((entry) => entry.file === file);
      return { url: absolute, hash: artifact ? artifact.sha256 : null,
        ...(articleTitles.has(absolute) ? { title: articleTitles.get(absolute) } : {}) };
    });
  const manifest = {
    kind: "news-property.build-manifest/v1",
    provenance: { generator: "@red-cup-engineering/news-property", origin: property.origin },
    publishedPostCount: enriched.length,
    routes,
    artifacts,
  };
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  safeWrite(outputDir, "manifest.json", manifestText);
  return Object.freeze({ outputDir: resolve(outputDir), publishedPostCount: enriched.length, manifestSha256: digest(manifestText) });
}

/**
 * Shape a post for `render/feeds.mjs`.
 * @param {object} post
 * @returns {import("./render/feeds.mjs").FeedPost}
 */
function feedPost(post) {
  return {
    slug: post.slug, title: post.title, description: post.description, author: post.author,
    date: post.publishedAt ?? `${post.date}T00:00:00Z`, categories: [...post.categories, ...post.tags], image: post.ogImage,
    ...(post.modified ? { modified: post.modified.includes("T") ? post.modified : `${post.modified}T00:00:00Z` } : {}),
  };
}

/**
 * Read the optional `measure/most-read.json` readout and resolve it against
 * the built posts, dropping entries that no longer name a published slug.
 * @param {string} contentDir
 * @param {object[]} posts
 * @returns {{slug:string,views:number}[]|undefined}
 */
function readMostRead(contentDir, posts) {
  const path = join(contentDir, "measure", "most-read.json");
  if (!existsSync(path)) return undefined;
  let parsed;
  try { parsed = JSON.parse(readFileSync(path, "utf8")); } catch { throw new Error(`measure/most-read.json is not valid JSON: ${path}`); }
  const known = new Set(posts.map((post) => post.slug));
  const items = Array.isArray(parsed?.items) ? parsed.items : [];
  return items.filter((item) => item && typeof item.slug === "string" && known.has(item.slug));
}
