/**
 * The rendered surfaces of a news property (specification §5): home,
 * section, article, desk, author, tag, archive, search, masthead, standards,
 * corrections, about, and privacy pages, plus the shared document shell
 * (masthead header, skip link, landmarks, footer) they all render inside.
 * Every function here takes plain data and returns an HTML string; nothing
 * reads the filesystem — `src/build.mjs` is the only I/O boundary.
 */
import { slugify } from "@red-cup-engineering/computer-text-content-engineering-services-section/slugify-text";
import { escapeHtml } from "./markdown.mjs";
import { renderHeadTags, newsArticleJsonLd, newsMediaOrganizationJsonLd, absoluteUrl } from "./head.mjs";

const PAGE_SIZE = 12;
const esc = escapeHtml;

/**
 * @param {object} property
 * @param {string} path site-relative, beginning with "/"
 * @returns {string}
 */
function url(property, path) {
  return absoluteUrl(property.origin, path);
}

/**
 * @param {string} iso
 * @returns {string}
 */
function humanDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

function publicationLabel(post) {
  return post.publishedAt
    ? `${humanDate(post.date)} at ${post.publishedAt.slice(11, 16)} UTC`
    : humanDate(post.date);
}

/**
 * Render the primary navigation: the property's sections, plus Search and
 * Masthead.
 * @param {object} property
 * @param {string} [activeSlug]
 * @returns {string}
 */
function primaryNav(property, activeSlug) {
  const items = (property.sections ?? []).map((section) =>
    `<a href="/sections/${esc(section.slug)}/"${section.slug === activeSlug ? ' aria-current="page"' : ""}>${esc(section.title)}</a>`);
  items.push('<a href="/topics/">Topics</a>', '<a href="/tags/">Tags</a>', '<a href="/search/">Search</a>', '<a href="/masthead/">Masthead</a>');
  if (property.content?.claimStore) items.push('<a href="/wire/">The wire</a>', '<a href="/claims/">Claims</a>');
  return `<nav aria-label="Primary">${items.join("")}</nav>`;
}

/**
 * Render the site masthead header.
 * @param {object} property
 * @param {string} [activeSlug]
 * @returns {string}
 */
function siteHeader(property, activeSlug) {
  return `<header role="banner"><div class="site-identity"><a class="site-title" href="/">${esc(property.name)}</a>` +
    `<span class="site-tagline">${esc(property.tagline ?? "")}</span></div>${primaryNav(property, activeSlug)}</header>`;
}

/**
 * Render a house ad slot: a placeholder frame that fetches its creative
 * client-side, so build output stays byte-deterministic regardless of which
 * creative is later served. Ported from the Koios.News carrier's footer
 * ad-server pattern, generalized to any configured slot position.
 * @param {object} property
 * @param {string} position
 * @returns {string}
 */
function houseAdSlot(property, position, context = []) {
  const server = property.monetization?.houseAds?.server;
  const slots = property.monetization?.houseAds?.slots ?? [];
  if (!server || !slots.includes(position)) return "";
  // What the page is about (an article's desk and tags) travels to the ad
  // server so it can prefer a fitting house product; nothing about the reader does.
  const contexts = context.filter((value) => typeof value === "string" && value !== "").slice(0, 8).map((value) => slugify(value));
  const contextAttribute = contexts.length > 0 ? ` data-context="${esc(contexts.join(","))}"` : "";
  return `<div class="ad-slot ad-slot--house" data-slot="${esc(position)}" data-property="${esc(property.name)}" data-ad-server="${esc(server)}"${contextAttribute}></div>`;
}

function adSlot(property, position, post) {
  const aads = property.monetization?.aads;
  if (!aads) return houseAdSlot(property, position);
  const candidates = position === "inArticle" ? aads.inArticle : [aads[position]];
  if (!Array.isArray(candidates) || candidates.length === 0) return houseAdSlot(property, position);
  const assigned = post?.adUnit;
  const index = post ? [...post.slug].reduce((sum, character) => sum + character.codePointAt(0), 0) % candidates.length : 0;
  const unit = assigned ?? candidates[index];
  if (!/^\d+$/u.test(unit) || !aads.units?.includes(unit)) throw new Error(`unrecognized A-Ads unit: ${unit}`);
  const loading = position === "footer" ? ' loading="lazy"' : "";
  return `<aside class="ad-slot ad-slot--paid" aria-label="Advertisement"><span class="ad-slot__label">Advertisement</span>` +
    `<iframe data-aa="${unit}" src="https://acceptable.a-ads.com/${unit}/?size=Adaptive" title="Advertisement"${loading} referrerpolicy="strict-origin-when-cross-origin"></iframe></aside>`;
}

function followFeeds(property) {
  return `<section class="follow-feeds"><h2>Follow new articles</h2>` +
    `<p>Add ${esc(property.name)} to your feed reader to see each new story.</p>` +
    `<div class="follow-feeds__links"><a href="/feed.xml" type="application/rss+xml">RSS feed</a>` +
    `<a href="/feed.atom" type="application/atom+xml">Atom feed</a></div></section>`;
}

/**
 * Render a direct purchase path for a property-level product.  The market
 * carries payment; the property merely gives readers and agent buyers an
 * honest, stable route to the thing it sells.
 * @param {object} property
 * @returns {string}
 */
function x402Product(property) {
  const product = property.monetization?.x402;
  if (!product || typeof product.market !== "string" || typeof product.route !== "string") return "";
  const href = new URL(product.route, product.market).toString();
  const offerAnchor = typeof product.gateway === "string" && typeof product.operation === "string"
    ? `${product.gateway}-${product.operation}` : "buying";
  const guide = new URL(`/#${encodeURIComponent(offerAnchor)}`, product.market).toString();
  const label = typeof product.label === "string" && product.label.trim() ? product.label.trim() : "Current intelligence briefing";
  const price = Number(product.priceUsd);
  const priceLine = Number.isFinite(price) && price >= 0 ? ` — $${price.toFixed(2)}` : "";
  return `<section class="paid-product"><h2>${esc(label)}</h2>` +
    `<p>Source-linked analysis drawn from the current newsroom record.</p>` +
    `<p>Purchase requires an x402-compatible client; a regular browser cannot complete checkout.</p>` +
    `<a class="paid-product__buy" href="${esc(guide)}">How to buy the briefing${esc(priceLine)}</a>` +
    `<p><a href="${esc(href)}">View the payment terms</a>.</p></section>`;
}

/**
 * Render the footer, with the standing links every property carries.
 * @param {object} property
 * @returns {string}
 */
function siteFooter(property, options = {}) {
  const actor = property.distribution?.activityPubActor;
  const year = (property.masthead?.year ?? new Date().getUTCFullYear());
  const links = [
    '<a href="/about/">About</a>', '<a href="/masthead/">Masthead</a>', '<a href="/standards/">Standards</a>',
    '<a href="/corrections/">Corrections</a>', '<a href="/about/#ownership">Ownership</a>', '<a href="/privacy/">Privacy</a>',
    property.monetization?.aads ? '<a href="/advertise/">Advertise</a>' : '',
    property.content?.sourceFeeds ? '<a href="/sources/">Newsroom sources</a>' : '',
    '<a href="/archive/">Archive</a>', '<a href="/bibliography/">Article citations</a>',
    '<a href="/feed.xml">RSS</a>', '<a href="/feed.atom">Atom</a>', '<a href="/feed.json">JSON Feed</a>',
    '<a href="/sitemap.xml">Sitemap</a>',
    actor ? `<a rel="me" href="${esc(actor)}">${esc(actor.replace(/^https?:\/\//u, ""))}</a>` : "",
  ].filter(Boolean).join(" · ");
  return `<footer role="contentinfo">${options.paidInventory ? adSlot(property, "footer") : houseAdSlot(property, "footer")}<div class="inner">` +
    `<span>© ${esc(String(year))} ${esc(property.name)}</span>${links}</div></footer>`;
}

/**
 * Assemble a complete HTML document from a page's head context and body.
 * @param {object} property
 * @param {import("./head.mjs").HeadContext} headCtx
 * @param {string} bodyHtml inner markup for `<main>`
 * @param {object} [options]
 * @param {string} [options.activeSlug] the active nav item, for `aria-current`
 * @param {string} [options.stylesheetHref] defaults to `/assets/site.css`
 * @param {boolean} [options.shareLinks] load the article sharing control
 * @returns {string}
 */
export function documentShell(property, headCtx, bodyHtml, options = {}) {
  const stylesheet = options.stylesheetHref ?? "/assets/site.css";
  const lang = property.language ?? "en";
  return `<!doctype html>
<html lang="${esc(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${esc(stylesheet)}">
${renderHeadTags({ ...headCtx, ogImage: headCtx.ogImage ?? absoluteUrl(property.origin, "/og.png"), ogImageWidth: 1200, ogImageHeight: 675 })}
</head>
<body>
<a class="skip-to-content" href="#main-content">Skip to content</a>
${siteHeader(property, options.activeSlug)}
<main id="main-content" role="main">
${bodyHtml}
</main>
${siteFooter(property, options)}
${options.shareLinks ? '<script src="/assets/share.js" defer></script>\n' : ""}${property.monetization?.houseAds?.server ? '<script src="/assets/house-ad.js" defer></script>' : ""}
</body>
</html>
`;
}

/**
 * Render one story summary card.
 * @param {object} post
 * @param {object} [options]
 * @param {boolean} [options.lead]
 * @param {boolean} [options.showImage]
 * @returns {string}
 */
export function storyCard(post, options = {}) {
  const cls = options.lead ? "story story--lead" : "story";
  const image = options.showImage !== false && post.image
    ? `<a class="story__image" href="/posts/${esc(post.slug)}/"><img src="${esc(post.image)}" alt="${esc(post.imageAlt ?? "")}"></a>`
    : "";
  return `<article class="${cls}">${image}` +
    `<span class="story__kicker"><a href="/sections/${esc(post.section)}/">${esc(post.sectionTitle)}</a></span>` +
    `<h2 class="story__head"><a href="/posts/${esc(post.slug)}/">${esc(post.title)}</a></h2>` +
    `<p class="story__sum">${esc(post.description)}</p>` +
    `<p class="story__meta"><time datetime="${esc(post.publishedAt ?? post.date)}">${esc(publicationLabel(post))}</time> · ${esc(post.author)}</p></article>`;
}

/**
 * Render the home page.
 * @param {object} input
 * @param {object} input.property
 * @param {object[]} input.posts all published posts, newest first
 * @param {{slug:string,views:number}[]} [input.mostRead]
 * @param {Date} [input.asOf] current build time for the rolling front page
 * @returns {string}
 */
export function renderHomePage({ property, posts, mostRead, asOf }) {
  const front = asOf === undefined ? posts : posts.filter((post) => {
    const published = Date.parse(post.publishedAt ?? `${post.date}T00:00:00Z`);
    return published <= asOf.getTime() && published >= asOf.getTime() - 30 * 24 * 60 * 60 * 1000;
  });
  const lead = front[0];
  const top = front.slice(1, 4);
  const latest = front.slice(0, 10);
  const bySection = new Map();
  for (const post of front) {
    if (!bySection.has(post.section)) bySection.set(post.section, []);
    bySection.get(post.section).push(post);
  }
  const sectionBlocks = (property.sections ?? []).map((section) => {
    const entries = (bySection.get(section.slug) ?? []).slice(0, 4);
    if (entries.length === 0) return "";
    return `<section class="section-block"><h2><a href="/sections/${esc(section.slug)}/">${esc(section.title)}</a></h2>` +
      `<div class="stories">${entries.map((post) => storyCard(post)).join("")}</div></section>`;
  }).filter(Boolean).join("");
  const latestList = latest.length ? `<section class="latest-list"><h2>Latest</h2><div class="stories">` +
    `${latest.map((post) => storyCard(post, { showImage: false })).join("")}</div>` +
    `<p><a href="/archive/">Browse the full archive</a></p></section>` : "";
  const mostReadHtml = mostRead && mostRead.length > 0
    ? `<section class="most-read"><h2>Most Read</h2><ol>${mostRead.map((entry) => {
      const post = posts.find((candidate) => candidate.slug === entry.slug);
      const title = post ? post.title : entry.slug;
      return `<li><a href="/posts/${esc(entry.slug)}/">${esc(title)}</a></li>`;
    }).join("")}</ol></section>`
    : "";
  const body = [
    adSlot(property, "header"),
    lead ? `<div class="stories">${storyCard(lead, { lead: true })}` +
      `<div class="top-block">${top.map((post) => storyCard(post)).join("")}</div></div>` :
      `<p>No reports published in the past 30 days. <a href="/archive/">Browse the archive</a>.</p>`,
    x402Product(property),
    sectionBlocks,
    latestList,
    mostReadHtml,
    followFeeds(property),
  ].filter(Boolean).join("\n");
  const headCtx = {
    title: property.name,
    description: property.tagline ?? "",
    canonical: url(property, "/"),
    siteName: property.name,
    ogType: "website",
    locale: property.locale,
    jsonLd: newsMediaOrganizationJsonLd({ name: property.name, url: `${property.origin}/`, logo: url(property, "/favicon.svg") }),
    fediverseCreator: property.distribution?.activityPubActor,
    actorUrl: property.distribution?.activityPubActor,
  };
  return documentShell(property, headCtx, body, { paidInventory: true });
}

/**
 * Render a paginated section page.
 * @param {object} input
 * @param {object} input.property
 * @param {object} input.section `{slug,title}`
 * @param {object[]} input.posts every post in the section, newest first
 * @param {number} input.page 1-indexed
 * @returns {string}
 */
export function renderSectionPage({ property, section, posts, page }) {
  const totalPages = Math.max(1, Math.ceil(posts.length / PAGE_SIZE));
  const pageStart = (page - 1) * PAGE_SIZE;
  const pagePosts = posts.slice(pageStart, pageStart + PAGE_SIZE);
  const base = `/sections/${section.slug}`;
  const pagination = totalPages > 1
    ? `<nav class="pagination" aria-label="Pagination">` +
      `${page > 1 ? `<a href="${page === 2 ? `${base}/` : `${base}/page/${page - 1}/`}">Newer</a>` : "<span></span>"}` +
      `<span>Page ${page} of ${totalPages}</span>` +
      `${page < totalPages ? `<a href="${base}/page/${page + 1}/">Older</a>` : "<span></span>"}</nav>`
    : "";
  const body = `<h1>${esc(section.title)}</h1><div class="stories">${pagePosts.map((post) => storyCard(post)).join("")}</div>${pagination}`;
  const headCtx = {
    title: `${section.title} – ${property.name}`,
    description: `Stories filed under ${section.title}.`,
    canonical: url(property, page === 1 ? `${base}/` : `${base}/page/${page}/`),
    siteName: property.name,
  };
  return documentShell(property, headCtx, body, { activeSlug: section.slug });
}

/**
 * Render the claim ledger and omission ledger sections, when the article's
 * front matter provides them.
 * @param {{text:string,source?:string}[]} [claims]
 * @param {{text:string}[]} [omissions]
 * @returns {string}
 */
function renderLedgers(claims, omissions) {
  const claimHtml = claims && claims.length > 0
    ? `<section class="ledger ledger--claims"><h2>What this article establishes</h2><ol>` +
      claims.map((claim) => `<li>${esc(claim.text)}${claim.source ? `<cite><a href="${esc(claim.source)}">${esc(claim.source)}</a></cite>` : ""}</li>`).join("") +
      `</ol></section>`
    : "";
  const omissionHtml = omissions && omissions.length > 0
    ? `<section class="ledger ledger--omissions"><h2>What this reporting does not establish</h2><ol>` +
      omissions.map((omission) => `<li>${esc(omission.text)}</li>`).join("") + `</ol></section>`
    : "";
  return claimHtml + omissionHtml;
}

/**
 * Render the corrections notice, when the article's front matter provides
 * one.
 * @param {{date:string,note:string}[]} [corrections]
 * @returns {string}
 */
function renderCorrectionNotice(corrections) {
  if (!corrections || corrections.length === 0) return "";
  return `<aside class="correction-notice"><h2>Corrections</h2><ol>` +
    corrections.map((entry) => `<li><time datetime="${esc(entry.date)}">${esc(humanDate(entry.date))}</time>: ${esc(entry.note)}</li>`).join("") +
    `</ol></aside>`;
}

function renderArticleRights(post) {
  return post.license
    ? `<aside class="article-rights"><h2>Rights and republication</h2><p>Published under ` +
      (post.licenseUrl ? `<a rel="license" href="${esc(post.licenseUrl)}">${esc(post.license)}</a>` : esc(post.license)) +
      `.${post.syndicationRights ? ` ${esc(post.syndicationRights)}` : ""}</p></aside>`
    : "";
}

/** The article a subscriber reads, carrying the page's editorial context. */
export function renderSyndicatedArticle(property, post) {
  return (post.dek ? `<p>${esc(post.dek)}</p>` : "") + post.bodyHtml +
    renderLedgers(post.claims, post.omissions) + renderCorrectionNotice(post.corrections) +
    `<p>Published by ${esc(property.name)}: <a href="${esc(url(property, `/posts/${post.slug}/`))}">${esc(post.title)}</a>.</p>` +
    renderArticleRights(post);
}

/**
 * Render the share-links row.
 * @param {string} shareUrl absolute article URL
 * @param {string} title
 * @returns {string}
 */
function renderShareLinks(shareUrl, title) {
  const encodedUrl = encodeURIComponent(shareUrl);
  const encodedTitle = encodeURIComponent(title);
  return `<div class="share-links">` +
    `<a href="https://x.com/intent/post?url=${encodedUrl}&text=${encodedTitle}" rel="noopener noreferrer">Share on X</a>` +
    `<a href="https://bsky.app/intent/compose?text=${encodedTitle}%20${encodedUrl}" rel="noopener noreferrer">Share on Bluesky</a>` +
    `<a href="https://mastodonshare.com/?url=${encodedUrl}&text=${encodedTitle}" rel="noopener noreferrer">Share on Mastodon</a>` +
    `<button type="button" data-copy-link="${esc(shareUrl)}">Copy link</button>` +
    `<span class="share-links__status" role="status" aria-live="polite"></span>` +
    `</div>`;
}

/**
 * Render related stories: other published posts sharing the article's
 * section or a tag, most recent first, excluding the article itself.
 * @param {object} post
 * @param {object[]} allPosts
 * @returns {string}
 */
function renderRelatedStories(post, allPosts) {
  const tagSet = new Set(post.tags ?? []);
  const related = allPosts
    .filter((candidate) => candidate.slug !== post.slug &&
      (candidate.section === post.section || (candidate.tags ?? []).some((tag) => tagSet.has(tag))))
    .slice(0, 3);
  if (related.length === 0) return "";
  return `<section class="related-stories"><h2>Related stories</h2><div class="related-stories__grid">` +
    related.map((entry) => `<article class="related-story"><h3><a href="/posts/${esc(entry.slug)}/">${esc(entry.title)}</a></h3>` +
      `<p>${esc(entry.description)}</p></article>`).join("") + `</div></section>`;
}

/**
 * Render a single article page.
 * @param {object} input
 * @param {object} input.property
 * @param {object} input.post the article, with `bodyHtml` already rendered
 * @param {object[]} input.allPosts every published post, for related stories
 * @returns {string}
 */
export function renderArticlePage({ property, post, allPosts, verificationArticleUnit, noindex = false }) {
  const articleUrl = url(property, `/posts/${post.slug}/`);
  const hero = post.image
    ? `<figure class="article-hero"><img src="${esc(post.image)}" alt="${esc(post.imageAlt ?? "")}">` +
      (post.imageCredit ? `<figcaption>${esc(post.imageCredit)}</figcaption>` : "") + `</figure>`
    : "";
  const rights = renderArticleRights(post);
  const tags = (post.tags ?? []).length > 0
    ? `<p class="tags">${post.tags.map((tag) => `<a href="/tags/${esc(slugify(tag))}/">${esc(tag)}</a>`).join("")}</p>`
    : "";
  const body = `<article class="h-entry">` +
    `<span class="article-kicker"><a href="/sections/${esc(post.section)}/">${esc(post.sectionTitle)}</a></span>` +
    `<h1 class="p-name">${esc(post.title)}</h1>` +
    (post.dek ? `<p class="article-dek">${esc(post.dek)}</p>` : "") +
    `<p class="article-byline"><time class="dt-published" datetime="${esc(post.publishedAt ?? post.date)}">${esc(publicationLabel(post))}</time>` +
    (post.modified && post.modified !== post.date ? `<time class="dt-updated" datetime="${esc(post.modified)}"> · Updated ${esc(humanDate(post.modified))}</time>` : "") +
    ` · By <a class="p-author" href="/desks/${esc(post.section)}/">${esc(post.author)}</a></p>` +
    (verificationArticleUnit ? adSlot(property, "header") : "") +
    hero +
    adSlot(property, "inArticle", verificationArticleUnit ? { ...post, adUnit: verificationArticleUnit } : post) +
    `<div class="e-content">${post.bodyHtml}</div>` +
    houseAdSlot(property, "afterArticle", [post.section, ...(post.tags ?? [])]) +
    tags +
    renderLedgers(post.claims, post.omissions) +
    renderRelatedStories(post, allPosts) +
    renderShareLinks(articleUrl, post.title) +
    renderCorrectionNotice(post.corrections) +
    rights +
    `</article>`;
  const headCtx = {
    title: `${post.title} – ${property.name}`,
    description: post.description,
    canonical: articleUrl,
    siteName: property.name,
    ogType: "article",
    locale: property.locale,
    ogImage: post.ogImage,
    noindex: noindex || Boolean(verificationArticleUnit),
    articlePublishedTime: post.publishedAt ?? post.date,
    articleModifiedTime: post.modified ?? post.publishedAt ?? post.date,
    articleSection: post.sectionTitle,
    articleTags: post.tags,
    jsonLd: newsArticleJsonLd({
      headline: post.title,
      url: articleUrl,
      image: post.ogImage,
      datePublished: post.publishedAt ?? post.date,
      dateModified: post.modified ?? post.publishedAt ?? post.date,
      author: {
        type: post.author.startsWith(`${property.name} `) && post.author.endsWith(" Desk") ? "Organization" : "Person",
        name: post.author,
        url: url(property, `/authors/${post.authorSlug}/`),
      },
      publisher: { name: property.name, url: `${property.origin}/`, logo: url(property, "/favicon.svg") },
      description: post.description,
      articleSection: post.sectionTitle,
      keywords: post.keywords,
    }),
    fediverseCreator: property.distribution?.activityPubActor,
    actorUrl: property.distribution?.activityPubActor,
  };
  return documentShell(property, headCtx, body, { activeSlug: post.section, paidInventory: true, shareLinks: true });
}

/**
 * Render a plain list-of-posts page (used by tag, author, and desk pages).
 * @param {object} property
 * @param {string} title
 * @param {string} description
 * @param {string} canonicalPath
 * @param {object[]} posts
 * @returns {string}
 */
function renderPostListPage(property, title, description, canonicalPath, posts) {
  const body = `<h1>${esc(title)}</h1><ul class="pages">` +
    posts.map((post) => `<li><a href="/posts/${esc(post.slug)}/">${esc(post.title)}</a><p>${esc(post.description)}</p></li>`).join("") +
    `</ul>`;
  const headCtx = { title: `${title} – ${property.name}`, description, canonical: url(property, canonicalPath), siteName: property.name };
  return documentShell(property, headCtx, body);
}

/**
 * Render a tag page.
 * @param {object} property
 * @param {{slug:string,title:string}} tag
 * @param {object[]} posts posts carrying this tag, newest first
 * @returns {string}
 */
export function renderTagPage(property, tag, posts) {
  return renderPostListPage(property, `Tag: ${tag.title}`, `${posts.length} stories tagged ${tag.title}.`, `/tags/${tag.slug}/`, posts);
}

export function renderTopicPage(property, topic, posts) {
  return renderPostListPage(property, `Topic: ${topic.title}`, `${posts.length} stories on ${topic.title}.`, `/topics/${topic.slug}/`, posts);
}

/**
 * Render a coverage desk directly from its section.
 * @param {object} property
 * @param {object} desk `{slug,title,description?}`
 * @param {object[]} posts posts filed to this desk's section, newest first
 * @returns {string}
 */
export function renderDeskPage(property, desk, posts) {
  const description = desk.description ?? `Coverage from the ${desk.title} desk.`;
  const body = `<h1>${esc(desk.title)}</h1><p>${esc(description)}</p>` +
    `<div class="stories">${posts.slice(0, PAGE_SIZE).map((post) => storyCard(post)).join("")}</div>`;
  const headCtx = { title: `${desk.title} – ${property.name}`, description, canonical: url(property, `/desks/${desk.slug}/`), siteName: property.name };
  return documentShell(property, headCtx, body, { activeSlug: desk.slug });
}

/**
 * Render an author page.
 * @param {object} property
 * @param {{slug:string,name:string,bio?:string}} author
 * @param {object[]} posts posts bylined to this author, newest first
 * @returns {string}
 */
export function renderAuthorPage(property, author, posts) {
  const body = `<h1>${esc(author.name)}</h1>` + (author.bio ? `<p>${esc(author.bio)}</p>` : "") +
    `<div class="stories">${posts.map((post) => storyCard(post)).join("")}</div>`;
  const headCtx = { title: `${author.name} – ${property.name}`, description: author.bio ?? "", canonical: url(property, `/authors/${author.slug}/`), siteName: property.name };
  return documentShell(property, headCtx, body);
}

/**
 * Render the archive index page (years).
 * @param {object} property
 * @param {{year:string,months:{month:string,count:number}[],count:number}[]} years
 * @returns {string}
 */
export function renderArchiveIndexPage(property, years) {
  const body = `<h1>Archive</h1>` + years.map((year) =>
    `<section><h2><a href="/archive/${esc(year.year)}/">${esc(year.year)}</a></h2><p>${year.count} posts</p></section>`).join("");
  const headCtx = { title: `Archive – ${property.name}`, description: "The full publication archive by year and month.", canonical: url(property, "/archive/"), siteName: property.name };
  return documentShell(property, headCtx, body);
}

/**
 * Render an archive year page.
 * @param {object} property
 * @param {string} year
 * @param {object[]} posts posts published in this year, newest first
 * @returns {string}
 */
export function renderArchiveYearPage(property, year, posts) {
  return renderPostListPage(property, `Archive: ${year}`, `Posts published in ${year}.`, `/archive/${year}/`, posts);
}

/**
 * Render an archive month page.
 * @param {object} property
 * @param {string} year
 * @param {string} month two-digit month
 * @param {object[]} posts posts published in this month, newest first
 * @returns {string}
 */
export function renderArchiveMonthPage(property, year, month, posts) {
  return renderPostListPage(property, `Archive: ${year}-${month}`, `Posts published in ${year}-${month}.`, `/archive/${year}/${month}/`, posts);
}

/** Render the public publisher and coverage desks from publication settings. */
export function renderMastheadPage(property) {
  const masthead = property.masthead ?? {};
  const deskCards = (property.sections ?? []).map((desk) =>
    `<div class="masthead-card"><h3><a href="/desks/${esc(desk.slug)}/">${esc(desk.title)}</a></h3>` +
    `<p>${esc(desk.description ?? `Coverage from the ${desk.title} desk.`)}</p></div>`).join("");
  const body = `<h1>Masthead</h1><h2>Publisher</h2><p>${esc(masthead.publisher ?? "")}</p>` +
    `<h2>How we publish</h2><p>${esc(masthead.editorialMethod ?? "")}</p>` +
    `<p><a href="/standards/">Editorial standards</a> · <a href="/corrections/">Corrections</a> · <a href="/about/">About</a></p>` +
    `<h2>Coverage desks</h2><div class="desk-grid">${deskCards}</div>`;
  const headCtx = { title: `Masthead – ${property.name}`, description: `Publisher and coverage desks of ${property.name}.`, canonical: url(property, "/masthead/"), siteName: property.name };
  return documentShell(property, headCtx, body);
}

/** Render a static text page with already-escaped body HTML. */
export function renderStaticPage(property, title, path, bodyHtml) {
  const body = `<h1>${esc(title)}</h1>${bodyHtml}`;
  const headCtx = { title: `${title} – ${property.name}`, description: title, canonical: url(property, path), siteName: property.name };
  return documentShell(property, headCtx, body);
}

/**
 * Render the search page shell (the client script fills in results).
 * @param {object} property
 * @returns {string}
 */
export function renderSearchPage(property) {
  const body = `<h1>Search</h1>` +
    `<form id="search-form" class="search-form" role="search"><label for="search-q">Search articles</label>` +
    `<input id="search-q" type="search" name="q" placeholder="Search ${esc(property.name)}"><button type="submit">Search</button></form>` +
    `<p id="search-status"></p><ul id="search-results"></ul><script src="/assets/search.js" defer></script>`;
  const headCtx = { title: `Search – ${property.name}`, description: `Search ${property.name}.`, canonical: url(property, "/search/"), siteName: property.name };
  return documentShell(property, headCtx, body);
}

/**
 * Render the 404 page.
 * @param {object} property
 * @returns {string}
 */
export function render404Page(property) {
  const body = `<h1>Not found</h1><p>The requested page does not exist. <a href="/">Return to ${esc(property.name)}</a>.</p>`;
  const headCtx = { title: `Not found – ${property.name}`, description: "The requested page does not exist.", canonical: url(property, "/404.html"), siteName: property.name };
  return documentShell(property, headCtx, body);
}
