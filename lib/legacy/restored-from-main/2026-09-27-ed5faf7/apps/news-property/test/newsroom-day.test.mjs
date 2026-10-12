import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { newsroomDayAnalyze as analyzeNewsroomDay } from "../src/newsroom-day.mjs";
import { purchaseClaimExtraction } from "../src/newsroom-day/claims.mjs";
import { pulseKnowledgeReadout } from "../src/newsroom-day/knowledge.mjs";
import { openHarnessLifecycleJournal, INFERENCE_PURCHASED_CATEGORY } from "@red-cup-engineering/agent-harness-computer-system-engineering-services-section";
import { createSemanticRecordJournal } from "@red-cup-engineering/computer-code-engineering-services-section/semiotic-eavt/record-semantic-record";
import { sourceArrivalFromObservation } from "@red-cup-engineering/communicating/messaging/newswire/source-arrival";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "fixtures", "newsroom-day");
const PACKAGE_ROOT = join(HERE, "..");

const PROPERTY = JSON.parse(readFileSync(join(FIXTURES, "property.json"), "utf8"));
const FEED_XML = {
  "https://a.example/feed-a1.xml": readFileSync(join(FIXTURES, "feed-a1.xml"), "utf8"),
  "https://a.example/feed-a2.xml": readFileSync(join(FIXTURES, "feed-a2.xml"), "utf8"),
  "https://b.example/feed-b1.xml": readFileSync(join(FIXTURES, "feed-b1.xml"), "utf8"),
};
const fixtureArrivalKeysByDataRoot = new Map();

function fetchStub() {
  return async (url) => {
    const text = FEED_XML[url];
    if (text === undefined) throw new Error(`fetch stub has no fixture for ${url}`);
    return { ok: true, status: 200, text: async () => text };
  };
}

// The test composes its fixture source provider before calling the property.
// Production newsroom-day receives this same carrier batch from Newscable;
// it does not acquire or parse feeds itself.
function xmlText(block, name) {
  return block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "iu"))?.[1]?.replace(/<[^>]+>/gu, " ").replace(/\\s+/gu, " ").trim() ?? "";
}
async function fixtureSourceArrivals({ property, houseFeedsPath, io, now }) {
  const configured = JSON.parse(readFileSync(houseFeedsPath, "utf8"));
  const directory = Array.isArray(configured) ? configured : configured.feeds;
  const wanted = new Set(property.sections.flatMap((section) => section.wires));
  const arrivals = [];
  for (const configuredFeed of directory.filter((feed) => wanted.has(feed.id))) {
    const response = await io.fetchImpl(configuredFeed.url);
    const xml = await response.text();
    for (const match of xml.matchAll(/<item[\s>][\s\S]*?<\/item>/giu)) {
      const block = match[0];
      const url = xmlText(block, "link");
      const title = xmlText(block, "title");
      if (!url || !title) continue;
      arrivals.push(sourceArrivalFromObservation({
        feed: { id: configuredFeed.id, url: configuredFeed.url, kind: configuredFeed.kind === "atom" ? "atom" : "rss" },
        item: { externalId: xmlText(block, "guid") || url, url, title, ...(xmlText(block, "description") ? { summary: xmlText(block, "description") } : {}), ...(xmlText(block, "pubDate") ? { published: new Date(xmlText(block, "pubDate")).toISOString() } : {}) },
        observedAt: now.toISOString(),
      }));
    }
  }
  return arrivals;
}
async function newsroomDayAnalyze(options) {
  const candidates = options.sourceArrivals ?? await fixtureSourceArrivals(options);
  const seen = fixtureArrivalKeysByDataRoot.get(options.dataRoot) ?? new Set();
  const sourceArrivals = candidates.filter((arrival) => {
    const key = arrival.data.deduplicationKey;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  fixtureArrivalKeysByDataRoot.set(options.dataRoot, seen);
  return analyzeNewsroomDay({
    ...options,
    sourceArrivals,
  });
}

function tmpDataRoot(label) {
  return mkdtempSync(join(tmpdir(), `newsroom-day-${label}-`));
}

const WILDFIRE_A_URL = "https://a.example/stories/wildfire-valley";
const WILDFIRE_B_URL = "https://b.example/news/valley-wildfire";
const RAIL_URL = "https://a.example/other/rail-line-approved";
const BUDGET_URL = "https://a.example/other/budget-vote-delayed";

/**
 * A stub `purchase` matching `purchaseClaimExtraction`'s own return shape,
 * keyed by the source item's URL (known from the fixtures) rather than its
 * EAVT-constituted story id (which is a computed digest unknown ahead of
 * the intake run).
 */
function stubPurchase({ claimsByUrl = {}, priceByUrl = {}, refuseUrls = new Set() }) {
  return async (item) => {
    if (refuseUrls.has(item.url)) {
      // Provider delivered (and was still paid), but the customer-owned
      // domain assay rejected the content -- distinct from a total market
      // refusal, which never reaches purchaseClaimExtraction's assay step
      // and carries no candidate at all.
      return {
        admitted: false, item, provider: "urn:ame:test-provider", model: "test-model", durationMs: 10,
        outcome: "candidate-pending-claude-acceptance",
        candidate: { claims: claimsByUrl[item.url] ?? [] },
        assay: { accepted: false, problems: ["/claims/0:grounding:not-present-in-cited-evidence"] },
        price: priceByUrl[item.url] ?? { denomination: { kind: "credit", asset: "urn:union:consideration:provider-invocation", unit: "provider-invocation" }, amount: { numerator: "1", denominator: "1" } },
        exchangeId: `stub:${item.url}`, workLotId: `urn:work-lot:knowledge-vault:stub-${item.id}`,
      };
    }
    const claims = claimsByUrl[item.url] ?? [];
    return {
      admitted: true,
      item,
      provider: "urn:ame:test-provider",
      model: "test-model",
      durationMs: 100,
      outcome: "candidate-pending-claude-acceptance",
      candidate: { claims },
      price: priceByUrl[item.url] ?? { denomination: { kind: "credit", asset: "urn:union:consideration:provider-invocation", unit: "provider-invocation" }, amount: { numerator: "1", denominator: "1" } },
      exchangeId: `stub:${item.url}`,
      workLotId: `urn:work-lot:knowledge-vault:stub-${item.id}`,
    };
  };
}

function fullQuoteClaim({ subject, predicate, object, text }) {
  return { subject, predicate, object, quote: text };
}

test("newsroomDayAnalyze: intake is unseen-only across two runs against the same data root", async () => {
  const dataRoot = tmpDataRoot("unseen-only");
  const purchase = stubPurchase({});
  const first = await newsroomDayAnalyze({
    property: PROPERTY, dataRoot, now: new Date("2026-09-03T06:30:00Z"),
    houseFeedsPath: join(FIXTURES, "house-feeds.json"),
    io: { fetchImpl: fetchStub() },
    purchase,
  });
  assert.equal(first.intake.itemsFresh, 4);
  const second = await newsroomDayAnalyze({
    property: PROPERTY, dataRoot, now: new Date("2026-09-03T06:40:00Z"),
    houseFeedsPath: join(FIXTURES, "house-feeds.json"),
    io: { fetchImpl: fetchStub() },
    purchase,
  });
  assert.equal(second.intake.itemsFresh, 0);
  assert.equal(second.selection.storiesSelected, 0);
  rmSync(dataRoot, { recursive: true, force: true });
});

test("newsroomDayAnalyze: corroboration accumulated across two pulses satisfies the two-source rule once", async () => {
  const dataRoot = tmpDataRoot("two-pulse-corroboration");
  const property = {
    ...PROPERTY,
    sections: [{ ...PROPERTY.sections[0], wires: ["feed-a1", "feed-b1"], minimumIndependentSources: 2 }],
  };
  const emptyFeed = "<?xml version=\"1.0\" encoding=\"UTF-8\"?><rss version=\"2.0\"><channel><title>Empty</title></channel></rss>";
  let pulse = 1;
  const fetchImpl = async (url) => ({
    ok: true,
    status: 200,
    text: async () => url === "https://a.example/feed-a1.xml"
      ? FEED_XML[url]
      : pulse === 1 ? emptyFeed : FEED_XML[url],
  });
  const purchased = [];
  const purchase = async (item) => {
    purchased.push(item);
    return stubPurchase({})(item);
  };

  const first = await newsroomDayAnalyze({
    property, dataRoot, now: new Date("2026-09-03T06:30:00Z"),
    houseFeedsPath: join(FIXTURES, "house-feeds.json"),
    io: { fetchImpl },
    purchase,
  });
  assert.equal(first.intake.itemsFresh, 1);
  assert.equal(first.selection.storiesSelected, 0);
  assert.deepEqual(purchased, []);

  pulse = 2;
  const second = await newsroomDayAnalyze({
    property, dataRoot, now: new Date("2026-09-03T06:40:00Z"),
    houseFeedsPath: join(FIXTURES, "house-feeds.json"),
    io: { fetchImpl },
    purchase,
  });
  assert.equal(second.intake.itemsFresh, 1);
  assert.equal(second.selection.storiesSelected, 1);
  assert.deepEqual(new Set(purchased.map((item) => item.host)), new Set(["a.example", "b.example"]));
  assert.equal(purchased.length, 2);

  pulse = 3;
  const third = await newsroomDayAnalyze({
    property, dataRoot, now: new Date("2026-09-03T06:50:00Z"),
    houseFeedsPath: join(FIXTURES, "house-feeds.json"),
    io: { fetchImpl },
    purchase,
  });
  assert.equal(third.intake.itemsFresh, 0);
  assert.equal(third.selection.storiesSelected, 0);
  assert.equal(purchased.length, 2);

  const laterWildfire = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Example Wire B</title><item>
  <title>Wildfire spreads across valley overnight in new flare-up</title>
  <link>https://b.example/news/valley-wildfire-update</link>
  <guid>https://b.example/news/valley-wildfire-update</guid>
  <pubDate>Fri, 04 Sep 2026 07:00:00 GMT</pubDate>
  <description>Crews reported a new wildfire flare-up across the valley overnight.</description>
</item></channel></rss>`;
  const laterFetchImpl = async (url) => ({
    ok: true,
    status: 200,
    text: async () => url === "https://a.example/feed-a1.xml" ? FEED_XML[url] : laterWildfire,
  });
  const later = await newsroomDayAnalyze({
    property, dataRoot, now: new Date("2026-09-04T07:10:00Z"),
    houseFeedsPath: join(FIXTURES, "house-feeds.json"),
    io: { fetchImpl: laterFetchImpl },
    purchase,
  });
  assert.equal(later.intake.itemsFresh, 1);
  assert.equal(later.selection.storiesSelected, 0);
  assert.equal(purchased.length, 2);

  rmSync(dataRoot, { recursive: true, force: true });
});

test("purchaseClaimExtraction: the assay rejects a schema-valid structured claim whose quote does not reproduce the source", async () => {
  const item = { id: "urn:test:story:1", title: "Wildfire spreads", summary: "The wildfire grew overnight near the valley.", url: WILDFIRE_A_URL };
  const dispatch = async () => ({
    outcome: "candidate-pending-claude-acceptance",
    provider: "urn:ame:test-provider", model: "test-model", durationMs: 5,
    consideration: [{ kind: "credit", asset: "urn:union:consideration:provider-invocation", unit: "provider-invocation", amount: { numerator: "1", denominator: "1" } }],
    candidate: { claims: [{ subject: "wildfire", predicate: "grew", object: "overnight", quote: "wrong" }] },
  });
  const result = await purchaseClaimExtraction(item, { dispatch });
  assert.equal(result.admitted, false);
  assert.deepEqual(result.candidate.claims, []);
});

test("purchaseClaimExtraction: structured claims are source-addressed and admitted without text parsing", async () => {
  const item = { id: "urn:test:story:1", title: "Wildfire spreads", summary: "The wildfire grew overnight near the valley.", url: WILDFIRE_A_URL };
  const dispatch = async () => ({
    outcome: "candidate-pending-claude-acceptance",
    provider: "urn:ame:test-provider", model: "test-model", durationMs: 5,
    consideration: [{ kind: "credit", asset: "urn:union:consideration:provider-invocation", unit: "provider-invocation", amount: { numerator: "1", denominator: "1" } }],
    candidate: { claims: [{ subject: "wildfire", predicate: "grew", object: "overnight", quote: "The wildfire grew overnight" }] },
  });
  const result = await purchaseClaimExtraction(item, { dispatch });
  assert.equal(result.admitted, true);
  assert.equal(result.candidate.claims.length, 1);
  assert.equal(result.candidate.claims[0].quote, "The wildfire grew overnight");
  assert.equal(result.candidate.claims[0].start, 0);
});

test("purchaseClaimExtraction: the customer assay still refuses a located quote that does not ground the claimed subject or object", async () => {
  const item = { id: "urn:test:story:1", title: "Wildfire spreads", summary: "The wildfire grew overnight near the valley.", url: WILDFIRE_A_URL };
  const dispatch = async () => ({
    outcome: "candidate-pending-claude-acceptance",
    provider: "urn:ame:test-provider", model: "test-model", durationMs: 5,
    consideration: [{ kind: "credit", asset: "urn:union:consideration:provider-invocation", unit: "provider-invocation", amount: { numerator: "1", denominator: "1" } }],
    // A real, locatable quote -- but naming a subject the quote never says.
    candidate: { claims: [{ subject: "budget council", predicate: "postponed", object: "its vote", quote: "near the valley" }] },
  });
  const result = await purchaseClaimExtraction(item, { dispatch });
  assert.equal(result.admitted, false);
  assert.equal(result.assay.problems.some((problem) => problem.includes("grounding")), true);
});

test("newsroomDayAnalyze: distinct sourced values yield one source-divergence observation, not a FOUR contradiction", async () => {
  const dataRoot = tmpDataRoot("contradiction");
  const wildfireAText = "Officials say the wildfire that broke out near the valley late Tuesday grew overnight from unknown causes, prompting evacuation orders for three towns.";
  const wildfireBText = "Emergency crews began evacuating residents after the wildfire, which officials say was caused by a downed power line, spread rapidly overnight.";
  const railText = "The regional transit authority voted unanimously to approve construction of a new light rail line connecting downtown to the airport.";
  const budgetText = "The city council postponed its vote on the annual budget after members said they needed more time to review proposed cuts.";
  const claimsByUrl = {
    [WILDFIRE_A_URL]: [fullQuoteClaim({ subject: "wildfire", predicate: "was caused by", object: "unknown causes", text: wildfireAText })],
    [WILDFIRE_B_URL]: [fullQuoteClaim({ subject: "wildfire", predicate: "was caused by", object: "a downed power line", text: wildfireBText })],
    [RAIL_URL]: [fullQuoteClaim({ subject: "regional transit authority", predicate: "approved", object: "a new light rail line", text: railText })],
    [BUDGET_URL]: [fullQuoteClaim({ subject: "city council", predicate: "postponed", object: "its vote on the annual budget", text: budgetText })],
  };
  const priceByUrl = {
    [WILDFIRE_A_URL]: { denomination: { kind: "credit", asset: "urn:union:consideration:provider-invocation", unit: "provider-invocation" }, amount: { numerator: "1", denominator: "1" } },
    [WILDFIRE_B_URL]: { denomination: { kind: "credit", asset: "urn:union:consideration:provider-invocation", unit: "provider-invocation" }, amount: { numerator: "2", denominator: "1" } },
  };
  const result = await newsroomDayAnalyze({
    property: PROPERTY, dataRoot, now: new Date("2026-09-03T06:30:00Z"),
    houseFeedsPath: join(FIXTURES, "house-feeds.json"),
    io: { fetchImpl: fetchStub() },
    purchase: stubPurchase({ claimsByUrl, priceByUrl, refuseUrls: new Set([BUDGET_URL]) }),
  });

  assert.equal(result.intake.itemsFresh, 4);
  assert.equal(result.selection.storiesSelected, 3);
  assert.equal(result.claims.sourceDivergences, 1);
  assert.equal(result.claims.admitted, 3);
  assert.equal(result.claims.refused, 1);

  rmSync(dataRoot, { recursive: true, force: true });
});

test("purchaseClaimExtraction: pipe-delimited provider prose is refused rather than parsed", async () => {
  const item = { id: "urn:test:story:1", title: "Kernel settles claims", summary: "The kernel settles bilattice claims exactly. It never fuses truth and knowledge orders.", url: WILDFIRE_A_URL };
  const dispatch = async () => ({
    outcome: "candidate-pending-claude-acceptance",
    provider: "urn:ame:test-provider", model: "test-model", durationMs: 5,
    consideration: [{ kind: "credit", asset: "urn:union:consideration:provider-invocation", unit: "provider-invocation", amount: { numerator: "1", denominator: "1" } }],
    candidate: `kernel | settles | bilattice claims | "kernel settles bilattice claims exactly"`,
  });
  const result = await purchaseClaimExtraction(item, { dispatch });
  assert.equal(result.admitted, false);
  assert.deepEqual(result.candidate.claims, []);
  assert.equal(result.assay.problems.some((problem) => problem.includes("type")), true);
});

test("purchaseClaimExtraction: a schema-capable-provider refusal is returned without a text fallback", async () => {
  const item = { id: "urn:test:story:1", title: "Kernel settles claims", summary: "The kernel settles bilattice claims exactly.", url: WILDFIRE_A_URL };
  const refusal = { outcome: "no-admissible-provider-offer", provider: null, model: null, refusedOffers: [{ provider: "urn:ame:text-only", reason: "missing-required-capability" }] };
  const result = await purchaseClaimExtraction(item, { dispatch: async () => refusal });
  assert.equal(result.admitted, false);
  assert.equal(result.refusal, refusal);
  assert.equal(Object.hasOwn(result, "candidate"), false);
});

test("pulseKnowledgeReadout: distinct positive values preserve their exact cells without fabricated denial WITs", () => {
  const claims = [
    { host: "a.example", subject: "wildfire", predicate: "was caused by", object: "unknown causes" },
    { host: "b.example", subject: "wildfire", predicate: "was caused by", object: "a downed power line" },
    { host: "a.example", subject: "regional transit authority", predicate: "approved", object: "a new light rail line" },
    { host: "b.example", subject: "regional transit authority", predicate: "approved", object: "a new light rail line" },
  ];
  const cost = { denomination: { kind: "credit", asset: "urn:union:consideration:provider-invocation", unit: "provider-invocation" }, amount: { numerator: "6", denominator: "1" } };
  const readout = pulseKnowledgeReadout(claims, cost);
  // Four host/cell assertions are admitted. Different positive wildfire
  // values are distinct exact cells, not refutations of each other.
  assert.equal(readout.witsAsserted, 4);
  assert.equal(readout.witsDerived, 0);
  assert.equal(readout.wits, 4);
  assert.equal(readout.heldTops, 0);
  assert.equal(readout.totalAttributes, 3);
  assert.equal(readout.moltenFraction, 0);
  assert.equal(readout.obstructions, 0);
  assert.equal(readout.disagreementEnergy, 0);
  assert.ok(Math.abs(readout.spectralGap - 1) < 1e-6, `spectralGap ${readout.spectralGap} should be ~1`);
  assert.deepEqual(readout.costPerWit, { numerator: "6", denominator: "4" });
});

test("pulseKnowledgeReadout: no admitted claims settles to a degenerate zero readout with no division by zero", () => {
  const readout = pulseKnowledgeReadout([], { denomination: null, amount: { numerator: "0", denominator: "1" } });
  assert.deepEqual(readout, { wits: 0, witsAsserted: 0, witsDerived: 0, heldTops: 0, totalAttributes: 0, moltenFraction: 0, obstructions: 0, disagreementEnergy: 0, spectralGap: 0, costPerWit: null });
});

test("pulseKnowledgeReadout: N single-source claims on distinct topics each set exactly one asserted bit -- witsAsserted equals N with nothing left for settle() to derive", () => {
  const claims = Array.from({ length: 15 }, (_, i) => ({
    host: `host${i}.example`, subject: `topic${i}`, predicate: "reports", object: `value${i}`,
  }));
  const cost = { denomination: { kind: "credit", asset: "urn:union:consideration:provider-invocation", unit: "provider-invocation" }, amount: { numerator: "14", denominator: "1" } };
  const readout = pulseKnowledgeReadout(claims, cost);
  // The regression this readout must not repeat: cold-red-gate's first
  // production pulse admitted 15 single-source claims on 14 provider
  // invocations and reported wits: 0, costPerWit: null.
  assert.equal(readout.witsAsserted, 15);
  assert.equal(readout.witsDerived, 0);
  assert.equal(readout.wits, 15);
  assert.equal(readout.heldTops, 0);
  assert.equal(readout.totalAttributes, 15);
  assert.deepEqual(readout.costPerWit, { numerator: "14", denominator: "15" });
});

test("pulseKnowledgeReadout: distinct values sharing a normalized topic never synthesize denials", () => {
  const claims = [
    { host: "a.example", subject: "wildfire", predicate: "was caused by", object: "unknown causes" },
    { host: "b.example", subject: "wildfire", predicate: "was caused by", object: "a downed power line" },
  ];
  const readout = pulseKnowledgeReadout(claims, { denomination: null, amount: { numerator: "0", denominator: "1" } });
  assert.equal(readout.witsAsserted, 2);
  assert.equal(readout.witsDerived, 0);
  assert.equal(readout.wits, 2);
  assert.equal(readout.heldTops, 0);
  assert.equal(readout.totalAttributes, 2);
  assert.equal(readout.moltenFraction, 0);
});

test("newsroomDayAnalyze: the settlement record's per-story cost equals the sum of that story's receipts", async () => {
  const dataRoot = tmpDataRoot("settlement-cost");
  const harnessRoot = tmpDataRoot("harness-lifecycle");
  const wildfireAText = "Officials say the wildfire that broke out near the valley late Tuesday grew overnight from unknown causes, prompting evacuation orders for three towns.";
  const wildfireBText = "Emergency crews began evacuating residents after the wildfire, which officials say was caused by a downed power line, spread rapidly overnight.";
  const railText = "The regional transit authority voted unanimously to approve construction of a new light rail line connecting downtown to the airport.";
  const budgetText = "The city council postponed its vote on the annual budget after members said they needed more time to review proposed cuts.";
  const claimsByUrl = {
    [WILDFIRE_A_URL]: [fullQuoteClaim({ subject: "wildfire", predicate: "was caused by", object: "unknown causes", text: wildfireAText })],
    [WILDFIRE_B_URL]: [fullQuoteClaim({ subject: "wildfire", predicate: "was caused by", object: "a downed power line", text: wildfireBText })],
    [RAIL_URL]: [fullQuoteClaim({ subject: "regional transit authority", predicate: "approved", object: "a new light rail line", text: railText })],
    [BUDGET_URL]: [fullQuoteClaim({ subject: "city council", predicate: "postponed", object: "its vote on the annual budget", text: budgetText })],
  };
  const priceByUrl = {
    [WILDFIRE_A_URL]: { denomination: { kind: "credit", asset: "urn:union:consideration:provider-invocation", unit: "provider-invocation" }, amount: { numerator: "1", denominator: "1" } },
    [WILDFIRE_B_URL]: { denomination: { kind: "credit", asset: "urn:union:consideration:provider-invocation", unit: "provider-invocation" }, amount: { numerator: "2", denominator: "1" } },
    [RAIL_URL]: { denomination: { kind: "credit", asset: "urn:union:consideration:provider-invocation", unit: "provider-invocation" }, amount: { numerator: "1", denominator: "1" } },
    [BUDGET_URL]: { denomination: { kind: "credit", asset: "urn:union:consideration:provider-invocation", unit: "provider-invocation" }, amount: { numerator: "3", denominator: "1" } },
  };
  const result = await newsroomDayAnalyze({
    property: PROPERTY, dataRoot, now: new Date("2026-09-03T06:30:00Z"),
    houseFeedsPath: join(FIXTURES, "house-feeds.json"),
    io: { fetchImpl: fetchStub() },
    purchase: stubPurchase({ claimsByUrl, priceByUrl, refuseUrls: new Set([BUDGET_URL]) }),
    harnessLifecycleRoot: harnessRoot,
    turnId: "test-turn",
  });

  // wildfire story drew two receipted purchases (1 + 2 = 3); rail drew one (1);
  // budget drew one (3) even though its own domain assay refused the content
  // -- the provider still delivered and was still paid.
  assert.equal(result.consideration.amount.numerator, "7");
  assert.equal(result.consideration.amount.denominator, "1");

  const purchases = openHarnessLifecycleJournal({ root: harnessRoot }).query({ category: INFERENCE_PURCHASED_CATEGORY });
  assert.equal(purchases.length, 4); // wildfire A, wildfire B, rail, budget -- every delivered exchange is receipted regardless of the customer-owned assay's later disposition.
  const total = purchases.reduce((sum, row) => sum + Number(row.record.price.amount.numerator), 0);
  assert.equal(total, 7);

  rmSync(dataRoot, { recursive: true, force: true });
  rmSync(harnessRoot, { recursive: true, force: true });
});

test("newsroomDayAnalyze: nothing is written under the package directory", async () => {
  const before = new Set();
  const collect = (dir, into) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) collect(path, into);
      else into.add(path);
    }
  };
  collect(PACKAGE_ROOT, before);

  const dataRoot = tmpDataRoot("no-checkout-writes");
  const harnessRoot = tmpDataRoot("no-checkout-writes-harness");
  await newsroomDayAnalyze({
    property: PROPERTY, dataRoot, now: new Date("2026-09-03T06:30:00Z"),
    houseFeedsPath: join(FIXTURES, "house-feeds.json"),
    io: { fetchImpl: fetchStub() },
    purchase: stubPurchase({ claimsByUrl: { [WILDFIRE_A_URL]: [fullQuoteClaim({ subject: "wildfire", predicate: "grew", object: "overnight", text: "The wildfire grew overnight." })] } }),
    harnessLifecycleRoot: harnessRoot,
    turnId: "test-turn",
  });

  const after = new Set();
  collect(PACKAGE_ROOT, after);
  assert.deepEqual([...after].filter((path) => !before.has(path)), []);

  rmSync(dataRoot, { recursive: true, force: true });
  rmSync(harnessRoot, { recursive: true, force: true });
});

const USD_PRICE = Object.freeze({ denomination: { kind: "fiat", asset: "usd", unit: "usd" }, amount: { numerator: "1", denominator: "1" } });

test("newsroomDayAnalyze: cadence.frontierBudgetUsdPerDay stops purchasing once cumulative USD-denominated spend reaches the ceiling, and records exactly one refusal datum", async () => {
  const dataRoot = tmpDataRoot("budget-ceiling");
  const budgetedProperty = { ...PROPERTY, cadence: { frontierBudgetUsdPerDay: 2 } };
  const wildfireAText = "Officials say the wildfire that broke out near the valley late Tuesday grew overnight from unknown causes, prompting evacuation orders for three towns.";
  const wildfireBText = "Emergency crews began evacuating residents after the wildfire, which officials say was caused by a downed power line, spread rapidly overnight.";
  const railText = "The regional transit authority voted unanimously to approve construction of a new light rail line connecting downtown to the airport.";
  const budgetText = "The city council postponed its vote on the annual budget after members said they needed more time to review proposed cuts.";
  const claimsByUrl = {
    [WILDFIRE_A_URL]: [fullQuoteClaim({ subject: "wildfire", predicate: "was caused by", object: "unknown causes", text: wildfireAText })],
    [WILDFIRE_B_URL]: [fullQuoteClaim({ subject: "wildfire", predicate: "was caused by", object: "a downed power line", text: wildfireBText })],
    [RAIL_URL]: [fullQuoteClaim({ subject: "regional transit authority", predicate: "approved", object: "a new light rail line", text: railText })],
    [BUDGET_URL]: [fullQuoteClaim({ subject: "city council", predicate: "postponed", object: "its vote on the annual budget", text: budgetText })],
  };
  // Every one of the four candidate purchases prices at exactly $1 USD, so
  // with a ceiling of $2 exactly two purchases are ever attempted --
  // regardless of which two stories selection orders first -- and the
  // other two source items are skipped without ever calling `purchase`.
  const priceByUrl = Object.fromEntries([WILDFIRE_A_URL, WILDFIRE_B_URL, RAIL_URL, BUDGET_URL].map((url) => [url, USD_PRICE]));
  let purchaseCalls = 0;
  const countingPurchase = stubPurchase({ claimsByUrl, priceByUrl });
  const result = await newsroomDayAnalyze({
    property: budgetedProperty, dataRoot, now: new Date("2026-09-03T06:30:00Z"),
    houseFeedsPath: join(FIXTURES, "house-feeds.json"),
    io: { fetchImpl: fetchStub() },
    purchase: (...args) => { purchaseCalls += 1; return countingPurchase(...args); },
  });

  assert.equal(result.intake.itemsFresh, 4);
  assert.equal(purchaseCalls, 2);
  assert.equal(result.claims.purchaseCount, 2);
  assert.equal(result.budget.ceiling, 2);
  assert.equal(result.budget.unpricedPurchases, 0);
  assert.equal(result.budget.refusals.length, 1);
  assert.deepEqual(result.budget.refusals[0], {
    kind: "newsroom-day.budget-ceiling",
    ceiling: 2,
    spent: { numerator: "2", denominator: "1" },
    unit: "usd",
  });
  const refusals = createSemanticRecordJournal({ root: dataRoot, objectKind: "red-cup-engineering.news-property-newsroom-day.v1" }).query({ category: "budget-refusal" });
  assert.equal(refusals.length, 2);
  assert.deepEqual(refusals[0].record, {
    type: "NewsPropertyBudgetRefusal", version: 1,
    pulseId: result.pulseId,
    item: { id: refusals[0].record.item.id, url: refusals[0].record.item.url },
    workLotId: null, exchangeId: null,
    policy: "frontier-budget-usd-ceiling", ceiling: 2,
    spent: { numerator: "2", denominator: "1" }, unit: "usd",
    skipReason: "usd-budget-ceiling-reached", providerTransportAttempted: false,
  });

  rmSync(dataRoot, { recursive: true, force: true });
});

test("newsroomDayAnalyze: free-lane refusal is durable operational evidence, not a zero-priced purchase or claim", async () => {
  const dataRoot = tmpDataRoot("free-lane-refusal");
  const result = await newsroomDayAnalyze({
    property: { ...PROPERTY, cadence: { ...PROPERTY.cadence, freeLaneOnly: true } }, dataRoot, now: new Date("2026-09-03T06:30:00Z"), maxStories: 1, maxSourcesPerStory: 1,
    houseFeedsPath: join(FIXTURES, "house-feeds.json"), io: { fetchImpl: fetchStub() },
    purchase: async (item, options) => {
      assert.equal(options.freeLaneOnly, true);
      return {
        admitted: false, item, provider: null, model: null, durationMs: 0,
        outcome: "no-admissible-provider-offer", workLotId: "urn:work-lot:fixture", exchangeId: "urn:exchange:fixture",
        refusal: { directLaneRefusals: [{ provider: "urn:ame:paid-provider", reason: "zero-cash-entitlement-not-admitted" }] },
      };
    },
  });

  const refusals = createSemanticRecordJournal({ root: dataRoot, objectKind: "red-cup-engineering.news-property-newsroom-day.v1" }).query({ category: "budget-refusal" });
  assert.equal(refusals.length, 1);
  assert.equal(refusals[0].record.pulseId, result.pulseId);
  assert.equal(refusals[0].record.policy, "free-lane-only");
  assert.equal(refusals[0].record.workLotId, "urn:work-lot:fixture");
  assert.equal(refusals[0].record.exchangeId, "urn:exchange:fixture");
  assert.equal(refusals[0].record.providerTransportAttempted, false);
  assert.equal(Object.hasOwn(refusals[0].record, "price"), false);
  assert.equal(result.claims.admitted, 0);
  assert.equal(result.consideration.amount.numerator, "0");
  rmSync(dataRoot, { recursive: true, force: true });
});

test("newsroomDayAnalyze: with no cadence.frontierBudgetUsdPerDay configured, budget.ceiling is null and no purchase is ever skipped", async () => {
  const dataRoot = tmpDataRoot("budget-unconfigured");
  const result = await newsroomDayAnalyze({
    property: PROPERTY, dataRoot, now: new Date("2026-09-03T06:30:00Z"),
    houseFeedsPath: join(FIXTURES, "house-feeds.json"),
    io: { fetchImpl: fetchStub() },
    purchase: stubPurchase({}),
  });
  assert.equal(result.budget.ceiling, null);
  assert.deepEqual(result.budget.refusals, []);
  // Every stub purchase prices in credits, not USD -- none count toward a
  // (here unconfigured) dollar ceiling; all land in unpricedPurchases.
  assert.equal(result.budget.unpricedPurchases, result.claims.purchaseCount);
  rmSync(dataRoot, { recursive: true, force: true });
});

test("newsroomDayAnalyze: the koios shape -- a $0/day ceiling with every purchase priced in credits (never USD) never trips, and every purchase is counted unpriced", async () => {
  const dataRoot = tmpDataRoot("budget-zero-credits-only");
  const zeroBudgetProperty = { ...PROPERTY, cadence: { frontierBudgetUsdPerDay: 0, freeLaneOnly: true } };
  let purchaseCalls = 0;
  const freeLanePolicies = [];
  const countingPurchase = stubPurchase({});
  const result = await newsroomDayAnalyze({
    property: zeroBudgetProperty, dataRoot, now: new Date("2026-09-03T06:30:00Z"),
    houseFeedsPath: join(FIXTURES, "house-feeds.json"),
    io: { fetchImpl: fetchStub() },
    purchase: (item, options) => { purchaseCalls += 1; freeLanePolicies.push(options.freeLaneOnly); return countingPurchase(item, options); },
  });

  assert.equal(result.intake.itemsFresh, 4);
  assert.equal(purchaseCalls, 4); // nothing skipped despite the $0 ceiling: no purchase ever priced in USD.
  assert.equal(result.budget.ceiling, 0);
  assert.deepEqual(result.budget.refusals, []);
  assert.equal(result.budget.unpricedPurchases, 4);
  assert.deepEqual(freeLanePolicies, [true, true, true, true]);

  rmSync(dataRoot, { recursive: true, force: true });
});

test("newsroom-day CLI: run through a symlink with no args exits non-zero with one-line usage on stderr", () => {
  const linkDir = tmpDataRoot("cli-symlink");
  const linkPath = join(linkDir, "newsroom-day.mjs");
  symlinkSync(join(PACKAGE_ROOT, "src", "newsroom-day.mjs"), linkPath);

  const result = spawnSync(process.execPath, [linkPath], { encoding: "utf8" });

  assert.notEqual(result.status, 0);
  assert.equal(result.status, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /^usage: newsroom-day /);

  rmSync(linkDir, { recursive: true, force: true });
});
