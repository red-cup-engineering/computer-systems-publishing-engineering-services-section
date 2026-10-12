import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { purchaseClaimExtraction, recordPurchaseReceipt } from "../src/newsroom-day/claims.mjs";
import { openHarnessLifecycleJournal, INFERENCE_PURCHASED_CATEGORY } from "@red-cup-engineering/agent-harness-computer-system-engineering-services-section";

const WILDFIRE_URL = "https://a.example/stories/wildfire-valley";

function tmpRoot(label) {
  return mkdtempSync(join(tmpdir(), `claims-test-${label}-`));
}

/**
 * A dispatch result carrying `providerEvidence.tokenUsage` in the same
 * per-exchange shape `receiver-owned-tool-agent-service`'s
 * `openai-compatible-tool-agent.mjs` normalizes to and
 * `inference-dispatch.mjs` collects (`delivery.exchanges.map(({usage}) =>
 * usage)`), i.e. `{promptTokens, outputTokens, totalTokens}` per exchange.
 */
function dispatchWithUsage(tokenUsage) {
  return async () => ({
    outcome: "candidate-pending-claude-acceptance",
    provider: "urn:ame:test-provider", model: "test-model", durationMs: 5,
    consideration: [{ kind: "credit", asset: "urn:union:consideration:provider-invocation", unit: "provider-invocation", amount: { numerator: "1", denominator: "1" } }],
    candidate: { claims: [{ subject: "wildfire", predicate: "grew", object: "overnight", quote: "The wildfire grew overnight" }] },
    providerEvidence: { toolInvocations: [], exchanges: tokenUsage.map((usage) => ({ finishReason: "stop", usage })), tokenUsage },
  });
}

const ITEM = { id: "urn:test:story:1", title: "Wildfire spreads", summary: "The wildfire grew overnight near the valley.", url: WILDFIRE_URL };

test("purchaseClaimExtraction: providerEvidence.tokenUsage threads through as a summed usage field", async () => {
  const dispatch = dispatchWithUsage([{ promptTokens: 120, outputTokens: 40, totalTokens: 160 }]);
  const result = await purchaseClaimExtraction(ITEM, { dispatch });
  assert.equal(result.admitted, true);
  assert.deepEqual(result.usage, {
    exchanges: [{ promptTokens: 120, outputTokens: 40, totalTokens: 160 }],
    promptTokens: 120,
    outputTokens: 40,
    totalTokens: 160,
  });
});

test("purchaseClaimExtraction: sums tokenUsage across multiple exchanges and never fabricates a missing side", async () => {
  const dispatch = dispatchWithUsage([
    { promptTokens: 100, outputTokens: 20, totalTokens: 120 },
    { promptTokens: 50, outputTokens: null, totalTokens: null },
  ]);
  const result = await purchaseClaimExtraction(ITEM, { dispatch });
  assert.deepEqual(result.usage, {
    exchanges: [
      { promptTokens: 100, outputTokens: 20, totalTokens: 120 },
      { promptTokens: 50, outputTokens: null, totalTokens: null },
    ],
    promptTokens: 150,
    outputTokens: 20,
    totalTokens: 120,
  });
});

test("purchaseClaimExtraction: a dispatch result with no providerEvidence carries usage: null -- never a fabricated reading", async () => {
  const dispatch = async () => ({
    outcome: "candidate-pending-claude-acceptance",
    provider: "urn:ame:test-provider", model: "test-model", durationMs: 5,
    consideration: [{ kind: "credit", asset: "urn:union:consideration:provider-invocation", unit: "provider-invocation", amount: { numerator: "1", denominator: "1" } }],
    candidate: { claims: [{ subject: "wildfire", predicate: "grew", object: "overnight", quote: "The wildfire grew overnight" }] },
  });
  const result = await purchaseClaimExtraction(ITEM, { dispatch });
  assert.equal(result.admitted, true);
  assert.equal(result.usage, null);
});

test("purchaseClaimExtraction: free-lane policy reaches the typed dispatch contract before any provider candidate", async () => {
  let request;
  const refusal = {
    outcome: "no-admissible-provider-offer",
    directLaneRefusals: [{ provider: "urn:ame:paid-provider", reason: "zero-cash-entitlement-not-admitted" }],
  };
  const result = await purchaseClaimExtraction(ITEM, {
    freeLaneOnly: true,
    dispatch: async (input) => { request = input; return refusal; },
  });

  assert.equal(request.zeroCashOnly, true);
  assert.equal(result.admitted, false);
  assert.equal(result.price, undefined);
  assert.equal(result.refusal, refusal);
  assert.deepEqual(result.refusal.directLaneRefusals, [{ provider: "urn:ame:paid-provider", reason: "zero-cash-entitlement-not-admitted" }]);
});

test("recordPurchaseReceipt: usage reaches recordInferencePurchase as {input, output} token quantities", async () => {
  const dispatch = dispatchWithUsage([{ promptTokens: 120, outputTokens: 40, totalTokens: 160 }]);
  const purchase = await purchaseClaimExtraction(ITEM, { dispatch });
  const calls = [];
  const record = (args) => { calls.push(args); return { id: "stub-record-id" }; };
  recordPurchaseReceipt(purchase, { root: "unused", turnId: "test-turn", record });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].usage, {
    input: { quantity: 120, denomination: "tokens" },
    output: { quantity: 40, denomination: "tokens" },
  });
});

test("recordPurchaseReceipt: a purchase with no usage omits the usage key entirely (never usage: undefined leaking through, never a fabricated zero)", async () => {
  const dispatch = async () => ({
    outcome: "candidate-pending-claude-acceptance",
    provider: "urn:ame:test-provider", model: "test-model", durationMs: 5,
    consideration: [{ kind: "credit", asset: "urn:union:consideration:provider-invocation", unit: "provider-invocation", amount: { numerator: "1", denominator: "1" } }],
    candidate: { claims: [{ subject: "wildfire", predicate: "grew", object: "overnight", quote: "The wildfire grew overnight" }] },
  });
  const purchase = await purchaseClaimExtraction(ITEM, { dispatch });
  const calls = [];
  const record = (args) => { calls.push(args); return { id: "stub-record-id" }; };
  recordPurchaseReceipt(purchase, { root: "unused", turnId: "test-turn", record });
  assert.equal(calls.length, 1);
  assert.equal(Object.hasOwn(calls[0], "usage"), false);
});

test("recordPurchaseReceipt: end-to-end against the real recordInferencePurchase, usage readable back from the journal", async () => {
  const root = tmpRoot("usage-end-to-end");
  const dispatch = dispatchWithUsage([{ promptTokens: 90, outputTokens: 30, totalTokens: 120 }]);
  const purchase = await purchaseClaimExtraction(ITEM, { dispatch });
  recordPurchaseReceipt(purchase, { root, turnId: "test-turn" });
  const rows = openHarnessLifecycleJournal({ root }).query({ category: INFERENCE_PURCHASED_CATEGORY });
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].record.usage, {
    input: { quantity: 90, denomination: "tokens" },
    output: { quantity: 30, denomination: "tokens" },
  });
  rmSync(root, { recursive: true, force: true });
});
