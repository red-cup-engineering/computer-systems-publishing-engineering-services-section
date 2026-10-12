/**
 * Newsroom-day knowledge-manifold instrument: settles one pulse's admitted
 * claims through the predicated-inference-kernel. Objects are source hosts;
 * attributes are exact claim identities `(subject, predicate, object)` and a
 * host asserting a claim is incidence. Different positive values are
 * independent cells: this input shape has no explicit negation carrier, so
 * it must not manufacture denial evidence from a shared subject/predicate.
 */
import { makeMachineState, runMachineAction } from "@red-cup-engineering/computer-systems-engineering-services-section/signcraft/inference/kernel";
import { knowledgeHeight } from "@red-cup-engineering/computer-systems-engineering-services-section/signcraft/inference/nuclei";
import {
  makeComplex,
  withConductance,
  disagreementEnergy as kernelDisagreementEnergy,
  spectralGap as kernelSpectralGap,
} from "@red-cup-engineering/computer-systems-engineering-services-section/signcraft/inference/complex";
import { knowledgeJoinAll } from "@red-cup-engineering/computer-data-engineering-services-section/four";

/**
 * The kernel attribute identity for one claim: a JSON array so subject,
 * predicate, and object may hold any text without ambiguity -- an opaque
 * kernel attribute key, never parsed back.
 * @param {string} subject
 * @param {string} predicate
 * @param {string} object
 * @returns {string}
 */
export function claimKey(subject, predicate, object) {
  return JSON.stringify([subject, predicate, object]);
}

/**
 * Builds the kernel actor state from one pulse's admitted claim rows.
 * Only asserted incidences are initial evidence because this carrier does not
 * admit an explicit refutation. Settlement advances this state through the
 * shared actor, never by mutating a local valuation.
 * @param {{host: string, subject: string, predicate: string, object: string}[]} claims
 * @returns {{state: object, ctx: object, seed: Map, objects: string[], attributes: string[], incidencePairs: [string, string][], denialPairs: [string, string][]}}
 */
export function buildClaimKernelContext(claims) {
  const objects = [...new Set(claims.map((claim) => claim.host))].sort();
  const attributes = [...new Set(claims.map((claim) => claimKey(claim.subject, claim.predicate, claim.object)))].sort();

  const incidencePairs = [];
  const seenIncidence = new Set();
  for (const claim of claims) {
    const key = claimKey(claim.subject, claim.predicate, claim.object);
    const pairId = `${claim.host} ${key}`;
    if (seenIncidence.has(pairId)) continue;
    seenIncidence.add(pairId);
    incidencePairs.push([claim.host, key]);
  }

  const denialPairs = [];
  const state = makeMachineState({ objects, attributes, incidencePairs, denialPairs });
  return { state, ctx: state.ctx, seed: state.v, objects, attributes, incidencePairs, denialPairs };
}

function aggregateReadings(objects, attributes, valuation) {
  const readings = new Map();
  for (const attribute of attributes) {
    readings.set(attribute, knowledgeJoinAll([...objects].map((host) => valuation.get(`${host} ${attribute}`) ?? "absurd")));
  }
  return readings;
}

/**
 * The pulse's knowledge-manifold readout (Theory Thursday, 2026-09-03's
 * "first instrument"; WIT counting corrected 2026-09-03 per the
 * witnessed-field note §1 -- a WIT is exactly one evidence bit flipping
 * 0→1 in FOUR. `witsAsserted` is the kernel knowledge height of admitted
 * positive incidence pairs. This claim carrier has no explicit denial lane,
 * so different values do not add fabricated refutation WITs. `witsDerived` is knowledge height
 * `settle()` adds beyond that valuation, one WIT per evidence bit flipped
 * (settle()'s own H-theorem-checked `ledger.initialDeficit`, now measured
 * from the fully asserted seed so asserted bits are never double-counted).
 * `wits`: their sum. `heldTops`: claim identities whose evidence, joined
 * across every host that spoke to it, settles to FOUR's top.
 * `moltenFraction`: heldTops over total distinct claim identities.
 * `obstructions`: settle()'s own contested-cell count. `disagreementEnergy`/
 * `spectralGap`: from a conductance complex over claim identities weighted
 * by co-assertion counts, at the settled ±1/0 reading. `costPerWit`: `cost`
 * divided by `wits` as an exact fraction -- null only when `wits` is zero
 * or cost carries no denomination.
 * @param {{host: string, subject: string, predicate: string, object: string}[]} claims
 * @param {{denomination: object|null, amount: {numerator: string, denominator: string}}} [cost]
 * @returns {{wits: number, witsAsserted: number, witsDerived: number, heldTops: number, totalAttributes: number, moltenFraction: number, obstructions: number, disagreementEnergy: number, spectralGap: number, costPerWit: {numerator: string, denominator: string}|null}}
 */
export function pulseKnowledgeReadout(claims, cost) {
  if (claims.length === 0) {
    return { wits: 0, witsAsserted: 0, witsDerived: 0, heldTops: 0, totalAttributes: 0, moltenFraction: 0, obstructions: 0, disagreementEnergy: 0, spectralGap: 0, costPerWit: null };
  }
  const built = buildClaimKernelContext(claims);
  const { state, ctx, seed, objects, attributes } = built;
  const witsAsserted = knowledgeHeight(ctx, seed);
  const transition = runMachineAction(state, { kind: "settle" });
  if (transition.result.kind !== "settled") throw new Error("newsroom settlement was refused by the predicated actor");
  const settled = transition.result.settlement;
  const readings = aggregateReadings(objects, attributes, settled.v);
  const heldTops = [...readings.values()].filter((reading) => reading === "stable").length;
  const totalAttributes = attributes.length;
  const witsDerived = settled.ledger.initialDeficit;
  const wits = witsAsserted + witsDerived;

  const byHost = new Map();
  for (const claim of claims) {
    const key = claimKey(claim.subject, claim.predicate, claim.object);
    if (!byHost.has(claim.host)) byHost.set(claim.host, new Set());
    byHost.get(claim.host).add(key);
  }
  let cx = makeComplex(attributes);
  for (let i = 0; i < attributes.length; i += 1) {
    for (let j = i + 1; j < attributes.length; j += 1) {
      let coassert = 0;
      for (const held of byHost.values()) if (held.has(attributes[i]) && held.has(attributes[j])) coassert += 1;
      cx = withConductance(cx, attributes[i], attributes[j], coassert);
    }
  }
  const assignment = {};
  for (const [attribute, reading] of readings) assignment[attribute] = reading === "potential" ? 1 : reading === "active" ? -1 : 0;

  const costPerWit = wits === 0 || !cost?.denomination
    ? null
    : { numerator: cost.amount.numerator, denominator: (BigInt(cost.amount.denominator) * BigInt(wits)).toString() };

  return {
    wits,
    witsAsserted,
    witsDerived,
    heldTops,
    totalAttributes,
    moltenFraction: totalAttributes === 0 ? 0 : heldTops / totalAttributes,
    obstructions: settled.obstructions.contested.length,
    disagreementEnergy: kernelDisagreementEnergy(cx, assignment),
    spectralGap: kernelSpectralGap(cx),
    costPerWit,
  };
}
