/**
 * The news-property theme: light/dark palette derivation on
 * `@red-cup-engineering/web-theming-service`, plus the Koios.News "mill"
 * identity (cream paper, near-black ink, one red accent, heavy uppercase
 * display type over serif text, hard rules, no motion) rebuilt as chrome CSS
 * over that palette. A property's `theme.seeds` override the Koios seeds;
 * absent seeds fall back to them, so a bare property record still renders a
 * complete, on-brand theme.
 */
import { themePalette, paletteCss, assembleCss, BASE_CSS, COMPONENT_CSS } from "@red-cup-engineering/web-theming-service/theming";

/** The Koios.News identity seeds, used when a property supplies none. */
export const KOIOS_SEEDS = Object.freeze({
  ink: "#121212",
  surface: "#f4f1e8",
  accent: "#d11a1a",
  alarm: "#c33",
});

/** The Koios.News type and layout tokens, used when a property supplies none. */
export const KOIOS_TYPE = Object.freeze({
  sans: `"Archivo", system-ui, -apple-system, "Segoe UI", sans-serif`,
  serif: `Georgia, "Times New Roman", serif`,
  mono: `"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace`,
  measure: "40rem",
  radius: "0",
});

/**
 * Resolve a property's theme seeds and type tokens against the Koios
 * defaults: any seed or type token the property omits falls back.
 * @param {object} [propertyTheme] a property record's `theme` field
 * @returns {{seeds: object, type: object}}
 */
export function resolveThemeSpec(propertyTheme = {}) {
  const seeds = { ...KOIOS_SEEDS, ...(propertyTheme.seeds ?? {}) };
  const type = { ...KOIOS_TYPE, ...(propertyTheme.fonts ?? {}) };
  if (typeof propertyTheme.measure === "string" && propertyTheme.measure.trim() !== "") {
    type.measure = propertyTheme.measure.trim();
  }
  return { seeds, type };
}

// Chrome layer — generalized from the Koios.News carrier's CHROME_CSS
// (sites/koios.news/src/theme.mts): masthead, story grid, article typography,
// taxonomy/archive list pages, forms, ad slots, footer, accessibility. Class
// names are shared with src/render/templates.mjs so this stylesheet and that
// markup stay one contract. Extended here with the surfaces the
// specification adds beyond the retired carrier: the claim/omission ledger,
// related stories, share links, newsletter capture, most-read module,
// masthead/desk cards, and search.
const CHROME_CSS = `
/* === BASE OVERRIDES === */
body { max-width: 66rem; margin: 0 auto; padding: 0 1.5rem; font-family: var(--serif); }
h1, h2, h3, h4 { font-family: var(--sans); font-weight: 800; }
a { color: inherit; }

/* === SKIP LINK === */
.skip-to-content { position: absolute; left: -9999px; top: 0; z-index: 10; background: var(--surface); color: var(--ink); padding: .6rem 1rem; }
.skip-to-content:focus { position: static; }

/* === MASTHEAD === */
header[role=banner] { border-bottom: 5px solid var(--rule); padding-top: 1.5rem; margin-bottom: 2rem; }
.site-title { font-family: var(--sans); font-weight: 900; font-size: clamp(2rem, 8vw, 3.5rem);
  text-transform: uppercase; letter-spacing: -.03em; line-height: .9; color: var(--ink); text-decoration: none; display: inline-block; }
.site-title:hover { color: var(--accent); }
.site-tagline { display: block; font-family: var(--sans); font-size: .78rem; font-weight: 600;
  text-transform: uppercase; letter-spacing: .14em; color: var(--accent); margin-top: .5rem; }
header[role=banner] nav { display: flex; flex-wrap: wrap; gap: 1.4rem; margin-top: 1.1rem; padding: .6rem 0;
  border-top: 2px solid var(--rule); font-family: var(--sans); font-size: .8rem; font-weight: 700;
  text-transform: uppercase; letter-spacing: .05em; }
header[role=banner] nav a { text-decoration: none; color: var(--ink); }
header[role=banner] nav a:hover, header[role=banner] nav a[aria-current=page] { color: var(--accent); }

/* === HOME: lead + three-column top block + section blocks + latest list === */
.stories { display: grid; grid-template-columns: 1fr; }
@media (min-width: 46rem) {
  .stories { grid-template-columns: 1fr 1fr; column-gap: 2.5rem; }
  .story--lead { grid-column: 1 / -1; }
  .top-block { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(3, 1fr); gap: 0 2rem; }
}
.story { min-width: 0; padding: 1.4rem 0; border-bottom: 1px solid var(--rule); }
.story__image { display: block; margin-bottom: .8rem; border: 3px solid var(--rule); background: var(--surface-deep); }
.story__image img { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; border: 0; margin: 0; }
.story__kicker { display: inline-block; font-family: var(--sans); font-size: .7rem; font-weight: 700;
  text-transform: uppercase; letter-spacing: .1em; color: var(--accent); margin-bottom: .45rem; }
.story__head { font-size: 1.45rem; margin-bottom: .4rem; }
.story__head a { text-decoration: none; color: var(--ink); }
.story__head a:hover { color: var(--accent); }
.story__sum { color: var(--ink); margin-bottom: .5rem; max-width: 60ch; }
.story__meta { font-family: var(--sans); font-size: .72rem; font-weight: 600; text-transform: uppercase;
  letter-spacing: .06em; color: var(--ink-soft); }
.story--lead { border-bottom-width: 5px; padding-bottom: 1.8rem; }
.story--lead .story__head { font-size: clamp(1.9rem, 5vw, 2.9rem); line-height: 1.0; }
.story--lead .story__sum { font-size: 1.15rem; line-height: 1.45; }
.story--lead .story__image { border-width: 5px; margin-bottom: 1rem; }
.section-block { margin-top: 2rem; padding-top: 1rem; border-top: 5px solid var(--rule); }
.section-block > h2 { font-size: 1.1rem; text-transform: uppercase; margin-bottom: .3rem; }
.section-block > h2 a { color: var(--ink); text-decoration: none; }
.latest-list { margin-top: 2rem; padding-top: 1rem; border-top: 5px solid var(--rule); }
.most-read { margin-top: 2rem; padding-top: 1rem; border-top: 5px solid var(--rule); }
.most-read ol { list-style: decimal; padding-left: 1.3rem; }
.most-read li { padding: .4rem 0; }
.most-read a { color: var(--ink); text-decoration: none; }
.most-read a:hover { color: var(--accent); }

/* === FOLLOW === */
.follow-feeds { margin: 2.4rem 0; padding: 1.2rem; border: 3px solid var(--rule); background: var(--surface-deep); }
.follow-feeds h2 { font-size: 1rem; text-transform: uppercase; margin-bottom: .5rem; }
.follow-feeds__links { display: flex; flex-wrap: wrap; gap: 1rem; }

/* === PAID PRODUCT === */
.paid-product { margin: 2.4rem 0; padding: 1.2rem; border: 3px solid var(--accent); background: var(--surface-deep); }
.paid-product h2 { font-size: 1rem; text-transform: uppercase; margin-bottom: .5rem; }
.paid-product p { margin-bottom: .9rem; }
.paid-product__buy { display: inline-block; font-family: var(--sans); font-weight: 800; text-transform: uppercase; letter-spacing: .05em; color: var(--paper); background: var(--accent); padding: .65rem .85rem; text-decoration: none; }
.paid-product__buy:hover { background: var(--ink); }

/* === ARTICLE === */
article.h-entry { max-width: var(--measure); margin: 0 auto; }
.article-kicker { display: block; font-family: var(--sans); font-size: .78rem; font-weight: 800; text-transform: uppercase;
  letter-spacing: .1em; color: var(--accent); margin-bottom: .5rem; }
.article-kicker a { color: inherit; text-decoration: none; }
article.h-entry > .p-name { font-size: clamp(1.8rem, 5vw, 2.7rem); line-height: 1.02; letter-spacing: -.02em; margin-bottom: .5rem; }
.article-dek { font-size: 1.15rem; line-height: 1.45; color: var(--ink); margin-bottom: .8rem; }
.article-byline { font-family: var(--sans); font-size: .78rem; font-weight: 600; text-transform: uppercase; letter-spacing: .05em;
  color: var(--ink-soft); padding: .6rem 0; margin-bottom: 1.4rem; border-top: 2px solid var(--rule); border-bottom: 2px solid var(--rule); }
.article-byline a { color: var(--accent); font-weight: 700; text-decoration: none; }
.article-byline time { margin-right: 1rem; }
.article-hero { margin: 0 0 1.6rem; border: 5px solid var(--rule); background: var(--surface-deep); }
.article-hero img { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; border: 0; margin: 0; }
.article-hero figcaption { font-family: var(--sans); font-size: .74rem; color: var(--ink-soft); padding: .5rem .2rem; }
.e-content { font-size: 1.15rem; line-height: 1.65; }
.e-content > * + * { margin-top: 1.1rem; }
.e-content h2 { font-family: var(--sans); font-weight: 800; font-size: 1.4rem; text-transform: uppercase;
  letter-spacing: -.01em; margin-top: 2.2rem; padding-top: .8rem; border-top: 2px solid var(--rule); }
.e-content h3 { font-family: var(--sans); font-weight: 800; font-size: 1.15rem; margin-top: 1.6rem; }
.e-content a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
.e-content blockquote { border-left: 5px solid var(--accent); padding: .3rem 0 .3rem 1.2rem; margin: 1.6rem 0; font-style: italic; }
.e-content img { border: 1px solid var(--rule); margin: 1.6rem 0; }

/* === LEDGERS === */
.ledger { max-width: var(--measure); margin: 2rem auto 0; padding-top: 1rem; border-top: 5px solid var(--rule); }
.ledger h2 { font-size: 1.05rem; text-transform: uppercase; margin-bottom: .6rem; }
.ledger ol { padding-left: 1.3rem; }
.ledger li { margin-top: .5rem; }
.ledger cite { font-style: normal; font-family: var(--sans); font-size: .78rem; color: var(--ink-soft); display: block; margin-top: .15rem; }
.ledger--omissions { border-top-style: dashed; }

/* === RELATED / SHARE / CORRECTIONS / RIGHTS === */
.related-stories { max-width: var(--measure); margin: 2.2rem auto 0; padding-top: 1rem; border-top: 5px solid var(--rule); }
.related-stories > h2 { font-size: 1.1rem; text-transform: uppercase; margin-bottom: .3rem; }
.related-stories__grid { display: grid; gap: 0; border-top: 1px solid var(--rule); }
.related-story { padding: .9rem 0; border-bottom: 1px solid var(--rule); }
.related-story a { color: var(--ink); text-decoration: none; }
.related-story a:hover { color: var(--accent); }
@media (min-width: 50rem) {
  .related-stories__grid { grid-template-columns: repeat(3, 1fr); border-left: 1px solid var(--rule); }
  .related-story { border-right: 1px solid var(--rule); padding: .9rem .8rem; }
}
.share-links { max-width: var(--measure); margin: 1.6rem auto 0; display: flex; flex-wrap: wrap; gap: .6rem;
  font-family: var(--sans); font-size: .74rem; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; }
.share-links a, .share-links button { border: 1.5px solid var(--rule); padding: .3rem .7rem; text-decoration: none; color: var(--ink); background: transparent; }
.share-links a:hover, .share-links button:hover { background: var(--ink); color: var(--surface); }
.share-links__status { align-self: center; color: var(--ink-soft); font-size: .8rem; }
.correction-notice { max-width: var(--measure); margin: 1.8rem auto 0; padding: .9rem 0; border-top: 5px solid var(--rule); border-bottom: 2px solid var(--rule); }
.correction-notice h2 { font-size: 1rem; text-transform: uppercase; margin: 0 0 .5rem; }
.correction-notice ol { padding-left: 1.3rem; }
.article-rights { max-width: var(--measure); margin: 2rem auto 0; padding-top: .9rem; border-top: 2px solid var(--rule);
  font-family: var(--sans); font-size: .78rem; line-height: 1.45; color: var(--ink-soft); }

/* === DESK / MASTHEAD / AUTHOR CARDS === */
.masthead-grid, .desk-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr)); gap: 1rem; margin: 1.4rem 0; }
.masthead-card { border: 1.5px solid var(--rule); padding: 1rem 1.1rem; }
.masthead-card h3 { font-size: 1rem; text-transform: uppercase; }
.masthead-card p { margin-top: .3rem; font-size: .92rem; color: var(--ink-soft); }

/* === TAGS === */
.tags { max-width: var(--measure); margin: 1.8rem auto 0; }
.tags a { display: inline-block; font-family: var(--sans); font-size: .7rem; font-weight: 600; text-transform: uppercase;
  letter-spacing: .06em; text-decoration: none; border: 1.5px solid var(--rule); padding: .2rem .5rem; margin: 0 .35rem .35rem 0; color: var(--ink); }
.tags a:hover { background: var(--ink); color: var(--surface); }

/* === LIST / TAXONOMY / SEARCH === */
main > h1 { font-family: var(--sans); font-weight: 900; font-size: clamp(1.8rem, 5vw, 2.6rem);
  text-transform: uppercase; letter-spacing: -.02em; margin-bottom: 1.2rem; }
ul.pages { list-style: none; }
ul.pages li { padding: .9rem 0; border-bottom: 1px solid var(--rule); }
.search-form { display: flex; gap: .6rem; max-width: var(--measure); margin: 1rem 0 1.6rem; }
.search-form input { flex: 1; }
#search-results li { padding: .7rem 0; border-bottom: 1px solid var(--rule); }

/* === FORMS === */
input, button, textarea, select { font-family: var(--sans); font-size: .9rem; color: var(--ink); background: var(--surface);
  border: 2px solid var(--rule); border-radius: 0; padding: .35rem .6rem; }
button { font-weight: 700; text-transform: uppercase; letter-spacing: .05em; cursor: pointer; }
button:hover { background: var(--ink); color: var(--surface); }

/* === AD SLOTS === */
.ad-slot { min-height: 90px; margin: 1.6rem auto; display: grid; place-items: center;
  font-family: var(--sans); font-size: .7rem; color: var(--ink-soft); max-width: var(--measure); }
.ad-slot iframe, .ad-slot ins { border: 0; width: 100%; }
.ad-slot--paid { width: 100%; min-height: 130px; grid-template-rows: auto 110px; gap: .25rem; }
.ad-slot--paid iframe { display: block; height: 110px; overflow: hidden; }
.ad-slot__label { display: block; text-transform: uppercase; letter-spacing: .08em; }

/* === PAGINATION === */
.pagination { display: flex; gap: 1rem; justify-content: space-between; font-family: var(--sans); font-size: .8rem;
  margin: 2rem 0; padding-top: 1rem; border-top: 1px solid var(--rule); }

/* === FOOTER === */
footer[role=contentinfo] { border-top: 5px solid var(--rule); margin-top: 3rem; padding: 1.5rem 0 3rem;
  font-family: var(--sans); font-size: .78rem; line-height: 1.5; }
footer[role=contentinfo] a { color: var(--accent); text-decoration: underline; }
footer[role=contentinfo] .inner { display: flex; flex-wrap: wrap; gap: 1rem; }
footer[role=contentinfo] .inner span:first-child { flex-basis: 100%; font-family: var(--serif); font-style: italic; }

/* === PRINT === */
@media print {
  :root { --ink: #121212; --surface: #ffffff; --rule: #121212; }
  header[role=banner], footer[role=contentinfo], .ad-slot, .share-links, .follow-feeds, .skip-to-content { display: none !important; }
  body { max-width: 100%; padding: 0; }
  a { text-decoration: underline; color: var(--ink) !important; }
}
`;

/**
 * Build the property's complete stylesheet: the certified palette (light and
 * dark), the shared reset and component library, and the news-property
 * chrome layer.
 * @param {object} [propertyTheme] a property record's `theme` field
 * @returns {{css: string, seeds: object, type: object}}
 */
export function buildTheme(propertyTheme = {}) {
  const { seeds, type } = resolveThemeSpec(propertyTheme);
  const palette = themePalette(seeds, type);
  const css = assembleCss(palette, CHROME_CSS);
  return { css, seeds, type, palette };
}

export { paletteCss, BASE_CSS, COMPONENT_CSS };
