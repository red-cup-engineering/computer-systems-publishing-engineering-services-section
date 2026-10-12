/**
 * Syndication feeds for a property: its posts as the serialized-content web
 * feed's RSS 2.0, Atom and JSON Feed, with the property as the channel (a
 * WebSub hub when one is configured, the favicon as the channel image) and
 * each post's hero image when present.
 */
import { atom, jsonFeed, rss2 } from "@red-cup-engineering/computer-serialized-content-engineering-services-section/web-feed";

/**
 * @typedef {object} FeedPost
 * @property {string} slug
 * @property {string} title
 * @property {string} description
 * @property {string} author
 * @property {string} date ISO 8601 publication instant
 * @property {string} [modified] ISO 8601 correction or update instant
 * @property {string[]} categories
 * @property {string} [image] hero image URL
 * @property {string} [contentHtml] rendered article body
 */

function canonical(property, path) {
  return new URL(path, property.origin).toString();
}

function channel(property, feedPath, posts) {
  return {
    title: property.name,
    homePageUrl: canonical(property, "/"),
    feedUrl: canonical(property, feedPath),
    ...(property.tagline ? { description: property.tagline } : {}),
    ...(property.language ? { language: property.language } : {}),
    ...(property.distribution?.websubHub ? { webSub: { hub: property.distribution.websubHub } } : {}),
    imageUrl: canonical(property, "/favicon.svg"),
    ...(posts.length === 0 ? { updated: new Date(0).toISOString() } : {}),
  };
}

function items(posts, property) {
  return posts.map((post) => {
    const url = canonical(property, `/posts/${post.slug}/`);
    return {
      id: url,
      url,
      title: post.title,
      summary: post.description,
      published: post.date,
      ...(post.modified ? { updated: post.modified } : {}),
      author: { name: post.author },
      tags: post.categories,
      ...(post.image ? { imageUrl: canonical(property, post.image) } : {}),
      ...(post.contentHtml === undefined ? {} : { contentHtml: post.contentHtml }),
    };
  });
}

/** Render the RSS 2.0 feed. @param {FeedPost[]} posts newest first */
export function renderRss(posts, property) {
  return rss2(channel(property, "/feed.xml", posts), items(posts, property));
}

/** Render the Atom feed. @param {FeedPost[]} posts newest first */
export function renderAtom(posts, property) {
  return atom(channel(property, "/feed.atom", posts), items(posts, property));
}

/** Render the JSON Feed 1.1 document. @param {FeedPost[]} posts newest first */
export function renderJsonFeed(posts, property) {
  return jsonFeed(channel(property, "/feed.json", posts), items(posts, property));
}
