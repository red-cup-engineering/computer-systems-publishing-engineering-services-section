/**
 * Newsroom-day settlement: writes admitted claim rows and source-divergence
 * observations through the semantic-record-journal, and one pulse
 * settlement record per run naming the claims admitted, the provider that
 * answered, and the exact consideration price per story, plus the pulse's
 * predicated-inference-kernel knowledge readout.
 */
import { pulseKnowledgeReadout } from "./knowledge.mjs";

const ZERO_AMOUNT = Object.freeze({ numerator: "0", denominator: "1" });

/**
 * Records one admitted claim as a SEAVT row told for and not against: `told:
 * { for: true, against: false }` (ordinary asserted evidence), `relation:
 * {subject, predicate, object}`.
 * @param {ReturnType<import("@red-cup-engineering/computer-code-engineering-services-section/semiotic-eavt/record-semantic-record").createSemanticRecordJournal>} journal
 * @param {{storyId: string, section: string, host: string, sourceUrl: string, subject: string, predicate: string, object: string, quote: string, provider: string|null}} claim
 * @param {string} recordedAt
 * @returns {object} the journal's record result.
 */
export function recordClaim(journal, claim, recordedAt) {
  return journal.record({
    category: "claim",
    record: { type: "NewsPropertyClaim", version: 1, ...claim },
    recordedAt,
    told: { for: true, against: false },
    relation: { subject: claim.subject, predicate: claim.predicate, object: claim.object },
  });
}

/**
 * Records one observed source divergence. Different positive values alone
 * are not a FOUR contradiction: no source has supplied a refutation of an
 * exact claim cell, so this remains ordinary asserted observation.
 * @param {ReturnType<import("@red-cup-engineering/computer-code-engineering-services-section/semiotic-eavt/record-semantic-record").createSemanticRecordJournal>} journal
 * @param {{subject: string, predicate: string, conflictingObjects: string[], sources: object[]}} divergence
 * @param {string} recordedAt
 * @returns {object} the journal's record result.
 */
export function recordSourceDivergence(journal, divergence, recordedAt) {
  return journal.record({
    category: "source-divergence",
    record: { type: "NewsPropertySourceDivergence", version: 1, ...divergence },
    recordedAt,
    told: { for: true, against: false },
    relation: { subject: divergence.subject, predicate: "reports-divergent-values", object: divergence.conflictingObjects },
  });
}

/**
 * Records an operational refusal to spend a pulse's inference budget. This
 * is not ClaimEvidence and never represents a purchase: it records the
 * policy decision and its unattempted transport boundary without inventing
 * a zero-valued consideration amount.
 * @param {ReturnType<import("@red-cup-engineering/computer-code-engineering-services-section/semiotic-eavt/record-semantic-record").createSemanticRecordJournal>} journal
 * @param {{pulseId: string, item: {id: string, url: string}, workLotId: string|null, exchangeId: string|null, policy: string, ceiling: number|null, spent: {numerator: string, denominator: string}|null, unit: string|null, skipReason: string, providerTransportAttempted: false, laneRefusals?: {provider: string, reason: string}[]}} refusal
 * @param {string} recordedAt
 * @returns {object} the journal's record result.
 */
export function recordBudgetRefusal(journal, refusal, recordedAt) {
  return journal.record({
    category: "budget-refusal",
    record: { type: "NewsPropertyBudgetRefusal", version: 1, ...refusal },
    recordedAt,
    told: { for: true, against: false },
    relation: { subject: refusal.pulseId, predicate: "budget-refused-item", object: refusal.item.id },
  });
}

function addAmount(left, right) {
  const denominator = BigInt(left.denominator) * BigInt(right.denominator);
  const numerator = BigInt(left.numerator) * BigInt(right.denominator) + BigInt(right.numerator) * BigInt(left.denominator);
  return { numerator: numerator.toString(), denominator: denominator.toString() };
}

/**
 * Sums a set of purchase prices sharing one denomination into one exact
 * fraction amount; throws if the set mixes denominations (a per-story cost
 * must stay in one asset to be summed honestly).
 * @param {{denomination: {kind: string, asset: string, unit: string}, amount: {numerator: string, denominator: string}}[]} prices
 * @returns {{denomination: object|null, amount: {numerator: string, denominator: string}}}
 */
export function totalPrice(prices) {
  if (prices.length === 0) return { denomination: null, amount: ZERO_AMOUNT };
  const denomination = prices[0].denomination;
  for (const price of prices) {
    if (price.denomination.kind !== denomination.kind || price.denomination.asset !== denomination.asset || price.denomination.unit !== denomination.unit) {
      throw new Error("totalPrice: cannot sum purchase prices across mixed denominations");
    }
  }
  return { denomination, amount: prices.reduce((sum, price) => addAmount(sum, price.amount), ZERO_AMOUNT) };
}

/**
 * Sums one pulse's purchases for token accounting, reported beside
 * `witsAsserted`/`witsDerived`/`wits` in the settlement's `knowledge`
 * readout so cost per WIT is computable downstream once real
 * token-denominated pricing exists (`purchaseClaimExtraction`'s own `usage`
 * field, threaded from the provider's reported token counts). A purchase
 * with no provider-reported usage contributes to `purchasesWithoutUsage`
 * only -- its absence never pads a sum with a fabricated `0`.
 * @param {{usage?: {promptTokens: number|null, outputTokens: number|null, totalTokens: number|null}|null}[]} purchases
 * @returns {{purchasesWithUsage: number, purchasesWithoutUsage: number, promptTokens: number|null, outputTokens: number|null, totalTokens: number|null}}
 */
export function purchaseUsageSummary(purchases) {
  const withUsage = purchases.filter((purchase) => purchase.usage);
  const sum = (field) => {
    const values = withUsage.map((purchase) => purchase.usage[field]).filter((value) => Number.isInteger(value));
    return values.length === 0 ? null : values.reduce((total, value) => total + value, 0);
  };
  return {
    purchasesWithUsage: withUsage.length,
    purchasesWithoutUsage: purchases.length - withUsage.length,
    promptTokens: sum("promptTokens"),
    outputTokens: sum("outputTokens"),
    totalTokens: sum("totalTokens"),
  };
}

/**
 * Builds and records one pulse settlement record: per-story claims
 * admitted/refused, the provider(s) that answered, and the exact cost per
 * story (the sum of that story's own purchase receipts) plus pulse totals.
 * @param {ReturnType<import("@red-cup-engineering/computer-code-engineering-services-section/semiotic-eavt/record-semantic-record").createSemanticRecordJournal>} journal
 * @param {object} input
 * @param {string} input.propertyId
 * @param {string} input.pulseId
 * @param {string} input.stage
 * @param {string} input.recordedAt
 * @param {{storyId: string, section: string, purchases: object[], claimsAdmitted: number, claimsRefused: number}[]} input.stories
 * @param {{subject: string, predicate: string}[]} input.sourceDivergences
 * @param {{host: string, subject: string, predicate: string, object: string}[]} [input.claims] - admitted claim rows for the kernel readout; defaults to empty (no knowledge instrument).
 * @returns {object} `{record, id}` -- the built settlement record and the journal's record result id.
 */
export function recordPulseSettlement(journal, { propertyId, pulseId, stage, recordedAt, stories, sourceDivergences, claims = [] }) {
  const storyRows = stories.map((story) => {
    const priced = story.purchases.filter((purchase) => purchase.price);
    return {
      storyId: story.storyId,
      section: story.section,
      claimsAdmitted: story.claimsAdmitted,
      claimsRefused: story.claimsRefused,
      providers: [...new Set(story.purchases.map((purchase) => purchase.provider).filter(Boolean))],
      cost: totalPrice(priced.map((purchase) => purchase.price)),
      purchaseCount: story.purchases.length,
    };
  });
  const totals = {
    storiesIntaken: stories.length,
    claimsAdmitted: storyRows.reduce((sum, story) => sum + story.claimsAdmitted, 0),
    claimsRefused: storyRows.reduce((sum, story) => sum + story.claimsRefused, 0),
    sourceDivergences: sourceDivergences.length,
    purchaseCount: storyRows.reduce((sum, story) => sum + story.purchaseCount, 0),
    cost: totalPrice(storyRows.flatMap((story) => (story.cost.denomination ? [story.cost] : []))),
  };
  const knowledge = { ...pulseKnowledgeReadout(claims, totals.cost), ...purchaseUsageSummary(stories.flatMap((story) => story.purchases)) };
  const record = { type: "NewsPropertyPulseSettlement", version: 1, propertyId, pulseId, stage, stories: storyRows, totals, knowledge };
  const result = journal.record({
    category: "pulse-settlement",
    record,
    recordedAt,
    told: { for: true, against: false },
    relation: { subject: propertyId, predicate: "settled-pulse", object: pulseId },
  });
  return { record, id: result.id };
}
