#!/usr/bin/env node
/** `newsroom-day` analyze stage: intake, selection, claim extraction, settlement (spec §4.2). */
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { createSemanticRecordJournal } from "@red-cup-engineering/computer-code-engineering-services-section/semiotic-eavt/record-semantic-record";
import { argument } from "@red-cup-engineering/javascript-node-services-section/argv";
import { loadHouseFeeds, resolveSectionWires, projectArrivalsToEavt, readCurrentStoriesFromEavt } from "./newsroom-day/intake.mjs";
import { selectStories } from "./newsroom-day/selection.mjs";
import { purchaseClaimExtraction as purchaseClaimExtractionDefault, recordPurchaseReceipt as recordPurchaseReceiptDefault, claimRows, detectSourceDivergences } from "./newsroom-day/claims.mjs";
import { recordBudgetRefusal, recordClaim, recordSourceDivergence, recordPulseSettlement, totalPrice } from "./newsroom-day/settlement.mjs";

/**
 * Scale factor from one documented USD `unit` to whole dollars.
 * @type {Record<string, bigint>}
 */
const USD_UNIT_SCALE = Object.freeze({ usd: 1n, dollar: 1n, dollars: 1n, cent: 100n, cents: 100n, "micro-usd": 1_000_000n });

/**
 * True for a dollar consideration this rail documents; a flat
 * per-invocation credit is not. See derive-inference-pnl.test.mjs:11 and
 * decide-work-placement.test.mjs for the two accepted shapes.
 * @param {{kind: string, asset: string, unit: string}|null|undefined} denomination
 * @returns {boolean}
 */
function isUsdDenomination(denomination) {
  const asset = typeof denomination?.asset === "string" ? denomination.asset.toLowerCase() : "";
  const unit = typeof denomination?.unit === "string" ? denomination.unit.toLowerCase() : "";
  return (asset === "usd" || asset === "urn:currency:usd") && Object.hasOwn(USD_UNIT_SCALE, unit);
}

/**
 * Converts one USD price to an exact whole-dollars fraction, so different
 * recognized USD units sum exactly via `totalPrice`.
 * @param {{denomination: {unit: string}, amount: {numerator: string, denominator: string}}} price
 * @returns {{denomination: {kind: "fiat", asset: "usd", unit: "usd"}, amount: {numerator: string, denominator: string}}}
 */
function toWholeDollarPrice(price) {
  const scale = USD_UNIT_SCALE[price.denomination.unit.toLowerCase()];
  return {
    denomination: { kind: "fiat", asset: "usd", unit: "usd" },
    amount: { numerator: price.amount.numerator, denominator: (BigInt(price.amount.denominator) * scale).toString() },
  };
}

/**
 * Default data root: outside the git checkout, per house law -- a running
 * process never writes into the repository tree.
 * @param {string} propertyId
 * @returns {string}
 */
export function defaultDataRoot(propertyId) {
  return join(homedir(), ".local", "state", "561-group", "news-property", propertyId);
}

/**
 * Runs one newsroom-day analyze pulse: intake, selection, claim extraction
 * with receipts, and one pulse settlement record.
 * @param {object} options
 * @param {object} options.property - the property record (spec §3).
 * @param {string} options.dataRoot - never inside the git checkout.
 * @param {Date} [options.now]
 * @param {number} [options.maxStories] - global cap across every section (e.g. the live-gate cap).
 * @param {number} [options.maxSourcesPerStory] - bounds how many corroborating items in one cluster are bought, for cost control.
 * @param {number} [options.maximumClaimsPerStory]
 * @param {string} options.houseFeedsPath - broker-owned directory supplied at this composition boundary.
 * @param {object[]} options.sourceArrivals - broker-admitted source arrivals; this app never polls feeds.
 * @param {Function} [options.purchase] - injected in tests; defaults to the real market purchase.
 * @param {Function} [options.recordReceipt] - injected in tests; defaults to the real harness-lifecycle receipt writer.
 * @param {string} [options.harnessLifecycleRoot] - when omitted, purchase receipts are not recorded (tests may omit it deliberately).
 * @param {string} [options.turnId]
 * @param {Function} [options.createJournal] - injected in tests; defaults to `createSemanticRecordJournal`.
 * @returns {Promise<object>} the JSON summary: intake/selection/claim/settlement counts, the frontier-budget readout, and the settlement record path coordinates.
 */
export async function newsroomDayAnalyze({
  property,
  dataRoot,
  now = new Date(),
  maxStories = Infinity,
  maxSourcesPerStory = 4,
  maximumClaimsPerStory = 6,
  houseFeedsPath,
  sourceArrivals,
  purchase = purchaseClaimExtractionDefault,
  recordReceipt = recordPurchaseReceiptDefault,
  harnessLifecycleRoot,
  turnId = randomUUID(),
  createJournal = createSemanticRecordJournal,
}) {
  const propertyId = property.name;
  if (!houseFeedsPath) throw new TypeError("newsroom-day requires a feed directory path");
  if (!Array.isArray(sourceArrivals)) throw new TypeError("newsroom-day requires broker-admitted source arrivals");
  const houseFeeds = loadHouseFeeds(houseFeedsPath);
  const { sectionByFeedId } = resolveSectionWires(property, houseFeeds);
  const eavtPath = join(dataRoot, "state", "stories.eavt");
  const projectedStories = projectArrivalsToEavt(sourceArrivals, eavtPath, sectionByFeedId);

  const nowMs = now.getTime();
  const stories = readCurrentStoriesFromEavt({ eavtPath, sectionByFeedId, nowMs });
  const freshStoryIds = new Set(projectedStories.map((story) => story.id));
  const selected = selectStories({ stories, property, nowMs, maxStories, requiredStoryIds: freshStoryIds });

  const journal = createJournal({ root: dataRoot, objectKind: "red-cup-engineering.news-property-newsroom-day.v1" });
  const recordedAt = now.toISOString();
  const pulseId = `${propertyId}:${recordedAt}`;

  // The property policy maps directly to inference-dispatch's typed
  // `zeroCashOnly` contract. That owner rejects non-free endpoint lanes
  // before transport and never opens the paid A2A market for this lot.
  const freeLaneOnly = property.cadence?.freeLaneOnly === true;

  // `cadence.frontierBudgetUsdPerDay` (spec §3) caps only USD-denominated
  // spend this pulse (`isUsdDenomination`); a null ceiling runs uncapped.
  const frontierBudgetCeiling = property.cadence?.frontierBudgetUsdPerDay ?? null;
  const spentPrices = []; // USD-denominated purchase prices only.
  const budgetRefusals = [];
  let unpricedPurchases = 0;

  const allClaims = [];
  const storySettlements = [];
  const providersAnswered = [];
  for (const { slug, cluster } of selected) {
    const storyId = [...cluster.items].map((item) => item.id).sort()[0];
    const sourceItems = [...cluster.items].sort((left, right) => left.id.localeCompare(right.id)).slice(0, maxSourcesPerStory);
    const purchases = [];
    for (const item of sourceItems) {
      // Gate only once real USD evidence exists (`spentPrices.length > 0`)
      // -- otherwise a ceiling of 0 (koios's live config) would trip before
      // any purchase ran, blocking free-lane purchases that never spend a
      // real dollar at all.
      if (frontierBudgetCeiling !== null && spentPrices.length > 0) {
        const spentSoFar = totalPrice(spentPrices);
        const spentNumber = Number(spentSoFar.amount.numerator) / Number(spentSoFar.amount.denominator);
        if (spentNumber >= frontierBudgetCeiling) {
          if (budgetRefusals.length === 0) {
            budgetRefusals.push({ kind: "newsroom-day.budget-ceiling", ceiling: frontierBudgetCeiling, spent: spentSoFar.amount, unit: spentSoFar.denomination?.unit ?? null });
          }
          recordBudgetRefusal(journal, {
            pulseId,
            item: { id: item.id, url: item.url },
            workLotId: null,
            exchangeId: null,
            policy: "frontier-budget-usd-ceiling",
            ceiling: frontierBudgetCeiling,
            spent: spentSoFar.amount,
            unit: spentSoFar.denomination?.unit ?? null,
            skipReason: "usd-budget-ceiling-reached",
            providerTransportAttempted: false,
          }, recordedAt);
          continue;
        }
      }
      const result = await purchase(item, { maximumClaims: maximumClaimsPerStory, freeLaneOnly });
      purchases.push(result);
      const laneRefusals = result.refusal?.directLaneRefusals;
      if (freeLaneOnly && Array.isArray(laneRefusals) && laneRefusals.length > 0) {
        recordBudgetRefusal(journal, {
          pulseId,
          item: { id: item.id, url: item.url },
          workLotId: result.workLotId ?? null,
          exchangeId: result.exchangeId ?? null,
          policy: "free-lane-only",
          ceiling: frontierBudgetCeiling,
          spent: null,
          unit: null,
          skipReason: "zero-cash-entitlement-not-admitted",
          providerTransportAttempted: false,
          laneRefusals: laneRefusals.map(({ provider, reason }) => ({ provider, reason })),
        }, recordedAt);
      }
      if (result.price && isUsdDenomination(result.price.denomination)) spentPrices.push(toWholeDollarPrice(result.price));
      else unpricedPurchases += 1;
      if (result.provider) providersAnswered.push({ provider: result.provider, model: result.model, durationMs: result.durationMs, admitted: result.admitted });
      if (harnessLifecycleRoot) recordReceipt(result, { root: harnessLifecycleRoot, turnId });
      const rows = claimRows(result, { storyId, section: slug });
      allClaims.push(...rows);
    }
    const claimsAdmitted = purchases.filter((purchase_) => purchase_.admitted).reduce((sum, purchase_) => sum + purchase_.candidate.claims.length, 0);
    const claimsRefused = purchases.filter((purchase_) => !purchase_.admitted && purchase_.candidate).reduce((sum, purchase_) => sum + purchase_.candidate.claims.length, 0);
    storySettlements.push({ storyId, section: slug, purchases, claimsAdmitted, claimsRefused });
  }

  for (const claim of allClaims) recordClaim(journal, claim, recordedAt);
  const sourceDivergences = detectSourceDivergences(allClaims);
  for (const divergence of sourceDivergences) recordSourceDivergence(journal, divergence, recordedAt);

  const settlement = recordPulseSettlement(journal, {
    propertyId, pulseId, stage: "analyze", recordedAt,
    stories: storySettlements, sourceDivergences, claims: allClaims,
  });

  return {
    stage: "analyze",
    propertyId,
    pulseId,
    dataRoot,
    intake: { arrivalsReceived: sourceArrivals.length, itemsFresh: sourceArrivals.length, storiesProjected: projectedStories.length },
    selection: { storiesSelected: selected.length, sections: [...new Set(selected.map(({ slug }) => slug))] },
    claims: {
      admitted: settlement.record.totals.claimsAdmitted,
      refused: settlement.record.totals.claimsRefused,
      sourceDivergences: sourceDivergences.length,
      purchaseCount: settlement.record.totals.purchaseCount,
    },
    providers: providersAnswered,
    consideration: settlement.record.totals.cost,
    knowledge: settlement.record.knowledge,
    budget: { ceiling: frontierBudgetCeiling, refusals: budgetRefusals, unpricedPurchases },
    settlementRecordId: settlement.id,
  };
}

const USAGE = "usage: newsroom-day --property <path> --data-root <dir> --house-feeds <path> --source-arrivals <path> [--stage analyze] [--max-stories <n>] [--max-sources-per-story <n>]";

/**
 * Thrown for a mis-wired invocation (missing/unknown --stage, missing
 * --property, no args) so the CLI entry point can distinguish it from a
 * runtime failure and exit 2 with a one-line usage message.
 */
export class NewsroomDayUsageError extends Error {}

/**
 * CLI entry: `--property <path> --data-root <dir> [--stage analyze]
 * [--max-stories <n>] [--max-sources-per-story <n>]
 * [--harness-lifecycle-root <dir>] [--turn <id>] [--house-feeds <path>]`.
 * @param {string[]} argv
 * @returns {Promise<object>}
 * @throws {NewsroomDayUsageError} for an unknown --stage or a missing --property
 */
export async function newsroomDayCli(argv) {
  const stage = argument("--stage", argv) ?? "analyze";
  if (stage !== "analyze") throw new NewsroomDayUsageError(`newsroom-day: unknown --stage "${stage}" (only "analyze" is built) -- ${USAGE}`);
  const propertyPath = argument("--property", argv);
  const houseFeedsPath = argument("--house-feeds", argv);
  const sourceArrivalsPath = argument("--source-arrivals", argv);
  if (!propertyPath || !houseFeedsPath || !sourceArrivalsPath) throw new NewsroomDayUsageError(USAGE);
  const property = JSON.parse(readFileSync(resolve(propertyPath), "utf8"));
  const dataRoot = resolve(argument("--data-root", argv) ?? defaultDataRoot(property.name));
  const maxStoriesArg = argument("--max-stories", argv);
  const maxSourcesArg = argument("--max-sources-per-story", argv);
  return newsroomDayAnalyze({
    property,
    dataRoot,
    ...(maxStoriesArg ? { maxStories: Number(maxStoriesArg) } : {}),
    ...(maxSourcesArg ? { maxSourcesPerStory: Number(maxSourcesArg) } : {}),
    houseFeedsPath: resolve(houseFeedsPath),
    sourceArrivals: JSON.parse(readFileSync(resolve(sourceArrivalsPath), "utf8")),
    harnessLifecycleRoot: argument("--harness-lifecycle-root", argv) ?? process.env.HARNESS_LIFECYCLE_ROOT,
    turnId: argument("--turn", argv) ?? process.env.HARNESS_LIFECYCLE_TURN ?? randomUUID(),
  });
}

/**
 * True when this module was invoked directly as the process entry point,
 * including through a symlink (an npm bin shim, a release symlink) -- a
 * plain string compare against process.argv[1] fails for those and
 * silently no-ops instead.
 * @returns {boolean}
 */
function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return fileURLToPath(import.meta.url) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  newsroomDayCli(process.argv.slice(2))
    .then((result) => { process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); })
    .catch((error) => {
      if (error instanceof NewsroomDayUsageError) {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 2;
      } else {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
      }
    });
}
