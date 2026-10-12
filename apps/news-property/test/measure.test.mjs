import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyReferrer,
  fetchCloudflareWebAnalytics,
  fetchHouseAdReceipts,
  eroeiReadout,
  mostRead,
} from "../src/measure.mjs";

/**
 * A minimal fetch-shaped Response for fakes.
 * @param {object} input
 * @param {number} [input.status]
 * @param {object} [input.json]
 * @returns {{ok: boolean, status: number, json: () => Promise<object>}}
 */
function fakeResponse({ status = 200, json = {} } = {}) {
  return { ok: status >= 200 && status < 300, status, json: async () => json };
}

/** A fetch fake that must never be called; fails the test if it is. */
function unreachableFetch() {
  return async (...args) => {
    throw new Error(`fetch must not be called, was called with ${JSON.stringify(args[0])}`);
  };
}

// -- classifyReferrer -------------------------------------------------------

test("classifyReferrer: search hosts", () => {
  assert.equal(classifyReferrer("google.com"), "search");
  assert.equal(classifyReferrer("www.google.com"), "search");
  assert.equal(classifyReferrer("bing.com"), "search");
  assert.equal(classifyReferrer("duckduckgo.com"), "search");
  assert.equal(classifyReferrer("search.yahoo.com"), "search");
});

test("classifyReferrer: social hosts", () => {
  assert.equal(classifyReferrer("x.com"), "social");
  assert.equal(classifyReferrer("t.co"), "social");
  assert.equal(classifyReferrer("www.facebook.com"), "social");
  assert.equal(classifyReferrer("old.reddit.com"), "social");
  assert.equal(classifyReferrer("bsky.app"), "social");
  assert.equal(classifyReferrer("threads.net"), "social");
});

test("classifyReferrer: fediverse hosts", () => {
  assert.equal(classifyReferrer("mastodon.social"), "fediverse");
  assert.equal(classifyReferrer("hachyderm.io"), "fediverse");
});

test("classifyReferrer: agent hosts", () => {
  assert.equal(classifyReferrer("chatgpt.com"), "agent");
  assert.equal(classifyReferrer("claude.ai"), "agent");
  assert.equal(classifyReferrer("perplexity.ai"), "agent");
});

test("classifyReferrer: empty or absent host is direct", () => {
  assert.equal(classifyReferrer(null), "direct");
  assert.equal(classifyReferrer(undefined), "direct");
  assert.equal(classifyReferrer(""), "direct");
  assert.equal(classifyReferrer("   "), "direct");
});

test("classifyReferrer: unrecognized host is other", () => {
  assert.equal(classifyReferrer("some-random-blog.example"), "other");
});

test("classifyReferrer: case-insensitive", () => {
  assert.equal(classifyReferrer("GOOGLE.COM"), "search");
});

// -- fetchCloudflareWebAnalytics: refusals -----------------------------------

test("fetchCloudflareWebAnalytics: refuses without calling fetch when accountId is missing", async () => {
  const result = await fetchCloudflareWebAnalytics({
    siteTag: "site-tag", token: "tok", since: "2026-08-01T00:00:00Z", until: "2026-08-02T00:00:00Z",
    fetch: unreachableFetch(),
  });
  assert.equal(result.ok, false);
  assert.equal(result.attempted, false);
  assert.match(result.reason, /missing-config/);
});

test("fetchCloudflareWebAnalytics: refuses without calling fetch when siteTag is missing", async () => {
  const result = await fetchCloudflareWebAnalytics({
    accountId: "acct", token: "tok", since: "2026-08-01T00:00:00Z", until: "2026-08-02T00:00:00Z",
    fetch: unreachableFetch(),
  });
  assert.equal(result.ok, false);
  assert.equal(result.attempted, false);
});

test("fetchCloudflareWebAnalytics: refuses without calling fetch when token is missing", async () => {
  const result = await fetchCloudflareWebAnalytics({
    accountId: "acct", siteTag: "site-tag", since: "2026-08-01T00:00:00Z", until: "2026-08-02T00:00:00Z",
    fetch: unreachableFetch(),
  });
  assert.equal(result.ok, false);
  assert.equal(result.attempted, false);
  assert.match(result.reason, /missing-credential/);
});

test("fetchCloudflareWebAnalytics: refuses without calling fetch when since/until are missing", async () => {
  const result = await fetchCloudflareWebAnalytics({ accountId: "acct", siteTag: "site-tag", token: "tok", fetch: unreachableFetch() });
  assert.equal(result.ok, false);
  assert.equal(result.attempted, false);
});

test("fetchCloudflareWebAnalytics: throws when configured but fetch is not a function", async () => {
  await assert.rejects(
    () => fetchCloudflareWebAnalytics({ accountId: "acct", siteTag: "site-tag", token: "tok", since: "2026-08-01T00:00:00Z", until: "2026-08-02T00:00:00Z" }),
    TypeError,
  );
});

// -- fetchCloudflareWebAnalytics: request shape and parsing ------------------

test("fetchCloudflareWebAnalytics: GraphQL request shape against a fake fetch", async () => {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    return fakeResponse({
      status: 200,
      json: {
        data: {
          viewer: {
            accounts: [{
              rumPageloadEventsAdaptiveGroups: [
                { count: 100, sum: { visits: 80 }, dimensions: { requestPath: "/world/some-slug", refererHost: "google.com" } },
                { count: 40, sum: { visits: 35 }, dimensions: { requestPath: "/world/some-slug", refererHost: null } },
              ],
            }],
          },
        },
      },
    });
  };

  const result = await fetchCloudflareWebAnalytics({
    accountId: "acct-1", siteTag: "site-1", token: "secret-token",
    since: "2026-08-01T00:00:00Z", until: "2026-08-08T00:00:00Z", fetch,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.cloudflare.com/client/v4/graphql");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers.authorization, "Bearer secret-token");
  const body = JSON.parse(calls[0].options.body);
  assert.match(body.query, /rumPageloadEventsAdaptiveGroups/);
  assert.match(body.query, /requestPath/);
  assert.match(body.query, /refererHost/);
  assert.deepEqual(body.variables, { accountTag: "acct-1", siteTag: "site-1", since: "2026-08-01T00:00:00Z", until: "2026-08-08T00:00:00Z" });

  assert.equal(result.ok, true);
  assert.deepEqual(result.rows, [
    { path: "/world/some-slug", views: 100, visits: 80, referrerHost: "google.com" },
    { path: "/world/some-slug", views: 40, visits: 35, referrerHost: null },
  ]);
});

test("fetchCloudflareWebAnalytics: refuses on non-ok HTTP status", async () => {
  const fetch = async () => fakeResponse({ status: 403, json: { errors: [{ message: "not authorized" }] } });
  const result = await fetchCloudflareWebAnalytics({
    accountId: "acct", siteTag: "site", token: "tok", since: "2026-08-01T00:00:00Z", until: "2026-08-02T00:00:00Z", fetch,
  });
  assert.equal(result.ok, false);
  assert.equal(result.attempted, true);
  assert.equal(result.httpStatus, 403);
});

test("fetchCloudflareWebAnalytics: refuses on a GraphQL errors array (missing scope)", async () => {
  const fetch = async () => fakeResponse({ status: 200, json: { errors: [{ message: "unauthorized: missing analytics scope" }] } });
  const result = await fetchCloudflareWebAnalytics({
    accountId: "acct", siteTag: "site", token: "tok", since: "2026-08-01T00:00:00Z", until: "2026-08-02T00:00:00Z", fetch,
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /graphql-error/);
  assert.match(result.reason, /missing analytics scope/);
});

// -- fetchHouseAdReceipts -----------------------------------------------------

test("fetchHouseAdReceipts: refuses without calling fetch when server is missing", async () => {
  const result = await fetchHouseAdReceipts({ property: "koios-news", fetch: unreachableFetch() });
  assert.equal(result.ok, false);
  assert.equal(result.attempted, false);
  assert.match(result.reason, /missing-config/);
});

test("fetchHouseAdReceipts: throws when server is configured but fetch is not a function", async () => {
  await assert.rejects(() => fetchHouseAdReceipts({ server: "https://ads.example" }), TypeError);
});

test("fetchHouseAdReceipts: request shape against a fake fetch, filters by property and since", async () => {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    return fakeResponse({
      status: 200,
      json: {
        head: { seq: 2, id: "ni:///sha-256;zzz" },
        entries: [
          { seq: 0, id: "ni:///sha-256;a", type: "impression", slot: "header", property: "koios-news", creativeId: "c1", occurredAt: "2026-07-30T00:00:00Z" },
          { seq: 1, id: "ni:///sha-256;b", type: "click", slot: "header", property: "koios-news", creativeId: "c1", occurredAt: "2026-08-02T00:00:00Z" },
          { seq: 2, id: "ni:///sha-256;c", type: "impression", slot: "footer", property: "play-561-group", creativeId: "c2", occurredAt: "2026-08-02T00:00:00Z" },
        ],
      },
    });
  };

  const result = await fetchHouseAdReceipts({ server: "https://house-ads.example", property: "koios-news", since: "2026-08-01T00:00:00Z", fetch });

  assert.equal(calls.length, 1);
  assert.equal(calls[0], "https://house-ads.example/receipts?since=0");
  assert.equal(result.ok, true);
  assert.equal(result.receipts.length, 1);
  assert.equal(result.receipts[0].id, "ni:///sha-256;b");
});

test("fetchHouseAdReceipts: refuses when the receipt chain is not bound (503)", async () => {
  const fetch = async () => fakeResponse({ status: 503, json: { error: "receipt chain not bound" } });
  const result = await fetchHouseAdReceipts({ server: "https://house-ads.example", property: "koios-news", fetch });
  assert.equal(result.ok, false);
  assert.equal(result.attempted, true);
  assert.match(result.reason, /receipt chain not bound/);
});

// -- eroeiReadout: join arithmetic --------------------------------------------

function settlementsFixture() {
  return {
    published: [
      { slug: "world-story", section: "world", costs: [{ lane: "free", provider: "groq", usd: 0 }] },
      { slug: "tech-story", section: "technology", costs: [{ lane: "frontier", provider: "anthropic", usd: 0.5 }, { lane: "free", provider: "gemini", usd: 0 }] },
      { slug: "no-views-story", section: "world", costs: [{ lane: "free", provider: "groq", usd: 0 }] },
    ],
  };
}

test("eroeiReadout: sums views per slug from multiple referrer rows, computes cost/viewsPerUsd/revenueMinusCost", () => {
  const views = [
    { path: "/world/world-story", views: 100, visits: 90, referrerHost: "google.com" },
    { path: "/world/world-story/", views: 25, visits: 20, referrerHost: null },
    { path: "/technology/tech-story", views: 200, visits: 150, referrerHost: "mastodon.social" },
  ];
  const readout = eroeiReadout({ views, adReceipts: [], settlements: settlementsFixture() });

  const world = readout.articles.find((a) => a.slug === "world-story");
  assert.equal(world.views, 125);
  assert.equal(world.costUsd, 0);
  assert.equal(world.viewsPerUsd, null); // free-lane article: cost is 0, ratio is undefined

  const tech = readout.articles.find((a) => a.slug === "tech-story");
  assert.equal(tech.views, 200);
  assert.equal(tech.costUsd, 0.5);
  assert.equal(tech.viewsPerUsd, 400); // 200 views / 0.5 usd
  assert.equal(tech.revenueUsd, 0);
  assert.equal(tech.revenueMinusCost, -0.5);

  const noViews = readout.articles.find((a) => a.slug === "no-views-story");
  assert.equal(noViews.views, 0);
});

test("eroeiReadout: unmatched analytics rows count toward unattributedViews, not any article", () => {
  const views = [
    { path: "/world/world-story", views: 10, visits: 10, referrerHost: null },
    { path: "/world/unknown-slug-not-in-settlement", views: 999, visits: 999, referrerHost: null },
  ];
  const readout = eroeiReadout({ views, adReceipts: [], settlements: settlementsFixture() });
  assert.equal(readout.property.unattributedViews, 999);
  assert.equal(readout.property.views, 10);
});

test("eroeiReadout: section totals aggregate their articles", () => {
  const views = [
    { path: "/world/world-story", views: 10, visits: 10, referrerHost: null },
    { path: "/technology/tech-story", views: 200, visits: 150, referrerHost: null },
  ];
  const readout = eroeiReadout({ views, adReceipts: [], settlements: settlementsFixture() });
  const world = readout.sections.find((s) => s.section === "world");
  assert.equal(world.views, 10);
  assert.equal(world.articleCount, 2); // world-story and no-views-story
  const tech = readout.sections.find((s) => s.section === "technology");
  assert.equal(tech.views, 200);
  assert.equal(tech.costUsd, 0.5);
});

test("eroeiReadout: property total sums across sections and counts ad receipts by type", () => {
  const views = [
    { path: "/world/world-story", views: 10, visits: 10, referrerHost: null },
    { path: "/technology/tech-story", views: 200, visits: 150, referrerHost: null },
  ];
  const adReceipts = [
    { type: "impression", slot: "header", property: "koios-news" },
    { type: "impression", slot: "footer", property: "koios-news" },
    { type: "click", slot: "header", property: "koios-news" },
  ];
  const readout = eroeiReadout({ views, adReceipts, settlements: settlementsFixture() });
  assert.equal(readout.property.views, 210);
  assert.equal(readout.property.articleCount, 3);
  assert.equal(readout.property.sectionCount, 2);
  assert.equal(readout.property.costUsd, 0.5);
  assert.equal(readout.property.adImpressions, 2);
  assert.equal(readout.property.adClicks, 1);
  // No ad receipt carries a per-article slug, so revenue stays receipt-true at 0 rather than estimated.
  assert.equal(readout.property.revenueUsd, 0);
});

test("eroeiReadout: throws when settlements.published is not an array", () => {
  assert.throws(() => eroeiReadout({ views: [], adReceipts: [], settlements: {} }), TypeError);
});

// -- mostRead -----------------------------------------------------------------

test("mostRead: sorts descending by views, breaks ties by slug, slices to n", () => {
  const readout = {
    articles: [
      { slug: "b-story", section: "world", views: 50, revenueUsd: 0, costUsd: 0, viewsPerUsd: null, revenueMinusCost: 0 },
      { slug: "a-story", section: "world", views: 50, revenueUsd: 0, costUsd: 0, viewsPerUsd: null, revenueMinusCost: 0 },
      { slug: "c-story", section: "world", views: 500, revenueUsd: 0, costUsd: 0, viewsPerUsd: null, revenueMinusCost: 0 },
      { slug: "d-story", section: "world", views: 1, revenueUsd: 0, costUsd: 0, viewsPerUsd: null, revenueMinusCost: 0 },
    ],
  };
  const result = mostRead(readout, 3, { windowDays: 7 });
  assert.deepEqual(result, {
    kind: "news-property.most-read/v1",
    windowDays: 7,
    items: [
      { slug: "c-story", views: 500 },
      { slug: "a-story", views: 50 },
      { slug: "b-story", views: 50 },
    ],
  });
});

test("mostRead: defaults windowDays to null and n to empty when not a positive integer", () => {
  const readout = { articles: [{ slug: "only", section: "world", views: 10, revenueUsd: 0, costUsd: 0, viewsPerUsd: null, revenueMinusCost: 0 }] };
  assert.deepEqual(mostRead(readout, 0), { kind: "news-property.most-read/v1", windowDays: null, items: [] });
});

test("mostRead: throws when readout.articles is not an array", () => {
  assert.throws(() => mostRead({}, 5), TypeError);
});
