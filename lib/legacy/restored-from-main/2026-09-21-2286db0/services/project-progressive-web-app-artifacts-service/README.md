# Project Progressive Web App Artifacts Service

This package turns an existing release artifact inventory into two ordinary,
deterministic release artifacts:

- a Web App Manifest; and
- a service worker whose precache list and default cache revision are derived
  from the selected artifact paths and bytes.

It extracts the useful offline behavior proven by the North Shore Window site
without carrying that product's name, colors, routes, or hand-maintained cache
version. Generated workers install their precache, remove only older caches
owned by the same prefix, optionally claim clients, serve cache-first GETs,
populate the runtime cache with successful same-origin responses, and use a
cached navigation fallback before returning a configurable offline response.

```js
import {
  createProgressiveWebAppProjector,
} from "@red-cup-engineering/project-progressive-web-app-artifacts-service";

const pwa = createProgressiveWebAppProjector({
  manifest: {
    name: "Field Notebook",
    shortName: "Notebook",
    startUrl: "/",
    themeColor: "#17352b",
    backgroundColor: "#f7f5ed",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
  },
  precache: { additionalUrls: ["/api/bootstrap"] },
  offlineFallback: "/",
});

const contribution = await pwa.project({ artifacts: release.artifacts });
```

By default every input artifact is precached, except an existing artifact at a
generated target. `precache.includePaths` selects an exact subset;
`excludePaths` subtracts paths; `additionalUrls` admits same-origin dynamic
resources. `index.html` becomes `/`, and `section/index.html` becomes
`/section/`. All lists are de-duplicated and sorted.

The default cache name is `<cacheNamePrefix>-<digest>`, where the digest covers
the selected bytes, manifest, URLs, and worker behavior. `cacheName` may pin an
exact name when an external release process owns revisioning. Cache cleanup is
prefix-scoped, so one application cannot erase another application's caches on
the same origin.

The returned `{ artifacts, diagnostics }` is directly compatible with
`build-projector-contract-service`. Because a PWA needs the completed ordinary
artifact inventory, a fusion application should run it as a second projection
phase: project pages/assets first, then call this projector with that result's
`artifacts`, then combine the two inventories under the usual collision policy.

Run `npm run check && npm test && npm pack --dry-run` to check syntax, tests, and package contents.
