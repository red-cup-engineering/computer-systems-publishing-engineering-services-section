import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { transformBrowserAssetInventory } from '../scripts/transform-browser-asset-inventory.mjs';

function map(result) { return new Map(result.artifacts.map(({ path, ...artifact }) => [path, artifact])); }

test('fingerprints final CSS and JS bytes, rewrites HTML, and adds SHA-384 SRI', () => {
  const input = new Map([
    ['index.html', '<link rel="stylesheet" href="/styles.css"><script type="module" src="./scripts/app.mjs"></script>'],
    ['styles.css', 'body { color: navy; }'],
    ['scripts/app.mjs', 'console.log("ready");\n'],
  ]);
  const first = transformBrowserAssetInventory({ artifacts: input });
  const second = transformBrowserAssetInventory({ artifacts: input });
  assert.deepEqual(first, second);
  assert.deepEqual(first.diagnostics, []);
  const output = map(first);
  const css = first.mapping.find(({ source }) => source === 'styles.css');
  const js = first.mapping.find(({ source }) => source === 'scripts/app.mjs');
  assert.match(css.path, /^styles\.[a-f0-9]{12}\.css$/u);
  assert.match(js.path, /^scripts\/app\.[a-f0-9]{12}\.mjs$/u);
  assert.equal(output.get(css.path).cacheControl, 'public, max-age=31536000, immutable');
  assert.equal(output.has('styles.css'), false);
  assert.match(output.get('index.html').body, new RegExp(`href="/${css.path.replace('.', '\\.')}" integrity="sha384-`));
  assert.match(output.get('index.html').body, new RegExp(`src="\\./${js.path.replace('.', '\\.')}" integrity="sha384-`));
  assert.equal(css.integrity, `sha384-${createHash('sha384').update(output.get(css.path).body).digest('base64')}`);
});

test('rewrites a module dependency before deriving the importing module filename', () => {
  const base = new Map([
    ['index.html', '<script type="module" src="/app.mjs"></script>'],
    ['app.mjs', 'import { value } from "./lib/value.mjs"; console.log(value);'],
    ['lib/value.mjs', 'export const value = 1;'],
  ]);
  const first = transformBrowserAssetInventory({ artifacts: base });
  const changed = new Map(base); changed.set('lib/value.mjs', 'export const value = 2;');
  const second = transformBrowserAssetInventory({ artifacts: changed });
  const firstApp = first.mapping.find(({ source }) => source === 'app.mjs');
  const secondApp = second.mapping.find(({ source }) => source === 'app.mjs');
  assert.notEqual(firstApp.path, secondApp.path);
  const firstValue = first.mapping.find(({ source }) => source === 'lib/value.mjs');
  assert.match(map(first).get(firstApp.path).body, new RegExp(firstValue.path.replace('lib/', 'lib/').replace('.', '\\.')));
});

test('rewrites CSS imports and URLs when their targets are selected explicitly', () => {
  const result = transformBrowserAssetInventory({
    artifacts: new Map([
      ['index.html', '<link rel="stylesheet" href="theme/main.css">'],
      ['theme/main.css', '@import "./colors.css"; .logo{background:url(../logo.svg)}'],
      ['theme/colors.css', ':root{--ink:black}'],
      ['logo.svg', '<svg/>'],
    ]),
    config: { includePaths: ['theme/main.css', 'theme/colors.css', 'logo.svg'] },
  });
  assert.deepEqual(result.diagnostics, []);
  const main = result.mapping.find(({ source }) => source === 'theme/main.css');
  const colors = result.mapping.find(({ source }) => source === 'theme/colors.css');
  const logo = result.mapping.find(({ source }) => source === 'logo.svg');
  const css = map(result).get(main.path).body;
  assert.ok(css.includes(`./${colors.path.split('/').at(-1)}`));
  assert.ok(css.includes(`../${logo.path}`));
});

test('fingerprints binary assets and rewrites HTML references without attaching image SRI', () => {
  const result = transformBrowserAssetInventory({
    artifacts: new Map([['index.html', '<img src="/photo.png"><a href="photo.png">download</a>'], ['photo.png', new Uint8Array([0, 1, 2, 3])]]),
    config: { includePaths: ['photo.png'] },
  });
  assert.deepEqual(result.diagnostics, []);
  const photo = result.mapping[0];
  const html = map(result).get('index.html').body;
  assert.ok(html.includes(`src="/${photo.path}"`));
  assert.ok(html.includes(`href="${photo.path}"`));
  assert.doesNotMatch(html, /integrity=/u);
  assert.deepEqual(map(result).get(photo.path).body, new Uint8Array([0, 1, 2, 3]));
});

test('fails closed on dependency cycles, missing selections, and target collisions', () => {
  const cycle = transformBrowserAssetInventory({ artifacts: new Map([['a.css', '@import "b.css"'], ['b.css', '@import "a.css"']]) });
  assert.equal(cycle.artifacts.length, 0);
  assert.equal(cycle.diagnostics[0].code, 'BAI-002');
  const missing = transformBrowserAssetInventory({ artifacts: new Map([['index.html', 'ok']]), config: { includePaths: ['app.js'] } });
  assert.equal(missing.diagnostics[0].code, 'BAI-004');
  const source = 'body{}';
  const hash = createHash('sha256').update(source).digest('hex').slice(0, 12);
  const collision = transformBrowserAssetInventory({ artifacts: new Map([['site.css', source], [`site.${hash}.css`, 'occupied']]), config: { includePaths: ['site.css'] } });
  assert.equal(collision.diagnostics[0].code, 'BAI-003');
});

test('can omit the asset manifest and SRI while retaining immutable fingerprint metadata', () => {
  const result = transformBrowserAssetInventory({ artifacts: new Map([['index.html', '<script src="app.js" integrity="sha384-stale"></script>'], ['app.js', 'run();']]), config: { manifestPath: false, integrity: false } });
  const output = map(result);
  assert.equal(output.has('asset-manifest.json'), false);
  assert.doesNotMatch(output.get('index.html').body, /integrity=/u);
  assert.match(output.get('index.html').body, /app\.[a-f0-9]{12}\.js/u);
});

test('inventory record path metadata cannot overwrite a fingerprinted output path', () => {
  const result = transformBrowserAssetInventory({
    artifacts: new Map([
      ['index.html', { path: 'index.html', body: '<link rel="stylesheet" href="/styles.css">' }],
      ['styles.css', { path: 'styles.css', body: 'body{}', mediaType: 'text/css' }],
    ]),
  });
  const stylesheet = result.mapping.find(({ source }) => source === 'styles.css');
  assert.ok(map(result).has(stylesheet.path));
  assert.equal(map(result).has('styles.css'), false);
});
