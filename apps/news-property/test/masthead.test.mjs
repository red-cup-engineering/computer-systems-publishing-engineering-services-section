import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  classifyOfficeRole,
  sectionSlugFromJurisdiction,
  seatedHolderByOffice,
  buildMastheadProjection,
} from "../scripts/render-masthead.mjs";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(TEST_DIR, "..", "scripts", "render-masthead.mjs");

// -- classifyOfficeRole -------------------------------------------------------

test("classifyOfficeRole: recognizes each fixed §6 role by office name", () => {
  assert.equal(classifyOfficeRole({ name: "editor-in-chief" }), "editor-in-chief");
  assert.equal(classifyOfficeRole({ name: "standards editor" }), "standards");
  assert.equal(classifyOfficeRole({ name: "corrections editor" }), "corrections");
  assert.equal(classifyOfficeRole({ name: "publisher" }), "publisher");
  assert.equal(classifyOfficeRole({ name: "audience editor" }), "audience");
  assert.equal(classifyOfficeRole({ name: "World desk editor" }), "desk");
  assert.equal(classifyOfficeRole({ name: "U.S. Politics desk editor" }), "desk");
});

test("classifyOfficeRole: an unrelated office name classifies to null", () => {
  assert.equal(classifyOfficeRole({ name: "configuration manager" }), null);
  assert.equal(classifyOfficeRole({}), null);
});

// -- sectionSlugFromJurisdiction ----------------------------------------------

test("sectionSlugFromJurisdiction: reads the last path segment", () => {
  assert.equal(sectionSlugFromJurisdiction({ jurisdiction: "koios.news/world/" }), "world");
  assert.equal(sectionSlugFromJurisdiction({ jurisdiction: "koios.news/us-politics/" }), "us-politics");
});

test("sectionSlugFromJurisdiction: a single-segment or absent jurisdiction has no section", () => {
  assert.equal(sectionSlugFromJurisdiction({ jurisdiction: "koios.news/" }), null);
  assert.equal(sectionSlugFromJurisdiction({}), null);
});

// -- seatedHolderByOffice ------------------------------------------------------

test("seatedHolderByOffice: only recognition=t and induction=t counts as seated", () => {
  const incumbencies = new Map([
    ["a", { office: "office-a", holder: "char-a", recognition: "t", induction: "t" }],
    ["b", { office: "office-b", holder: "char-b", recognition: "t", induction: "f" }],
    ["c", { office: "office-c", holder: "char-c", recognition: "bottom", induction: "bottom" }],
  ]);
  const seated = seatedHolderByOffice(incumbencies);
  assert.equal(seated.get("office-a"), "char-a");
  assert.equal(seated.has("office-b"), false);
  assert.equal(seated.has("office-c"), false);
});

// -- buildMastheadProjection ---------------------------------------------------

test("buildMastheadProjection: shapes the five named roles plus a sorted desk list", () => {
  const offices = new Map([
    ["eic", { name: "editor-in-chief", "normative-structure": "presides over desks" }],
    ["std", { name: "standards editor", "normative-structure": "owns the gate profile" }],
    ["cor", { name: "corrections editor", "normative-structure": "runs the correction transaction" }],
    ["pub", { name: "publisher", "normative-structure": "owns monetization" }],
    ["aud", { name: "audience editor", "normative-structure": "owns distribution" }],
    ["desk-z", { name: "Zeta desk editor", "normative-structure": "answers for zeta", jurisdiction: "x.example/zeta/" }],
    ["desk-a", { name: "Alpha desk editor", "normative-structure": "answers for alpha", jurisdiction: "x.example/alpha/" }],
    ["unrelated", { name: "configuration manager", "normative-structure": "irrelevant" }],
  ]);
  const incumbencies = new Map([
    ["i1", { office: "eic", holder: "nik", recognition: "t", induction: "t" }],
    ["i2", { office: "desk-a", holder: "char-alpha", recognition: "t", induction: "t" }],
  ]);
  const characters = new Map([
    ["nik", { name: "Nik Koios" }],
    ["char-alpha", { name: "Alpha Character" }],
  ]);

  const projection = buildMastheadProjection({ offices, incumbencies, characters });

  assert.equal(projection.ownership, "The 561 Group");
  assert.deepEqual(projection.editorInChief, { office: "eic", holder: "nik", holderName: "Nik Koios", answersFor: "presides over desks" });
  assert.deepEqual(projection.standards, { office: "std", holder: null, holderName: null, answersFor: "owns the gate profile" });
  assert.deepEqual(projection.corrections, { office: "cor", holder: null, holderName: null, answersFor: "runs the correction transaction" });
  assert.deepEqual(projection.publisher, { office: "pub", holder: null, holderName: null, answersFor: "owns monetization" });
  assert.deepEqual(projection.audience, { office: "aud", holder: null, holderName: null, answersFor: "owns distribution" });

  assert.equal(projection.desks.length, 2);
  assert.deepEqual(projection.desks[0], { section: "alpha", office: "desk-a", holder: "char-alpha", holderName: "Alpha Character", answersFor: "answers for alpha" });
  assert.deepEqual(projection.desks[1], { section: "zeta", office: "desk-z", holder: null, holderName: null, answersFor: "answers for zeta" });
});

test("render-masthead projects supplied records without depending on a deployed news property", (t) => {
  const root = mkdtempSync(join(tmpdir(), "news-masthead-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const records = {
    offices: { editor: { name: "editor-in-chief", "normative-structure": "answers for publication" }, world: { name: "World desk editor", jurisdiction: "example.test/world/", "normative-structure": "answers for world" } },
    incumbencies: { seat: { office: "editor", holder: "person", recognition: "t", induction: "t" } },
    characters: { person: { name: "Test Editor" } },
  };
  for (const [kind, entries] of Object.entries(records)) {
    mkdirSync(join(root, kind));
    for (const [id, record] of Object.entries(entries)) writeFileSync(join(root, kind, `${id}.json`), JSON.stringify(record));
  }
  const input = JSON.stringify({ officesDir: join(root, "offices"), incumbenciesDir: join(root, "incumbencies"), charactersDir: join(root, "characters") });
  const projection = JSON.parse(execFileSync(process.execPath, [SCRIPT], { input, encoding: "utf8" }));
  assert.equal(projection.editorInChief.holder, "person");
  assert.equal(projection.editorInChief.holderName, "Test Editor");
  assert.deepEqual(projection.desks, [{ section: "world", office: "world", holder: null, holderName: null, answersFor: "answers for world" }]);
});

test("render-masthead requires officesDir and incumbenciesDir on stdin", () => {
  assert.throws(() => execFileSync(process.execPath, [SCRIPT], { input: "{}", encoding: "utf8" }));
});
