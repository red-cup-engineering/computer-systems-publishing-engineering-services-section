/** Public projections of a source-backed claim store. The JSON records remain
 * the evidence carrier; wire pages only assert that named sources published
 * the linked items. */
import { documentShell } from "./templates.mjs";
import { escapeHtml as esc } from "./markdown.mjs";
import { atom, jsonFeed, newsSitemap, rss2 } from "@red-cup-engineering/computer-serialized-content-engineering-services-section/web-feed";

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const text = (value) => String(value ?? "");
const short = (value, limit = 320) => {
  const plain = text(value).replace(/<[^>]*>/gu, " ").replace(/\s+/gu, " ").trim();
  return plain.length > limit ? `${plain.slice(0, limit).trimEnd()}…` : plain;
};
const httpsLink = (value) => {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : undefined; }
  catch { return undefined; }
};
const page = (property, title, path, description, body, { noindex = false } = {}) => documentShell(property, {
  title: `${title} – ${property.name}`, description, canonical: new URL(path, property.origin).href,
  siteName: property.name, noindex,
}, `<h1>${esc(title)}</h1>${body}`);
const fields = (record) => Object.fromEntries(record.claims.filter((claim) =>
  claim?.proposition && typeof claim.proposition.predicate === "string")
  .map((claim) => [claim.proposition.predicate, claim.proposition.object]));

/** @returns {Map<string,string|Buffer>} Paths and public contents. */
export function renderClaimArchive(property, records, posts = []) {
  const files = new Map();
  const byCategory = new Map();
  const byUrl = new Map();
  const storeObjects = [];
  for (const { category, slug, bytes, record } of records) {
    const source = { category, slug };
    const claimPath = `/claims/${category}/${slug}/`;
    const values = fields(record);
    const title = text(values.title || slug);
    const sourceUrl = httpsLink(values.url);
    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category).push({ ...source, title, url: sourceUrl });
    storeObjects.push({ ...source, url: new URL(claimPath, property.origin).href });
    files.set(`claims/${category}/${slug}.json`, bytes);
    const claimRows = record.claims.map((claim) => {
      const predicate = text(claim.proposition?.predicate);
      const value = short(claim.proposition?.object, 500);
      const citation = httpsLink(claim.provenance?.citation);
      return `<li><strong>${esc(predicate)}</strong>: ${esc(value)} <span class="meta">(${esc(claim.force ?? "unmarked")}; ${esc(claim.status ?? "unmarked")})</span>` +
        (citation ? ` <a href="${esc(citation)}" rel="noopener noreferrer">Source</a>` : "") + `</li>`;
    }).join("");
    files.set(`claims/${category}/${slug}/index.html`, page(property, `Claims: ${title}`, claimPath,
      `Recorded claims about ${title}, with witnesses and citations.`,
      `<p>These are attributed source records, not independent verification of each assertion.</p>` +
      `<p><a href="${esc(claimPath.slice(0, -1))}.json">Complete claim record (JSON)</a>` +
      (sourceUrl ? ` · <a href="${esc(sourceUrl)}" rel="noopener noreferrer">Original source</a>` : "") +
      `</p><ol>${claimRows}</ol>`, { noindex: true }));

    const published = new Date(values.published ?? "");
    if (!sourceUrl || Number.isNaN(published.getTime())) continue;
    const wireItem = byUrl.get(sourceUrl) ?? {
      url: sourceUrl, title, summary: text(values.summary), published: published.toISOString(), tags: [], sources: [],
    };
    if (!wireItem.tags.includes(category)) wireItem.tags.push(category);
    wireItem.sources.push(source);
    if (published.toISOString() > wireItem.published) wireItem.published = published.toISOString();
    byUrl.set(sourceUrl, wireItem);
  }
  const ordered = [...byUrl.values()].sort((a, b) => b.published.localeCompare(a.published) || a.url.localeCompare(b.url));
  const categoryList = [...byCategory].map(([category, items]) => ({ category, count: items.length, url: new URL(`/claims/${category}/`, property.origin).href }));
  const wireItem = (item) => ({
    url: item.url, title: item.title, summary: short(item.summary, 1000), published: item.published,
    source: new URL(item.url).hostname.replace(/^www\./u, ""), tags: item.tags,
    claims: item.sources.map((source) => new URL(`/claims/${source.category}/${source.slug}/`, property.origin).href),
  });
  files.set("claims/index.json", json({ kind: "koios.news.claim-store-index/v1", itemCount: ordered.length, categories: categoryList, objects: storeObjects }));
  files.set("claims/index.html", page(property, "Claim records", "/claims/", "Source claims with individual citations.",
    `<p>Read the record and its source before treating an assertion as fact.</p><ul>${categoryList.map((item) =>
      `<li><a href="/claims/${esc(item.category)}/">${esc(item.category)}</a> (${item.count})</li>`).join("")}</ul>`));
  for (const [category, items] of byCategory) {
    files.set(`claims/${category}/index.html`, page(property, `Claims: ${category}`, `/claims/${category}/`,
      `Source claim records filed under ${category}.`, `<ul>${items.map((item) =>
        `<li><a href="/claims/${esc(category)}/${esc(item.slug)}/">${esc(item.title)}</a></li>`).join("")}</ul>`));
  }

  const desks = property.content?.claimStoreDesks ?? Object.fromEntries([...byCategory.keys()].map((category) => [category, [category]]));
  const sections = new Map((property.sections ?? []).map((section) => [section.slug, section]));
  const deskRecord = (desk, categories) => {
    const section = sections.get(desk);
    return { kind: "koios.news.desk/v1", slug: desk, title: section?.title ?? desk,
      description: section?.description ?? "", categories,
      url: new URL(`/wire/${desk}`, property.origin).href,
      posts: posts.filter((post) => post.section === desk).map((post) => ({
        slug: post.slug, title: post.title, url: new URL(`/posts/${post.slug}`, property.origin).href, published: post.date,
      })),
      items: ordered.filter((item) => item.tags.some((tag) => categories.includes(tag))).map(wireItem) };
  };
  const wireList = (items) => `<ol class="wire-list">${items.map((item) => {
    const source = item.sources[0];
    const host = new URL(item.url).hostname.replace(/^www\./u, "");
    return `<li><a href="${esc(item.url)}" rel="noopener noreferrer">${esc(item.title)}</a>` +
      `<p>${esc(short(item.summary))}</p><p class="meta">${esc(host)} · <time datetime="${esc(item.published)}">${esc(item.published.slice(0, 10))}</time>` +
      ` · <a href="/claims/${esc(source.category)}/${esc(source.slug)}/">Claims</a></p></li>`;
  }).join("")}</ol>`;
  files.set("wire/index.json", json({ kind: "koios.news.wire/v1", itemCount: ordered.length,
    newest: ordered[0]?.published ?? null, oldest: ordered.at(-1)?.published ?? null, items: ordered }));
  files.set("wire/index.html", page(property, "The wire", "/wire/", "Attributed headlines from named sources, filed by desk.",
    `<p>These are links to work published by named outlets, not Koios reporting. Each link has a claim record.</p>` +
    `<ul>${Object.entries(desks).map(([desk, categories]) => `<li><a href="/wire/${esc(desk)}/">${esc(property.sections?.find((section) => section.slug === desk)?.title ?? desk)}</a> (${ordered.filter((item) => item.tags.some((tag) => categories.includes(tag))).length})</li>`).join("")}</ul>` + wireList(ordered.slice(0, 40))));
  for (const [desk, categories] of Object.entries(desks)) {
    const items = ordered.filter((item) => item.tags.some((tag) => categories.includes(tag)));
    files.set(`wire/${desk}.json`, json(deskRecord(desk, categories)));
    files.set(`wire/${desk}/index.html`, page(property, property.sections?.find((section) => section.slug === desk)?.title ?? desk,
      `/wire/${desk}/`, `Attributed source links filed under ${desk}.`, wireList(items)));
  }
  for (const [alias, desk] of Object.entries(property.content?.claimStoreWireAliases ?? {})) {
    const categories = desks[desk];
    if (!categories || files.has(`wire/${alias}/index.html`)) throw new Error(`invalid wire alias ${alias}: ${desk}`);
    const items = ordered.filter((item) => item.tags.some((tag) => categories.includes(tag)));
    files.set(`wire/${alias}.json`, json({ ...deskRecord(desk, categories), slug: alias,
      url: new URL(`/wire/${alias}`, property.origin).href }));
    files.set(`wire/${alias}/index.html`, page(property, property.sections?.find((section) => section.slug === desk)?.title ?? desk,
      `/wire/${desk}/`, `Attributed source links filed under ${desk}.`, wireList(items)));
  }
  files.set("wire/coverage/index.html", page(property, "Wire coverage", "/wire/coverage/", "Source records by category.",
    `<ul>${categoryList.map((item) => `<li><a href="/claims/${esc(item.category)}/">${esc(item.category)}</a> (${item.count})</li>`).join("")}</ul>`));
  const hosts = new Map();
  for (const item of ordered) {
    const host = new URL(item.url).hostname.replace(/^www\./u, "");
    hosts.set(host, (hosts.get(host) ?? 0) + 1);
  }
  files.set("wire/coverage.json", json({ kind: "koios.news.wire-coverage/v1", itemCount: ordered.length,
    newest: ordered[0]?.published ?? null, oldest: ordered.at(-1)?.published ?? null,
    hosts: [...hosts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    categories: categoryList }));
  const channel = (path) => ({ title: `${property.name} — Wire`, homePageUrl: new URL("/wire/", property.origin).href,
    feedUrl: new URL(path, property.origin).href, description: "Attributed source coverage tracked by Koios.News.",
    language: property.language ?? "en", ...(ordered.length ? {} : { updated: new Date(0).toISOString() }) });
  const feedItems = ordered.map((item) => ({ id: item.url, url: item.url, title: item.title,
    summary: short(item.summary, 1000), published: item.published,
    author: { name: new URL(item.url).hostname.replace(/^www\./u, "") }, tags: item.tags }));
  files.set("wire/feed.xml", rss2(channel("/wire/feed.xml"), feedItems));
  files.set("wire/feed.atom", atom(channel("/wire/feed.atom"), feedItems));
  files.set("wire/feed.json", jsonFeed(channel("/wire/feed.json"), feedItems));
  // External source URLs are not Koios.News articles and must not be claimed in a Koios News sitemap.
  files.set("wire/news-sitemap.xml", newsSitemap([]));
  return files;
}
