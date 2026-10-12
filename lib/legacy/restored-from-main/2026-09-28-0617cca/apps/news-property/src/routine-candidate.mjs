/** The single engineering-owned public carrier for an admitted Koios.News article. */
import { buildProperty, parsePost } from "./build.mjs";

export { parsePost };

const ROUTINE_PROPERTY = Object.freeze({
  name: "Koios.News",
  origin: "https://koios.news",
  tagline: "Independent reporting and analysis.",
  language: "en",
  locale: "en_US",
  content: Object.freeze({ postsDirectory: ".", defaultPublishedSection: "news" }),
  sections: Object.freeze([Object.freeze({ slug: "news", title: "News" })]),
  masthead: Object.freeze({ desks: Object.freeze([]), authors: Object.freeze([]) }),
  theme: Object.freeze({}),
});

/** Build an admitted flat routine corpus as the same reader-facing property. */
export function buildRoutineCandidate({ contentDir, outputDir }) {
  return buildProperty({ property: ROUTINE_PROPERTY, contentDir, outputDir });
}
