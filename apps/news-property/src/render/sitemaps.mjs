/**
 * Sitemaps, robots.txt, and ads.txt, through the serialized-content web feed.
 * The news sitemap window is computed relative to the publication build time.
 * Callers can supply that time to reproduce a particular build.
 */
import { newsSitemap, robots, sitemap } from "@red-cup-engineering/computer-serialized-content-engineering-services-section/web-feed";

const NEWS_WINDOW_MS = 48 * 60 * 60 * 1000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/u;

// Historical articles only record a calendar day. Preserve that precision in
// article metadata; project a wire instant only where a codec requires one.
function feedInstant(value) {
  return ISO_DAY.test(value) ? `${value}T00:00:00Z` : value;
}

/**
 * @typedef {object} SitemapEntry
 * @property {string} path site-relative path beginning with "/"
 * @property {string} [lastmod] ISO 8601 or YYYY-MM-DD when a page revision is known
 */

/** Render `sitemap.xml` with `lastmod` only for witnessed revisions. @param {SitemapEntry[]} entries */
export function renderSitemap(entries, property) {
  return sitemap(entries.map((entry) => ({
    loc: new URL(entry.path, property.origin).toString(),
    ...(entry.lastmod ? { lastmod: feedInstant(entry.lastmod) } : {}),
  })));
}

/**
 * Render `news-sitemap.xml`: articles published within 48 hours of the
 * build time, per the Google News sitemap protocol.
 * @param {{slug:string,title:string,date:string}[]} posts newest first
 */
export function renderNewsSitemap(posts, property, asOf = new Date()) {
  const now = new Date(asOf).getTime();
  if (!Number.isFinite(now)) throw new TypeError("asOf must be a valid date or instant");
  const threshold = now - NEWS_WINDOW_MS;
  return newsSitemap(posts.filter((post) => {
    const published = Date.parse(feedInstant(post.publishedAt ?? post.date));
    return published >= threshold && published <= now;
  }).map((post) => ({
    loc: new URL(`/posts/${post.slug}/`, property.origin).toString(),
    publication: { name: property.name, language: property.language ?? "en" },
    publicationDate: post.publishedAt ?? post.date,
    title: post.title,
  })));
}

/** Render `robots.txt`, listing the general and news sitemaps. */
export function renderRobotsTxt(property) {
  return robots({
    sitemap: [
      new URL("/sitemap.xml", property.origin).toString(),
      ...(property.distribution?.googleNewsSitemap ? [new URL("/news-sitemap.xml", property.origin).toString()] : []),
    ],
  });
}

/**
 * Render `ads.txt` from `property.monetization.adsTxt` lines, or `undefined`
 * when none are configured (the file is then omitted from the build).
 */
export function renderAdsTxt(property) {
  const lines = property.monetization?.adsTxt;
  if (!Array.isArray(lines) || lines.length === 0) return undefined;
  return `${lines.join("\n")}\n`;
}
