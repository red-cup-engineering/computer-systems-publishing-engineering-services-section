/**
 * Newsroom-day intake: resolve a property's section wires against the
 * newscable-source-broker's house feed list, fetch each feed through the
 * broker's own unseen-only admission (never a second RSS/Atom parser or a
 * second dedup cursor), and project every fresh item into the property's
 * EAVT store as one constituted `news-property.story` entity per item.
 */
import { existsSync, readFileSync } from "node:fs";
import { appendEavtRow, constitute, readEavtEntries } from "@red-cup-engineering/eavt";
import { sourceArrival, syndicationFeed } from "@red-cup-engineering/communicating/messaging/newswire/source-arrival";

/**
 * The accumulated selection window, matching selection's 24-hour freshness horizon.
 * @type {number}
 */
export const CURRENT_NEWS_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Loads a supplied feed directory keyed by id. The property never resolves
 * package-private broker configuration or acquires a network source itself.
 * @param {string} path
 * @returns {Map<string, {id: string, url: string, kind: string}>}
 */
export function loadHouseFeeds(path) {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  const feeds = Array.isArray(parsed) ? parsed : parsed.feeds;
  if (!Array.isArray(feeds)) throw new TypeError("house feed list must be an array or {feeds:[...]}");
  return new Map(feeds.map((feed) => {
    const admitted = syndicationFeed.assert({ id: feed?.id, url: feed?.url, kind: feed?.kind === "atom" ? "atom" : "rss" }, "news property feed directory entry");
    return [admitted.id, admitted];
  }));
}

/**
 * Resolves every section's `wires[]` (feed ids) against the house feed list,
 * deduplicated across sections into one flat feed list plus a section
 * lookup, per the spec-3 law that a property references feeds rather than
 * copying their URLs.
 * @param {{sections: {slug: string, wires: string[]}[]}} property
 * @param {Map<string, {id: string, url: string, kind: string}>} houseFeeds
 * @returns {{feeds: {id: string, url: string, kind: string}[], sectionByFeedId: Map<string, string[]>}}
 * @throws {TypeError} when a section names a wire id absent from the house feed list.
 */
export function resolveSectionWires(property, houseFeeds) {
  const feedsById = new Map();
  const sectionByFeedId = new Map();
  for (const section of property.sections) {
    for (const wireId of section.wires) {
      const feed = houseFeeds.get(wireId);
      if (!feed) throw new TypeError(`section ${section.slug} names wire ${wireId}, which is not in the house feed list`);
      feedsById.set(feed.id, feed);
      const sections = sectionByFeedId.get(feed.id) ?? [];
      sections.push(section.slug);
      sectionByFeedId.set(feed.id, sections);
    }
  }
  return { feeds: [...feedsById.values()], sectionByFeedId };
}

/**
 * The hostname a feed's items are attributed to, for independent-source
 * counting -- two items from different feed ids on the SAME host (e.g. two
 * Guardian RSS feeds) are not independent sources.
 * @param {string} url
 * @returns {string}
 */
export function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./u, ""); } catch { return url; }
}

/**
 * Projects fresh CloudEvent arrivals into the property's EAVT store: one
 * constituted `news-property.story` entity per item, genesis attributes
 * `{feed, url, title}`, plus rows for summary/published when present. The
 * CloudEvent's own `time` is used as `t` throughout one item's rows so the
 * projection is reproducible from the same input.
 * @param {object[]} events - fresh CloudEvents from `intakeFreshArrivals`.
 * @param {string} eavtPath - the property's story EAVT log file.
 * @param {Map<string, string[]>} sectionByFeedId - from `resolveSectionWires`.
 * @returns {{id: string, section: string, feed: string, host: string, title: string, url: string, summary: string|null, published: string|null, time: string}[]}
 *   one row per (story, section) pairing -- a story wired into two sections appears twice, once per section.
 */
export function projectArrivalsToEavt(events, eavtPath, sectionByFeedId) {
  const stories = [];
  for (const candidate of events) {
    const event = sourceArrival.assert(candidate, "news property source arrival");
    const t = event.time;
    const { feed, item } = event.data;
    const attributes = { feed: feed.id, url: item.url, title: item.title };
    const { address, genesis: genesisRow } = constitute({ kind: "news-property.story", attributes, t });
    appendEavtRow({ path: eavtPath, row: genesisRow });
    const rows = [
      { e: address, a: "titled", v: item.title, t },
      { e: address, a: "linked-to", v: item.url, t },
      { e: address, a: "sourced-from", v: feed.id, t },
      ...(item.summary ? [{ e: address, a: "summarized-as", v: item.summary, t }] : []),
      ...(item.published ? [{ e: address, a: "published-at", v: item.published, t }] : []),
    ];
    for (const row of rows) appendEavtRow({ path: eavtPath, row });
    const sections = sectionByFeedId.get(feed.id) ?? [];
    for (const section of sections) {
      stories.push({
        id: address, section, feed: feed.id, host: hostOf(item.url),
        title: item.title, url: item.url,
        summary: item.summary ?? null, published: item.published ?? null, time: t,
      });
    }
  }
  return stories;
}

/**
 * Reads the unique constituted stories in the current-news window from the
 * property's EAVT record and projects them back into their configured sections.
 * @param {object} options
 * @param {string} options.eavtPath - the property's story EAVT log file.
 * @param {Map<string, string[]>} options.sectionByFeedId - from `resolveSectionWires`.
 * @param {number} options.nowMs - inclusive upper window boundary.
 * @param {number} [options.windowMs] - finite lookback from `nowMs`.
 * @returns {{id: string, section: string, feed: string, host: string, title: string, url: string, summary: string|null, published: string|null, time: string}[]}
 */
export function readCurrentStoriesFromEavt({ eavtPath, sectionByFeedId, nowMs, windowMs = CURRENT_NEWS_WINDOW_MS }) {
  if (!existsSync(eavtPath)) return [];
  const entities = new Map();
  const rows = readEavtEntries({ path: eavtPath });
  for (const row of rows) {
    if (row.a !== "constituted" || !row.v || typeof row.v !== "object" || Array.isArray(row.v)) continue;
    const { feed, url, title } = row.v;
    if (typeof row.e !== "string" || typeof feed !== "string" || typeof url !== "string" || typeof title !== "string") continue;
    entities.set(row.e, { id: row.e, feed, url, title, summary: null, published: null, time: row.t });
  }
  for (const row of rows) {
    const story = entities.get(row.e);
    if (!story) continue;
    if (row.a === "summarized-as" && typeof row.v === "string") story.summary = row.v;
    if (row.a === "published-at" && typeof row.v === "string") story.published = row.v;
  }

  const windowStart = nowMs - windowMs;
  const stories = [];
  for (const story of entities.values()) {
    const storyMs = Date.parse(story.published ?? story.time);
    if (!Number.isFinite(storyMs) || storyMs < windowStart || storyMs > nowMs) continue;
    for (const section of sectionByFeedId.get(story.feed) ?? []) {
      stories.push({ ...story, section, host: hostOf(story.url) });
    }
  }
  return stories;
}
