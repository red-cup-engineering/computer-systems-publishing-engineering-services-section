/**
 * Newsroom-day claim extraction: buy a claim-extraction work lot on the
 * internal inference market for one story item, assay the candidate against
 * the work lot's own closed schema and evidence law, and hold cross-source
 * contradictions as FOUR ⊤ (both support and refutation charged) rather
 * than resolving them by vote.
 */
import { randomUUID } from "node:crypto";
import { formKnowledgeVaultWorkLot, assayKnowledgeVaultCandidate } from "@red-cup-engineering/computer-inference-engine/dispatch/knowledge-vault-work-lots";
import { dispatchInferenceAsConfiguredCustomer } from "@red-cup-engineering/computer-inference-engine/dispatch/inference-dispatch";
import { recordInferencePurchase as recordInferencePurchaseDefault } from "@red-cup-engineering/agent-harness-computer-system-engineering-services-section";
import { hostOf } from "./intake.mjs";
import { projectStructuredClaims } from "./claim-text.mjs";

/**
 * This session's stable configured customer Actor on the inference-dispatch
 * market (admitted under the "claude" token in
 * inference-dispatch-service/content/customer-admissions/admitted-customers.json).
 * A session is never itself a customer; this Actor is the purchasing
 * identity for every claim-extraction lot this pulse buys.
 */
export const CLAUDE_CUSTOMER_ACTOR = "actor:bZH6KBOlPVWbYpqp04izN_Xtwykn0XgsMBStm_FkPPw";

function deliveredOutcome(outcome) {
  return typeof outcome === "string" && outcome.startsWith("candidate-pending-") && outcome.endsWith("-acceptance");
}

/**
 * Sums one usage field (`promptTokens`, `outputTokens`, or `totalTokens`)
 * across a purchase's per-exchange token-usage entries, skipping any
 * exchange that did not report that field. Returns `null` -- never a
 * fabricated `0` -- when no exchange reported the field at all.
 * @param {{promptTokens: number|null, outputTokens: number|null, totalTokens: number|null}[]} exchanges
 * @param {"promptTokens"|"outputTokens"|"totalTokens"} field
 * @returns {number|null}
 */
function sumUsageField(exchanges, field) {
  const values = exchanges.map((exchange) => exchange?.[field]).filter((value) => Number.isInteger(value));
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0);
}

/**
 * Builds `purchaseClaimExtraction`'s `usage` field from the dispatch
 * result's `providerEvidence.tokenUsage` -- the per-exchange
 * `{promptTokens, outputTokens, totalTokens}` readings
 * `receiver-owned-tool-agent-service`'s `openai-compatible-tool-agent.mjs`
 * already normalizes from the provider's raw `prompt_tokens` /
 * `completion_tokens` / `total_tokens` fields, and
 * `inference-dispatch.mjs` collects one per exchange
 * (`delivery.exchanges.map(({usage}) => usage)`). Absent entirely when the
 * dispatch result carried no token-usage array (a refused delivery, or a
 * provider lane that reports no usage) -- never a fabricated reading.
 * @param {object} result - the raw dispatch result.
 * @returns {{exchanges: object[], promptTokens: number|null, outputTokens: number|null, totalTokens: number|null}|null}
 */
function candidateUsage(result) {
  const exchanges = result?.providerEvidence?.tokenUsage;
  if (!Array.isArray(exchanges) || exchanges.length === 0) return null;
  return {
    exchanges,
    promptTokens: sumUsageField(exchanges, "promptTokens"),
    outputTokens: sumUsageField(exchanges, "outputTokens"),
    totalTokens: sumUsageField(exchanges, "totalTokens"),
  };
}

/**
 * Buys one claim-extraction lot for one story item's summary (falling back
 * to its title when the feed carried no summary) and runs the customer-owned
 * assay against the returned candidate. Never falls back to a paid lane on
 * refusal -- a refusal is reported as-is.
 * @param {{id: string, title: string, summary: string|null, url: string}} item
 * @param {object} [options]
 * @param {Function} [options.dispatch] - injected in tests; defaults to `dispatchInferenceAsConfiguredCustomer`.
 * @param {number} [options.maximumClaims]
 * @param {boolean} [options.freeLaneOnly] - require an admitted zero-cash direct endpoint; the dispatch engine refuses every other lane before provider invocation.
 * @returns {Promise<object>} `{admitted, item, provider, model, durationMs, assay?, candidate?, price?, usage?, exchangeId, workLotId, outcome}`.
 */
export async function purchaseClaimExtraction(item, { dispatch = dispatchInferenceAsConfiguredCustomer, maximumClaims = 6, freeLaneOnly = false } = {}) {
  const text = item.summary && item.summary.trim() !== "" ? item.summary : item.title;
  const workLot = formKnowledgeVaultWorkLot({ kind: "claim-extraction", source: { id: item.id, text, url: item.url }, maximumSuggestions: maximumClaims });
  const started = Date.now();
  const result = await dispatch({
    objective: workLot.objective,
    context: workLot.context,
    workType: workLot.workType,
    taskClass: workLot.taskClass,
    requiredCapabilities: workLot.requiredCapabilities,
    outputSchema: workLot.outputSchema,
    enforceProviderSchema: workLot.enforceProviderSchema,
    mode: workLot.mode,
    zeroCashOnly: freeLaneOnly,
  }, { customerActor: CLAUDE_CUSTOMER_ACTOR });
  const elapsedMs = Date.now() - started;
  const exchangeId = `${workLot.workLotId}:${randomUUID()}`;
  if (!deliveredOutcome(result.outcome)) {
    return { admitted: false, item, provider: result.provider ?? null, model: result.model ?? null, durationMs: elapsedMs, outcome: result.outcome, refusal: result, usage: candidateUsage(result), exchangeId, workLotId: workLot.workLotId };
  }
  const candidate = result.candidate;
  const assay = assayKnowledgeVaultCandidate(workLot, candidate);
  const projectedClaims = assay.accepted ? projectStructuredClaims(candidate, { text, url: item.url }) : [];
  const durationMs = Number.isFinite(result.durationMs) ? result.durationMs : elapsedMs;
  const considerationEntry = Array.isArray(result.consideration) ? result.consideration[0] : null;
  return {
    admitted: assay.accepted,
    item,
    provider: result.provider ?? null,
    model: result.model ?? null,
    durationMs,
    outcome: result.outcome,
    assay,
    candidate: { claims: projectedClaims },
    price: considerationEntry ? { denomination: { kind: considerationEntry.kind, asset: considerationEntry.asset, unit: considerationEntry.unit }, amount: considerationEntry.amount } : null,
    usage: candidateUsage(result),
    exchangeId,
    workLotId: workLot.workLotId,
  };
}

/**
 * Flattens one admitted purchase's assayed candidate claims into per-claim
 * rows carrying the story/source coordinates the settlement and
 * contradiction passes need. `storyId`/`section` name the published story
 * (a cluster may draw on several source items); `host` and `sourceUrl` are
 * this one purchase's own item, since two claims from the same story
 * cluster can still come from independent sources.
 * @param {object} purchase - a result from `purchaseClaimExtraction`.
 * @param {{storyId: string, section: string}} story
 * @returns {{storyId: string, section: string, host: string, sourceUrl: string, subject: string, predicate: string, object: string, quote: string, provider: string|null}[]}
 */
export function claimRows(purchase, story) {
  if (!purchase.admitted) return [];
  return purchase.candidate.claims.map((claim) => ({
    storyId: story.storyId,
    section: story.section,
    host: hostOf(purchase.item.url),
    sourceUrl: purchase.item.url,
    subject: claim.subject,
    predicate: claim.predicate,
    object: claim.object,
    quote: claim.quote,
    provider: purchase.provider,
  }));
}

/**
 * Maps `purchaseClaimExtraction`'s summed `usage` onto
 * `recordInferencePurchase`'s own `usage` carrier shape
 * (`{input?: {quantity, denomination}, output?: {quantity, denomination}}`,
 * `harness-lifecycle-event.schema.json`'s `usage` property) -- prompt
 * tokens as `input`, output tokens as `output`, each only when that side
 * was actually summed (never a fabricated `0` for a side no exchange
 * reported). Returns `undefined` (the schema's own "omit the key" carrier
 * for absent usage) when neither side is known.
 * @param {{promptTokens: number|null, outputTokens: number|null}|null} usage
 * @returns {{input?: {quantity: number, denomination: string}, output?: {quantity: number, denomination: string}}|undefined}
 */
function receiptUsage(usage) {
  if (!usage) return undefined;
  const sides = {
    ...(Number.isInteger(usage.promptTokens) ? { input: { quantity: usage.promptTokens, denomination: "tokens" } } : {}),
    ...(Number.isInteger(usage.outputTokens) ? { output: { quantity: usage.outputTokens, denomination: "tokens" } } : {}),
  };
  return Object.keys(sides).length ? sides : undefined;
}

/**
 * Records one purchase's receipt on the same rail `derive-inference-pnl`
 * reads (`@red-cup-engineering/agent-harness-computer-system-engineering-services-section`'s
 * `recordInferencePurchase` / `INFERENCE_PURCHASED_CATEGORY`), exactly as
 * `inference-dispatch-service/scripts/run-mechanical-inference.mjs` does,
 * now including the purchase's provider-reported token usage when known.
 * Skipped when the purchase never produced a priced delivery (no exchange
 * to receipt) -- a refused or unattempted lane is never receipted, matching
 * that script's own `if (!result.exchange) return ...` guard.
 * @param {object} purchase - a result from `purchaseClaimExtraction`.
 * @param {object} options
 * @param {string} options.root - the harness lifecycle journal root.
 * @param {string} options.turnId
 * @param {Function} [options.record] - injected in tests; defaults to `recordInferencePurchase`.
 * @param {string} [options.actor]
 * @param {string} [options.recordedAt]
 * @returns {object|null} the journal's record result, or null when nothing was priced.
 */
export function recordPurchaseReceipt(purchase, { root, turnId, record = recordInferencePurchaseDefault, actor = CLAUDE_CUSTOMER_ACTOR, recordedAt } = {}) {
  if (!purchase.price) return null;
  const usage = receiptUsage(purchase.usage);
  return record({
    root,
    actor,
    turnId,
    provider: purchase.provider,
    model: purchase.model,
    outcome: "completion",
    latencySeconds: purchase.durationMs / 1000,
    exchangeId: purchase.exchangeId,
    price: purchase.price,
    ...(usage ? { usage } : {}),
    ...(recordedAt ? { recordedAt } : {}),
  });
}

function normalizedKey(claim) {
  return `${claim.subject.trim().toLocaleLowerCase("en-US")} ${claim.predicate.trim().toLocaleLowerCase("en-US")}`;
}

/**
 * Source-divergence detection across one pulse: claims are grouped by
 * normalized (subject, predicate); a group is divergent only when it draws
 * from at least two independent sources and carries at least two distinct
 * normalized object values. One row is emitted per divergent group. A
 * distinct positive object is evidence of itself, not refutation evidence
 * for another exact `(subject, predicate, object)` cell.
 * @param {{host: string, subject: string, predicate: string, object: string, storyId: string, sourceUrl: string}[]} claims
 * @returns {{subject: string, predicate: string, conflictingObjects: string[], sources: {host: string, storyId: string, sourceUrl: string, object: string}[]}[]}
 */
export function detectSourceDivergences(claims) {
  const groups = new Map();
  for (const claim of claims) {
    const key = normalizedKey(claim);
    const group = groups.get(key) ?? { subject: claim.subject, predicate: claim.predicate, entries: [] };
    group.entries.push(claim);
    groups.set(key, group);
  }
  const divergences = [];
  for (const group of groups.values()) {
    const hosts = new Set(group.entries.map((entry) => entry.host));
    const objects = new Set(group.entries.map((entry) => entry.object.trim().toLocaleLowerCase("en-US")));
    if (hosts.size < 2 || objects.size < 2) continue;
    const conflictingObjects = [...new Set(group.entries.map((entry) => entry.object.trim()))].sort();
    const sources = [...group.entries]
      .map((entry) => ({ host: entry.host, storyId: entry.storyId, sourceUrl: entry.sourceUrl, object: entry.object }))
      .sort((left, right) => left.host.localeCompare(right.host) || left.sourceUrl.localeCompare(right.sourceUrl));
    divergences.push({ subject: group.subject, predicate: group.predicate, conflictingObjects, sources });
  }
  return divergences.sort((left, right) => left.subject.localeCompare(right.subject) || left.predicate.localeCompare(right.predicate));
}
