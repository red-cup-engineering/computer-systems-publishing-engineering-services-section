/** Public records derived from the article corpus and admitted source inputs. */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { escapeHtml, renderMarkdown } from "./markdown.mjs";
import { absoluteUrl } from "./head.mjs";

const json = (record) => `${JSON.stringify(record, null, 2)}\n`;
const postUrl = (post, property) => absoluteUrl(property.origin, `/posts/${post.slug}`);
const articleRef = (post, property) => ({ "@type": "NewsArticle", "@id": postUrl(post, property),
  headline: post.title, datePublished: post.publishedAt ?? post.date });

export function renderCoverage(posts, property) {
  const terms = new Map();
  const add = (kind, value, post) => {
    if (!value) return;
    const id = `${kind}/${value.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "")}`;
    if (!terms.has(id)) terms.set(id, { kind, value, posts: new Map() });
    terms.get(id).posts.set(post.slug, post);
  };
  for (const post of posts) {
    add("section", post.section, post);
    for (const category of post.categories) add("topic", category, post);
    for (const tag of post.tags) add("tag", tag, post);
  }
  const vocabulary = absoluteUrl(property.origin, "/coverage.json#vocabulary");
  const hasDefinedTerm = [...terms].sort(([left], [right]) => left.localeCompare(right)).map(([id, term]) => ({
    "@type": "DefinedTerm", "@id": absoluteUrl(property.origin, `/coverage.json#${id}`),
    name: term.value, termCode: term.kind, inDefinedTermSet: vocabulary,
    articleCount: term.posts.size, subjectOf: [...term.posts.values()].map((post) => articleRef(post, property)),
  }));
  return json({ "@context": "https://schema.org", "@type": "DefinedTermSet", "@id": vocabulary,
    name: `${property.name} coverage vocabulary`, description: "Published sections, topics, and tags linked to the articles that cover them.",
    url: absoluteUrl(property.origin, "/coverage.json"), inLanguage: property.language ?? "en",
    articleCount: posts.length, termCount: hasDefinedTerm.length, hasDefinedTerm });
}

export function renderNinjs(posts, property, citationRenderer) {
  return json(posts.map((post) => ({
    uri: postUrl(post, property), type: "text", title: post.title, by: post.author,
    language: property.language ?? "en", pubStatus: "usable",
    firstCreated: post.publishedAt ?? `${post.date}T00:00:00Z`,
    versionCreated: post.modified ? new Date(post.modified).toISOString() : post.publishedAt ?? `${post.date}T00:00:00Z`,
    descriptions: [{ contentType: "text/plain", value: post.description }],
    bodies: [{ contentType: "text/html", value: `<article>${renderMarkdown(post.body, { citation: citationRenderer(post.references) })}</article>` }],
    standard: { name: "ninjs", version: "3.2", schema: "https://www.iptc.org/std/ninjs/ninjs-schema_3.2.json" },
  })));
}

export function renderPublicationProvenance(posts, contentDir, property) {
  const path = join(contentDir, "provenance", "historical-publication-witness.json");
  const source = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
  const historical = new Map((source?.articles ?? []).map((article) => [article.slug, article]));
  const articles = posts.map((post) => {
    const witness = historical.get(post.slug);
    const currentDigest = `sha256:${post.sourceDigest}`;
    const matches = witness?.manuscriptDigest === currentDigest;
    return {
      slug: post.slug, path: `/posts/${post.slug}`, currentManuscriptDigest: currentDigest,
      currentPublicationBasis: "published-front-matter-draft-false",
      currentExactEditorialAcceptance: matches && witness.exactEditorialAcceptance === true,
      ...(witness ? { historicalWitness: {
        authority: witness.authority, manuscriptDigest: witness.manuscriptDigest,
        deterministicStandards: witness.deterministicStandards,
        exactEditorialAcceptance: witness.exactEditorialAcceptance === true,
        matchesCurrentManuscript: matches,
      } } : {}),
    };
  });
  const uncarried = [...historical.keys()].filter((slug) => !posts.some((post) => post.slug === slug));
  if (uncarried.length) throw new Error(`historical publication witnesses lack published posts: ${uncarried.join(", ")}`);
  return json({ kind: "koios.publication-provenance/v2", origin: property.origin,
    articleCount: articles.length, currentExactEditorialAcceptanceCount: articles.filter((article) => article.currentExactEditorialAcceptance).length,
    historicalWitnessCount: articles.filter((article) => article.historicalWitness).length,
    articles });
}

export function renderSourceRoll(property, sourceFeedsPath, renderStaticPage) {
  if (!sourceFeedsPath) return new Map();
  const feeds = JSON.parse(readFileSync(sourceFeedsPath, "utf8")).feeds;
  if (!Array.isArray(feeds)) throw new Error(`source feed record has no feeds array: ${sourceFeedsPath}`);
  const seen = new Set();
  const sources = feeds.map((feed) => {
    if (typeof feed.id !== "string" || seen.has(feed.id)) throw new Error(`duplicate or invalid source feed id: ${feed.id}`);
    seen.add(feed.id);
    const url = new URL(feed.url);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error(`unsafe source feed URL: ${feed.url}`);
    const desks = (property.sections ?? []).filter((section) => section.wires?.includes(feed.id)).map((section) => section.slug);
    return { id: feed.id, url: url.href, domain: url.hostname, kind: feed.kind, desks,
      role: url.hostname === new URL(property.origin).hostname ? "own-publication" : "external-intake" };
  });
  const body = `<p>Configured feeds for newsroom intake. Listing a feed does not mean every item has been independently verified or published.</p><ul>${sources.map((source) =>
    `<li><a href="${escapeHtml(source.url)}">${escapeHtml(source.id)}</a> — ${escapeHtml(source.domain)}${source.desks.length ? `; ${source.desks.map(escapeHtml).join(", ")}` : ""}</li>`).join("")}</ul>`;
  return new Map([
    ["sources.json", json({ kind: "koios.news.source-roll/v1", sourceCount: sources.length, sources })],
    ["sources/index.html", renderStaticPage(property, "Newsroom sources", "/sources/", body)],
  ]);
}
