---
title: "News Property Specification"
description: "The specification for news properties as data: one property JSON plus one app produces, runs, distributes, measures, and monetizes a complete AI-era news site, with Koios.News as the first parameterization. Fixes the property schema, the newsroom day (intake, selection, research, editorial state, prose on the cheapest lane, deterministic gates, assessment, images, render, distribute, measure), the rendered surfaces that meet a stock news-magazine and the reference newsrooms, the corporation shape (desks as offices with incumbencies), the deploy lane, the EROEI readout, and the acceptance assays. Every incumbent baseline cites the measurement that produced it."
date-created: 2026-09-02
type: specification
name: 2026-09-02-news-property-specification
authors:
  - claude-fable-5-1
status: superseded-historical
keywords: ["news-property", "koios-news", "properties-as-data", "newsroom", "content-mill", "attention-arbitrage", "eroei", "web-theming", "image-generation", "inference-dispatch", "activitypub", "websub", "indexnow", "office", "incumbency"]
tags: ["specification", "koios-news"]
---

This is a historical proposal, not the current package contract. Its single
`news-property` app conflates feed syndication, source analysis, inference,
editorial production, rendering, distribution, and a specific publisher's
policy. The current source-analysis implementation is
`@red-cup-engineering/feltos/content-mill/newsroom`, composed for Koios by
its own newsroom boundary; Newswire handles feed syndication in AOE.
`@red-cup-engineering/news-property` no longer exports or contains the
`newsroom-day` implementation described below. The acceptance assays here
remain historical aspirations and are not evidence of routine publication.

## 1. Receiver and arena

Receiver: a reader or an agent choosing a news source for a common domain (world, politics, business and markets, crypto, technology, science and climate, health, culture and entertainment, sport, opinion), and an operator spinning up such a property in minutes and running it for years. The job: publish many sourced, imaged, correctable, discoverable stories a day across those domains, be found by search, social, and agents, and earn from the attention. Arena boundary: the property and the machinery that runs it, not the paid briefing product beside it.

Measured on 2026-09-02 (live fetches recorded in the session's workflow journals): koios.news serves 22 articles, 20 older than 60 days, one beat with real depth, zero images, zero stylesheet bytes, zero Open Graph or Twitter card tags, no favicon, an empty ActivityPub outbox, no ads, no newsletter capture, and a news sitemap with one stale entry. Gazette Review, a stock tagDiv Newspaper WordPress site, serves ten sections, eight AdSense units, images on every story, and about two posts a day. The Guardian, Reuters, AP, and BBC publish named desks, a standards owner distinct from the top editor, corrections, ownership, and per-section daily volume in the tens.

The owner's own content mill and Gazette Review writing (2015) are the pre-AI form of this arena and are not the target. The target is the arena as AI changed it: referrals from search fall as answers are given in place, agents become readers, and the rails that still carry attention are newsletters, Discover, the fediverse, direct visits, and structured feeds that machines can cite (the house's own theory of this is the [claim infrastructure](../../../../../../../../../../../../../../science-services-section/services/social-science-services-section/services/sociology-science-services-section/services/work-science-services-section/content/text/documents/articles/notes/2026/06/19/2026-06-19-claim-infrastructure-business.md) and the [attention-arbitrage program](../../../../../../../../../../../../../../science-services-section/services/social-science-services-section/services/sociology-science-services-section/services/work-science-services-section/content/text/documents/articles/notes/undated/attention-arbitrage.md)).

## 2. The law this realizes

A public property is JSON parameters over shared upstream engineering services, never a bespoke daemon per property ([org layering](../../../../../../../../../../../../../../../.claude/rules/org-layering.md)). The attention-arbitrage program's four moves (cheap supply, distribution, monetization, cost externalization) are the incumbents' mechanism; the house runs the first three on its own market and refuses the fourth by construction: every story is source-bound, every claim carries provenance, reader demand selects attention and never supplies factual warrant, and every erasure is priced ([the distal bypass](../../../../../../../../../../../../../../561-group-services-section/content/text/documents/articles/notes/2026/07/16/2026-07-16-the-distal-bypass.md)). The success criterion is cognitive EROEI: attention captured per unit of inference spent, computed from receipts, never estimated.

## 3. The property record

One JSON file per property, validated by a schema kept once in this section at `schemas/news-property.schema.json`:

- `name`, `origin` (https URL), `tagline`, `language`, `locale`, `timezone`.
- `masthead`: the author records and the desk offices the masthead page renders from (paths to office and incumbency records; no names typed twice).
- `sections[]`: `{slug, title, wires[], quotaPerDay, minimumIndependentSources, genre}`; wires are feed URLs or GDELT queries the newscable broker admits.
- `theme`: palette seeds for `@red-cup-engineering/web-theming-service` (`derivePalette`), display and text fonts, measure, and a logo/wordmark SVG path.
- `images`: hero policy (`generate` via `@red-cup-engineering/image-generation-inference-team` free lane, or `none`), the Open Graph card composition (1200×630, headline overlay), credit line rule.
- `distribution`: IndexNow key path, WebSub hub URL, ActivityPub actor URL, Bluesky handle, newsletter (Buttondown list id), Google News sitemap on/off.
- `monetization`: house ad slots (`@red-cup-engineering/web-advertising-system-engineering-services-section` server URL and slot names), optional AdSense or A-Ads unit ids, `ads.txt` lines.
- `cadence`: pulse interval, daily article target, free-lane-only flag, frontier budget ceiling in USD per day.
- `jurisdictions`: publication jurisdiction and the gate profile per source jurisdiction (defamation and correction regimes), the fibered gate of the editorial-production memo.
- `deploy`: Cloudflare Worker name and route (the play.561.group Worker-with-assets shape) for preview and for production alike; koios.news production is the Worker with the `koios.news/*` route.

Koios.News is the first record: `sections` are the ten common domains (world, us-politics, business-markets, crypto, technology, science-climate, health, culture-entertainment, sport, opinion-analysis), each with three or more wires; the collapse frame becomes the house voice of the opinion-analysis section and a tag across the others, not the whole masthead.

## 4. The app: `apps/news-property`

Seated in this section as the composition point (apps compose scripts and src). Commands, each JSON in and JSON out:

1. `build` — property record + content root → `public/` with every surface in §5, byte-deterministic, plus `manifest.json` sealing every artifact (the existing Koios static carrier's sealing law, generalized).
2. `newsroom-day` — runs one pulse: intake (newscable broker per wire → store rows via the EAVT projection), selection (deterministic score: freshness, independent-source count, demand signal from GDELT volume and the property's search-demand import when present, section quota), research packet, licensed editorial state, prose bought on the cheapest admitted lane through the inference market (free lanes first; frontier only when every free lane refuses, capped by `cadence.frontierBudget`), deterministic gates (the news-media text primitives: prophecy, attribution, numeric citation, quotes, duplicates), independent assessment on a different model lineage than the drafter, hero and Open Graph images, then `build`. Every purchase is receipted; the pulse writes one settlement record with cost per article.
3. `distribute` — after a build: IndexNow submission for changed URLs, WebSub hub publish for the feeds, ActivityPub Create for each new story to the property's actor outbox, Bluesky post when a handle is configured, the Google News sitemap refreshed, and the newsletter draft composed through `@red-cup-engineering/email-newsletter-engineering-services-section`.
4. `measure` — pulls Cloudflare Web Analytics and the ad server's delivery receipts, joins them to the pulse settlement, and writes the EROEI readout: views, engaged time, referrer class (search, social, fediverse, direct, agent), and revenue per article against inference cost; the readout feeds the next selection.
5. `deploy` — `wrangler deploy` of `public/` as a Worker with assets to the property's route, preview first (no route) and production second (the route), followed by a readback that byte-compares the served manifest and a sample of assets against the build; the deploy record carries the deployment id and the manifest digest.

## 5. Rendered surfaces (the MEET contract)

Home: masthead with wordmark and tagline; primary navigation of the ten sections; a lead story with hero image; a three-column top block; per-section blocks of four stories with thumbnails; latest list; most-read module from the measure readout; newsletter capture; footer with about, masthead, standards, corrections, ownership, privacy, feeds, sitemaps, and the ActivityPub handle. Section pages with pagination. Article: kicker (section), headline that states the news, dek, byline linking a desk page, dateline and updated time, hero image with caption and credit, body typography at a fixed measure, inline citations, the claim ledger (what this article asserts, each with its source) and the omission ledger (what the reporting does not establish), related stories, share links, corrections notice when any, rights line. Desk and author pages, tag pages, archive, a static search index with a client-side search box, a masthead page rendered from office and incumbency records, standards and corrections pages that name their owning office.

Head: complete NewsArticle JSON-LD with image and publisher logo, Open Graph and Twitter card with a 1200×630 image, canonical, robots `max-image-preview:large`, favicon set and web manifest, `fediverse:creator`, rel=me to the actor, RSS with channel image and hub link, Atom, JSON Feed, sitemap with lastmod on every page, news sitemap of the last 48 hours, `ads.txt` when monetization is on. Theme from the retired Koios identity (cream paper, near-black ink, one red accent, heavy uppercase display type over serif text, hard rules, no motion) rebuilt on `web-theming-service` with light and dark derived from seeds. Every page passes the house's own deterministic checks: no orphan heading, alt text on every image, landmarks, skip link.

## 6. The corporation

Each section is a desk. Each desk is an office record conformant to `office.schema.json` (normative structure, deontic profile, theory basis) with an incumbency record seating a character; a standards editor office owns the standards page and the deterministic gate profile; a corrections editor office owns the correction transaction and does not route through the top editor; a publisher office owns monetization and the ad contracts; an audience office owns distribution and the measure readout. The masthead page is a projection of those records. Each desk is an internal micro-enterprise buying research, prose, images, and assessment from house providers with receipts that post to the related-party accounts of the main ledger and eliminate on consolidation; external revenue from ads, the claim feed, and the briefing is the only minting.

## 7. Capacity and cost

Free lanes carry the routine day: Gemini free tier and Groq for prose and assessment, Cloudflare Workers AI for images (about two thousand a day), the local NPU for classification. The target is the incumbent floor met on the first day (ten sections, two stories each with images) and beaten within the week (three to five per section per day, every story with a claim ledger, corrections that propagate). Frontier inference is capped per property per day and spent only where a free lane refused. The EROEI readout is the property's own P&L line.

## 8. The BEAT hypotheses, to be falsified by assay

1. Because every story is an addressable claim set with provenance (the store, stratified), an agent can cite, verify, and subscribe to corrections at claim granularity; no measured incumbent exposes this.
2. Because gates are indexed by jurisdiction, a story can be certified for one jurisdiction and held for another as a border, not an error; no incumbent's legal review is a first-class fibered gate.
3. Because selection, prose, gates, and images run on the internal market with receipts, the property computes its EROEI per story and reallocates the next pulse from it; incumbents measure views, not attention per unit of production cost.

## 9. Acceptance assays

- `build` on the Koios property record yields a home page with hero, section blocks, images, stylesheet, favicon, OG card, full JSON-LD, and every route in §5, verified by a test that parses the built HTML.
- `newsroom-day` on free lanes produces at least ten published stories across at least five sections with hero images and claim ledgers in one pulse, receipted, with the settlement record's cost per story quoted.
- `distribute` posts to the actor outbox and the outbox shows the Create; IndexNow returns 200; the news sitemap lists the day's stories.
- A preview Worker serves the built site; production is the same deploy with the route, gated only by the build's own conformance checks and the readback.
- A second property record (a sports or celebrity vertical) builds and previews from the same app with no code change.

## 10. Standing gaps this specification names

The free inference lanes the newsroom day depends on are not reachable today: the Gemini provider's Cloud Run endpoint answers 503 and no provider server runs on any host, so the market cannot buy prose; admitting the free lanes as in-process providers is the earliest broken edge. Provider keys must reach the production host through the house secrets tooling, never by hand. The house advertising engine is source-only and must publish before ads serve. The ScheduleDelivery timer on Cold Red Gate is staged and disabled until a schedule is accepted, which this program accepts. Accounts that require a phone-verified human identity (a Google account for Publisher Center and Search Console) are the only items that reach the founder; pseudonymous property accounts (Bluesky, Buttondown) are made with house email.
