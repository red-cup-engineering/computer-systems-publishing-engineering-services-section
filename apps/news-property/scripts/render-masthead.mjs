#!/usr/bin/env node
/**
 * Renders a news property's masthead projection (spec §6) from its office,
 * incumbency, and character records. Reads {officesDir, incumbenciesDir,
 * charactersDir?} as JSON on stdin; prints {editorInChief, desks, standards,
 * corrections, publisher, audience, ownership} as JSON on stdout. Offices
 * are classified by their fixed-vocabulary `name` field, so the projection
 * carries no property-specific office ids.
 */
import { readFileSync, readdirSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/**
 * Read every `*.json` file in a directory into a map keyed by its record id
 * (the file's basename, matching the office/incumbency/character id law).
 * @param {string|undefined} dir
 * @returns {Map<string, object>}
 */
export function readRecordDir(dir) {
  const records = new Map();
  if (typeof dir !== "string" || dir.trim() === "") return records;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const id = file.slice(0, -".json".length);
    records.set(id, JSON.parse(readFileSync(join(dir, file), "utf8")));
  }
  return records;
}

/**
 * Classify an office record by its `name`, per the news-property
 * specification §6 role vocabulary.
 * @param {{name?: string}} office
 * @returns {'editor-in-chief'|'standards'|'corrections'|'publisher'|'audience'|'desk'|null}
 */
export function classifyOfficeRole(office) {
  const name = typeof office?.name === "string" ? office.name.trim().toLowerCase() : "";
  if (name === "editor-in-chief") return "editor-in-chief";
  if (name === "standards editor") return "standards";
  if (name === "corrections editor") return "corrections";
  if (name === "publisher") return "publisher";
  if (name === "audience editor") return "audience";
  if (name.endsWith("desk editor")) return "desk";
  return null;
}

/**
 * Read a desk office's section slug out of its jurisdiction
 * (`<host>/<slug>/`), the last non-empty path segment.
 * @param {{jurisdiction?: string}} office
 * @returns {string|null}
 */
export function sectionSlugFromJurisdiction(office) {
  if (typeof office?.jurisdiction !== "string") return null;
  const segments = office.jurisdiction.split("/").filter((s) => s.trim() !== "");
  return segments.length >= 2 ? segments[segments.length - 1] : null;
}

/**
 * Build the office-id -> holder-id map from every incumbency settled to
 * dignitas (recognition "t" and induction "t"); any other cell reads as
 * vacant for the masthead's purposes rather than asserting an unsettled seat.
 * @param {Map<string, object>} incumbencies
 * @returns {Map<string, string>}
 */
export function seatedHolderByOffice(incumbencies) {
  const seated = new Map();
  for (const incumbency of incumbencies.values()) {
    if (incumbency.recognition === "t" && incumbency.induction === "t") {
      seated.set(incumbency.office, incumbency.holder);
    }
  }
  return seated;
}

/**
 * Project one office into its masthead role entry.
 * @param {string} officeId
 * @param {object} office
 * @param {Map<string, string>} holderByOffice
 * @param {Map<string, object>} characters
 * @returns {{office: string, holder: string|null, holderName: string|null, answersFor: string}}
 */
function projectRole(officeId, office, holderByOffice, characters) {
  const holder = holderByOffice.get(officeId) ?? null;
  const holderName = holder ? (characters.get(holder)?.name ?? holder) : null;
  return { office: officeId, holder, holderName, answersFor: office["normative-structure"] };
}

/**
 * Project a firm's seated offices into the masthead JSON a news-property
 * home page's masthead page consumes.
 * @param {{offices: Map<string,object>, incumbencies: Map<string,object>, characters: Map<string,object>}} pools
 * @returns {{editorInChief: object|null, desks: object[], standards: object|null, corrections: object|null, publisher: object|null, audience: object|null, ownership: string}}
 */
export function buildMastheadProjection({ offices, incumbencies, characters }) {
  const holderByOffice = seatedHolderByOffice(incumbencies);
  const projection = {
    editorInChief: null,
    desks: [],
    standards: null,
    corrections: null,
    publisher: null,
    audience: null,
    ownership: "The 561 Group",
  };

  for (const [officeId, office] of offices) {
    const role = classifyOfficeRole(office);
    if (role === null) continue;
    if (role === "desk") {
      const section = sectionSlugFromJurisdiction(office) ?? officeId;
      projection.desks.push({ section, ...projectRole(officeId, office, holderByOffice, characters) });
      continue;
    }
    projection[role === "editor-in-chief" ? "editorInChief" : role] = projectRole(officeId, office, holderByOffice, characters);
  }

  projection.desks.sort((a, b) => a.section.localeCompare(b.section));
  return projection;
}

/**
 * Read a readable stream to completion and parse it as JSON.
 * @param {NodeJS.ReadableStream} stream
 * @returns {Promise<object>}
 * @throws {TypeError} when the stream is empty
 */
async function readStdinJson(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim() === "") throw new TypeError("render-masthead requires a JSON object on stdin");
  return JSON.parse(text);
}

async function main() {
  const input = await readStdinJson(process.stdin);
  if (typeof input.officesDir !== "string" || input.officesDir.trim() === "") {
    throw new TypeError("render-masthead stdin requires officesDir");
  }
  if (typeof input.incumbenciesDir !== "string" || input.incumbenciesDir.trim() === "") {
    throw new TypeError("render-masthead stdin requires incumbenciesDir");
  }
  const offices = readRecordDir(input.officesDir);
  const incumbencies = readRecordDir(input.incumbenciesDir);
  const characters = readRecordDir(input.charactersDir);
  const projection = buildMastheadProjection({ offices, incumbencies, characters });
  process.stdout.write(`${JSON.stringify(projection, null, 2)}\n`);
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
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
