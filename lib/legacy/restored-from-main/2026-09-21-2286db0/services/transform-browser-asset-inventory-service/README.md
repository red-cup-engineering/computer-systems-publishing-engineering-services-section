# Transform Browser Asset Inventory Service

`@red-cup-engineering/transform-browser-asset-inventory-service` converts a
completed site artifact inventory into an equivalent inventory with immutable,
content-addressed browser assets.

```js
import { transformBrowserAssetInventory } from
  "@red-cup-engineering/transform-browser-asset-inventory-service";

const transformed = transformBrowserAssetInventory({
  artifacts,
  config: { includePaths: ["styles.css", "scripts/app.mjs"] },
});
```

By default `.css`, `.js`, and `.mjs` artifacts are selected. Their final bytes
receive a SHA-256-derived filename and
`public, max-age=31536000, immutable` cache metadata. Local references in HTML,
CSS imports/URLs, and ECMAScript static, re-export, bare, and dynamic imports
are rewritten. Dependencies are transformed before importers, so an imported
module change also changes the importing module's final filename. Reference
cycles are refused rather than assigned misleading content hashes.

Callers may explicitly select binary images, fonts, or downloads. Ordinary
HTML URL attributes and CSS URLs are rewritten to their fingerprinted names,
while the binary bytes are preserved exactly.

Local `<script src>` and `<link rel="stylesheet" href>` references receive an
SRI `sha384-...` value identifying the emitted bytes. Integrity is deliberately
not attached to images or arbitrary links. An `asset-manifest.json` records the
source-to-output mapping, byte count, SHA-256 digest, and SHA-384 integrity;
the manifest can be renamed or disabled.

This package transforms an inventory: it does not mutate files, invoke a
bundler, or act as a same-phase additive projector. A fusion build should run
it after ordinary pages/assets are rendered and before search indexing, PWA
precache generation, static-site conformance, and the final release manifest.
VICTOR can later replace its ordinary artifact map with the returned inventory
at that boundary without moving deployment behavior into VICTOR.

The legacy Eleventy garden established useful acceptance behavior for
compressed Sass, minified browser output, responsive images, and favicons. This
first lower slice closes the missing cache-busting and integrity portion. JS/CSS
syntax optimization and media transformation remain separate future services
so they can use real language/image tooling rather than regex minification.

Run `npm run check && npm test && npm pack --dry-run` for syntax, tests, and package-content checks.
