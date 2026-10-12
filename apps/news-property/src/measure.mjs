/**
 * News property measurement: pull Cloudflare Web Analytics and the house ad
 * server's delivery receipts, join them against one pulse's settlement
 * record, and produce the EROEI readout (news-property specification §4.4,
 * §8.3) — attention captured per unit of inference spent, computed from
 * receipts, never estimated. Every network call takes an injectable `fetch`
 * and returns a typed refusal instead of throwing when a credential or
 * scope is absent, so a property with analytics configured and ads not yet
 * live (or vice versa) still gets a readout from whichever source answered.
 */

const CLOUDFLARE_GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql";

const WEB_ANALYTICS_QUERY = `query WebAnalyticsByPathAndReferrer($accountTag: String!, $siteTag: String!, $since: Time!, $until: Time!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      rumPageloadEventsAdaptiveGroups(
        limit: 10000
        filter: { siteTag: $siteTag, datetime_geq: $since, datetime_leq: $until }
      ) {
        count
        sum { visits }
        dimensions { requestPath refererHost }
      }
    }
  }
}`;

/** Search engines whose referrer host names the query, not an answer surface. */
const SEARCH_HOSTS = ["google.com", "bing.com", "duckduckgo.com", "search.yahoo.com", "yahoo.com"];
/** Mainstream social platforms with a link-sharing timeline. */
const SOCIAL_HOSTS = ["x.com", "twitter.com", "t.co", "facebook.com", "reddit.com", "bsky.app", "linkedin.com", "threads.net"];
/** ActivityPub-federated instances known to the house; not exhaustive of the fediverse. */
const FEDIVERSE_HOSTS = [
  "mastodon.social", "mastodon.online", "fosstodon.org", "hachyderm.io",
  "mstdn.social", "universeodon.com", "mas.to", "mastodon.world",
  "pixelfed.social", "misskey.io", "kolektiva.social",
];
/** Conversational-agent surfaces that can appear as a referrer when an agent follows a link it was given. */
const AGENT_HOSTS = ["chatgpt.com", "chat.openai.com", "claude.ai", "perplexity.ai", "copilot.microsoft.com", "gemini.google.com"];

/**
 * @param {unknown} host
 * @returns {string} Lowercased host with a leading `www.` stripped, or `""` when not a usable string.
 */
function normalizeHost(host) {
  if (typeof host !== "string") return "";
  return host.trim().toLowerCase().replace(/^www\./, "");
}

/**
 * @param {string} host Already normalized (lowercase, no leading `www.`).
 * @param {string[]} domains
 * @returns {boolean} True when `host` equals a listed domain or is one of its subdomains.
 */
function hostMatches(host, domains) {
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/**
 * Classify a referrer host into the property's attention-source taxonomy.
 * @param {string|null|undefined} host Referrer hostname, or empty/absent for a direct visit.
 * @returns {"search"|"social"|"fediverse"|"direct"|"agent"|"other"}
 */
export function classifyReferrer(host) {
  const normalized = normalizeHost(host);
  if (normalized === "") return "direct";
  if (hostMatches(normalized, AGENT_HOSTS)) return "agent";
  if (hostMatches(normalized, SEARCH_HOSTS)) return "search";
  if (hostMatches(normalized, SOCIAL_HOSTS)) return "social";
  if (hostMatches(normalized, FEDIVERSE_HOSTS)) return "fediverse";
  return "other";
}

/**
 * @typedef {object} AnalyticsRow
 * @property {string} path Request path, e.g. `/technology/some-slug`.
 * @property {number} views Pageload event count for this path/referrer group.
 * @property {number} visits Distinct-visit count for this path/referrer group.
 * @property {string|null} referrerHost Referrer hostname, or null for direct.
 */

/**
 * @typedef {object} MeasureRefusal
 * @property {false} ok
 * @property {string} source One of "cloudflare-web-analytics", "house-ad-receipts".
 * @property {boolean} attempted Whether a network call was made.
 * @property {string} reason Machine-readable refusal, e.g. "missing-credential: ...".
 * @property {number} [httpStatus]
 */

/**
 * Fetch per-path, per-referrer pageload counts from Cloudflare's GraphQL
 * Analytics API (`rumPageloadEventsAdaptiveGroups`). Refuses, rather than
 * throwing, when the account, site tag, token, or date range is absent —
 * the caller decides whether an unconfigured analytics source sinks the
 * whole readout or just narrows it.
 * @param {object} input
 * @param {string} [input.accountId] Cloudflare account tag.
 * @param {string} [input.siteTag] Web Analytics site tag (not the zone tag).
 * @param {string} [input.token] API token with Account Analytics:Read.
 * @param {string} [input.since] ISO-8601 range start.
 * @param {string} [input.until] ISO-8601 range end.
 * @param {typeof fetch} [input.fetch] Injectable fetch.
 * @returns {Promise<{ok: true, source: string, attempted: true, rows: AnalyticsRow[]} | MeasureRefusal>}
 * @throws {TypeError} When configuration is present but `fetch` is not a function.
 */
export async function fetchCloudflareWebAnalytics({ accountId, siteTag, token, since, until, fetch: doFetch } = {}) {
  const source = "cloudflare-web-analytics";
  if (typeof accountId !== "string" || accountId.trim() === "") {
    return { ok: false, source, attempted: false, reason: "missing-config: Cloudflare accountId is not configured" };
  }
  if (typeof siteTag !== "string" || siteTag.trim() === "") {
    return { ok: false, source, attempted: false, reason: "missing-config: Web Analytics siteTag is not configured" };
  }
  if (typeof token !== "string" || token.trim() === "") {
    return { ok: false, source, attempted: false, reason: "missing-credential: Cloudflare API token is not configured" };
  }
  if (typeof since !== "string" || since.trim() === "" || typeof until !== "string" || until.trim() === "") {
    return { ok: false, source, attempted: false, reason: "missing-config: since and until ISO timestamps are required" };
  }
  if (typeof doFetch !== "function") throw new TypeError("fetchCloudflareWebAnalytics requires an injectable fetch");

  let response;
  try {
    response = await doFetch(CLOUDFLARE_GRAPHQL_URL, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8", authorization: `Bearer ${token}` },
      body: JSON.stringify({ query: WEB_ANALYTICS_QUERY, variables: { accountTag: accountId, siteTag, since, until } }),
    });
  } catch (error) {
    return { ok: false, source, attempted: true, reason: `network-error: ${error.message}` };
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    return { ok: false, source, attempted: true, reason: `invalid-json-response: ${error.message}`, httpStatus: response.status };
  }

  if (!response.ok) {
    return { ok: false, source, attempted: true, reason: `http-error-${response.status}`, httpStatus: response.status };
  }
  if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
    // A token missing the Analytics scope, or an unrecognized siteTag, surfaces here rather than as an HTTP error.
    return { ok: false, source, attempted: true, reason: `graphql-error: ${payload.errors.map((e) => e.message).join("; ")}` };
  }

  const groups = payload?.data?.viewer?.accounts?.[0]?.rumPageloadEventsAdaptiveGroups ?? [];
  const rows = groups.map((group) => ({
    path: group?.dimensions?.requestPath ?? "",
    views: Number(group?.count) || 0,
    visits: Number(group?.sum?.visits) || 0,
    referrerHost: group?.dimensions?.refererHost || null,
  }));
  return { ok: true, source, attempted: true, rows };
}

/**
 * Fetch the house ad server's delivery receipt chain (`GET /receipts`) and
 * narrow it to one property. v0 receipts (advertising-services-section)
 * carry `type`, `slot`, `property`, `creativeId`, and `occurredAt` — no
 * article slug and no USD amount, since the current catalog is entirely
 * house cross-promotion — so callers get receipt-true impression/click
 * counts, never a fabricated per-article revenue split.
 * @param {object} input
 * @param {string} [input.server] Ad server origin, e.g. property.monetization.houseAds.server.
 * @param {string} [input.property] Property key to keep (receipts for other properties are dropped).
 * @param {string} [input.since] ISO-8601 lower bound on `occurredAt`, inclusive.
 * @param {typeof fetch} [input.fetch] Injectable fetch.
 * @returns {Promise<{ok: true, source: string, attempted: true, receipts: object[]} | MeasureRefusal>}
 * @throws {TypeError} When `server` is present but `fetch` is not a function.
 */
export async function fetchHouseAdReceipts({ server, property, since, fetch: doFetch } = {}) {
  const source = "house-ad-receipts";
  if (typeof server !== "string" || server.trim() === "") {
    return { ok: false, source, attempted: false, reason: "missing-config: houseAds.server is not configured" };
  }
  if (typeof doFetch !== "function") throw new TypeError("fetchHouseAdReceipts requires an injectable fetch");

  const url = new URL("/receipts", server);
  url.searchParams.set("since", "0");

  let response;
  try {
    response = await doFetch(url.toString());
  } catch (error) {
    return { ok: false, source, attempted: true, reason: `network-error: ${error.message}` };
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    return { ok: false, source, attempted: true, reason: `invalid-json-response: ${error.message}`, httpStatus: response.status };
  }

  if (!response.ok) {
    const detail = typeof payload?.error === "string" ? `: ${payload.error}` : "";
    return { ok: false, source, attempted: true, reason: `receipts-refused${detail}`, httpStatus: response.status };
  }

  const entries = Array.isArray(payload?.entries) ? payload.entries : [];
  const receipts = entries.filter((entry) => {
    if (typeof property === "string" && property.trim() !== "" && entry?.property !== property) return false;
    if (typeof since === "string" && since.trim() !== "" && typeof entry?.occurredAt === "string" && entry.occurredAt < since) return false;
    return true;
  });
  return { ok: true, source, attempted: true, receipts };
}

/**
 * @typedef {object} SettlementCost
 * @property {string} lane
 * @property {string} provider
 * @property {number} usd
 */

/**
 * @typedef {object} SettlementArticle
 * @property {string} slug
 * @property {string} [section]
 * @property {SettlementCost[]} [costs]
 */

/**
 * @typedef {object} ArticleReadout
 * @property {string} slug
 * @property {string|null} section
 * @property {number} views
 * @property {number} revenueUsd
 * @property {number} costUsd
 * @property {number|null} viewsPerUsd `null` when costUsd is 0 (a free-lane article has no defined ratio).
 * @property {number} revenueMinusCost
 */

/**
 * Read the last non-empty segment of a request path as its article slug.
 * @param {unknown} path
 * @returns {string|null}
 */
function slugFromPath(path) {
  if (typeof path !== "string") return null;
  const trimmed = path.split("?")[0].split("#")[0].replace(/\/+$/, "");
  const segments = trimmed.split("/").filter((segment) => segment !== "");
  if (segments.length === 0) return null;
  let slug = segments[segments.length - 1].replace(/\.html?$/i, "");
  try {
    slug = decodeURIComponent(slug);
  } catch {
    // Malformed percent-encoding: keep the raw segment rather than throwing on a viewer's malformed request.
  }
  return slug === "" ? null : slug;
}

/**
 * Join per-path analytics rows and ad-receipt counts against one pulse's
 * settlement record to produce the property's EROEI readout: per-article
 * views against cost, per-section totals, and a property total.
 * @param {object} input
 * @param {AnalyticsRow[]} [input.views] Rows from {@link fetchCloudflareWebAnalytics}.
 * @param {object[]} [input.adReceipts] Receipts from {@link fetchHouseAdReceipts}.
 * @param {{published: SettlementArticle[]}} input.settlements The pulse's settlement record.
 * @returns {{
 *   articles: ArticleReadout[],
 *   sections: Array<{section: string, views: number, revenueUsd: number, costUsd: number, revenueMinusCost: number, articleCount: number}>,
 *   property: {views: number, revenueUsd: number, costUsd: number, revenueMinusCost: number, articleCount: number, sectionCount: number, unattributedViews: number, adImpressions: number, adClicks: number},
 * }}
 * @throws {TypeError} When `settlements.published` is not an array.
 */
export function eroeiReadout({ views = [], adReceipts = [], salesReceipts = [], salesGateway, settlements } = {}) {
  if (!settlements || !Array.isArray(settlements.published)) {
    throw new TypeError("eroeiReadout requires settlements.published as an array of {slug, section, costs[]}");
  }

  const bySlug = new Map();
  for (const entry of settlements.published) {
    if (!entry || typeof entry.slug !== "string" || entry.slug.trim() === "") continue;
    const costUsd = Array.isArray(entry.costs)
      ? entry.costs.reduce((sum, cost) => sum + (Number(cost?.usd) || 0), 0)
      : 0;
    bySlug.set(entry.slug, {
      slug: entry.slug,
      section: typeof entry.section === "string" ? entry.section : null,
      views: 0,
      costUsd,
      // No ad receipt today carries a per-article slug (see fetchHouseAdReceipts); revenue stays
      // receipt-true at 0 per article rather than an estimated pro-rata split of ad-receipt counts.
      revenueUsd: 0,
    });
  }

  let unattributedViews = 0;
  for (const row of Array.isArray(views) ? views : []) {
    const rowViews = Number(row?.views) || 0;
    const slug = slugFromPath(row?.path);
    const article = slug === null ? undefined : bySlug.get(slug);
    if (!article) {
      unattributedViews += rowViews;
      continue;
    }
    article.views += rowViews;
  }

  let adImpressions = 0;
  let adClicks = 0;
  for (const receipt of Array.isArray(adReceipts) ? adReceipts : []) {
    if (receipt?.type === "impression") adImpressions += 1;
    else if (receipt?.type === "click") adClicks += 1;
  }

  // A paid briefing is a property-level product, not an article impression.
  // Its x402 derivation supplies an observed USD amount; never turn a click,
  // a payment challenge, or an on-chain transfer lacking market attribution
  // into revenue here.
  const attributedSales = Array.isArray(salesReceipts) ? salesReceipts.filter((receipt) => (
    receipt && typeof receipt === "object"
    && (salesGateway === undefined || receipt.gateway === salesGateway)
    && Number.isFinite(Number(receipt.amountUsd))
    && Number(receipt.amountUsd) >= 0
  )) : [];
  const directSalesRevenueUsd = attributedSales.reduce((sum, receipt) => sum + Number(receipt.amountUsd), 0);

  const articles = [...bySlug.values()].map((article) => ({
    slug: article.slug,
    section: article.section,
    views: article.views,
    revenueUsd: article.revenueUsd,
    costUsd: article.costUsd,
    viewsPerUsd: article.costUsd > 0 ? article.views / article.costUsd : null,
    revenueMinusCost: article.revenueUsd - article.costUsd,
  }));

  const sectionMap = new Map();
  for (const article of articles) {
    const key = article.section ?? "unassigned";
    if (!sectionMap.has(key)) {
      sectionMap.set(key, { section: key, views: 0, revenueUsd: 0, costUsd: 0, articleCount: 0 });
    }
    const section = sectionMap.get(key);
    section.views += article.views;
    section.revenueUsd += article.revenueUsd;
    section.costUsd += article.costUsd;
    section.articleCount += 1;
  }
  const sections = [...sectionMap.values()].map((section) => ({ ...section, revenueMinusCost: section.revenueUsd - section.costUsd }));

  const propertyViews = articles.reduce((sum, article) => sum + article.views, 0);
  const propertyRevenueUsd = articles.reduce((sum, article) => sum + article.revenueUsd, 0) + directSalesRevenueUsd;
  const propertyCostUsd = articles.reduce((sum, article) => sum + article.costUsd, 0);

  return {
    articles,
    sections,
    property: {
      views: propertyViews,
      revenueUsd: propertyRevenueUsd,
      costUsd: propertyCostUsd,
      revenueMinusCost: propertyRevenueUsd - propertyCostUsd,
      articleCount: articles.length,
      sectionCount: sections.length,
      unattributedViews,
      adImpressions,
      adClicks,
      directSalesRevenueUsd,
      directSalesCount: attributedSales.length,
    },
  };
}

/**
 * Build the `/measure/most-read.json` module the home page reads.
 * @param {{articles: ArticleReadout[]}} readout From {@link eroeiReadout}.
 * @param {number} n Maximum items to return.
 * @param {object} [options]
 * @param {number|null} [options.windowDays] The measurement window's length in days, when known.
 * @returns {{kind: "news-property.most-read/v1", windowDays: number|null, items: Array<{slug: string, views: number}>}}
 * @throws {TypeError} When `readout.articles` is not an array.
 */
export function mostRead(readout, n, { windowDays = null } = {}) {
  if (!readout || !Array.isArray(readout.articles)) {
    throw new TypeError("mostRead requires a readout with an articles array");
  }
  const count = Number.isInteger(n) && n > 0 ? n : 0;
  const items = [...readout.articles]
    .sort((a, b) => b.views - a.views || String(a.slug).localeCompare(String(b.slug)))
    .slice(0, count)
    .map(({ slug, views }) => ({ slug, views }));
  return { kind: "news-property.most-read/v1", windowDays, items };
}
