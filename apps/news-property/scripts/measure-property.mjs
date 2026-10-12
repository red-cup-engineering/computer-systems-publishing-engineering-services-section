#!/usr/bin/env node
/**
 * Run one measure pass for a news property: read
 * {propertyPath, contentRoot, since, until, settlementsPath,
 * salesReceiptsPath?} as JSON on
 * stdin, pull Cloudflare Web Analytics and the house ad server's delivery
 * receipts, join them against the pulse settlement, and write the EROEI
 * readout under the property record's own data root plus the most-read
 * module under the content root's measure/ dir. Cloudflare credentials
 * (CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_WEB_ANALYTICS_SITE_TAG,
 * CLOUDFLARE_API_TOKEN) are read from the environment, never stored in the
 * property record; the house ad server needs no credential.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fetchCloudflareWebAnalytics, fetchHouseAdReceipts, eroeiReadout, mostRead } from "../src/measure.mjs";
import { slugify } from "@red-cup-engineering/computer-text-content-engineering-services-section/slugify-text";

const REQUIRED_FIELDS = ["propertyPath", "contentRoot", "since", "until", "settlementsPath"];

function salesReceiptsFrom(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.settlements)) return payload.settlements;
  throw new TypeError("salesReceiptsPath must contain an array or an object with a settlements array");
}

/**
 * @param {NodeJS.ReadableStream} stream
 * @returns {Promise<object>}
 * @throws {TypeError} When the stream is empty.
 */
async function readStdinJson(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim() === "") throw new TypeError("measure-property requires a JSON object on stdin");
  return JSON.parse(text);
}

/**
 * @param {unknown} name
 * @returns {string} Lowercase, hyphenated key, matching the house ad catalog's property keys (e.g. "koios-news").
 */
function slugifyPropertyName(name) {
  return slugify(String(name ?? "").trim());
}

/**
 * @param {string} since ISO-8601 timestamp.
 * @param {string} until ISO-8601 timestamp.
 * @returns {number|null} Whole days between the two, or null when either is unparseable.
 */
function windowDaysBetween(since, until) {
  const start = Date.parse(since);
  const end = Date.parse(until);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.max(1, Math.round((end - start) / 86_400_000));
}

async function main() {
  const input = await readStdinJson(process.stdin);
  for (const field of REQUIRED_FIELDS) {
    if (typeof input[field] !== "string" || input[field].trim() === "") {
      throw new TypeError(`measure-property stdin requires ${field}`);
    }
  }

  const property = JSON.parse(await readFile(input.propertyPath, "utf8"));
  const settlements = JSON.parse(await readFile(input.settlementsPath, "utf8"));
  const salesReceipts = input.salesReceiptsPath === undefined
    ? []
    : salesReceiptsFrom(JSON.parse(await readFile(input.salesReceiptsPath, "utf8")));
  const houseAds = property.monetization?.houseAds ?? {};
  const propertyKey = typeof houseAds.property === "string" && houseAds.property.trim() !== ""
    ? houseAds.property
    : slugifyPropertyName(property.name);

  const analytics = await fetchCloudflareWebAnalytics({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    siteTag: process.env.CLOUDFLARE_WEB_ANALYTICS_SITE_TAG,
    token: process.env.CLOUDFLARE_API_TOKEN,
    since: input.since,
    until: input.until,
    fetch,
  });

  const adReceipts = await fetchHouseAdReceipts({
    server: houseAds.server,
    property: propertyKey,
    since: input.since,
    fetch,
  });

  const readout = eroeiReadout({
    views: analytics.ok ? analytics.rows : [],
    adReceipts: adReceipts.ok ? adReceipts.receipts : [],
    salesReceipts,
    salesGateway: property.monetization?.x402?.gateway,
    settlements,
  });

  const sources = {
    cloudflareWebAnalytics: analytics.ok ? { ok: true } : { ok: false, reason: analytics.reason },
    houseAdReceipts: adReceipts.ok ? { ok: true } : { ok: false, reason: adReceipts.reason },
    paidSalesReceipts: input.salesReceiptsPath === undefined
      ? { ok: false, reason: "not-supplied" }
      : { ok: true, gateway: property.monetization?.x402?.gateway ?? null, count: salesReceipts.length },
  };

  const untilDate = input.until.slice(0, 10);
  const dataRoot = join(dirname(input.propertyPath), "data", "records", "measure");
  const readoutPath = join(dataRoot, `${untilDate}-eroei-readout.json`);
  await mkdir(dataRoot, { recursive: true });
  await writeFile(readoutPath, `${JSON.stringify({ since: input.since, until: input.until, sources, ...readout }, null, 2)}\n`);

  const mostReadPath = join(input.contentRoot, "measure", "most-read.json");
  await mkdir(dirname(mostReadPath), { recursive: true });
  const windowDays = windowDaysBetween(input.since, input.until);
  await writeFile(mostReadPath, `${JSON.stringify(mostRead(readout, 10, { windowDays }), null, 2)}\n`);

  process.stdout.write(`${JSON.stringify({ readoutPath, mostReadPath, sources, property: readout.property }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
