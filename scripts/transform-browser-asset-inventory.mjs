import { createHash } from 'node:crypto';
import { dirname, extname, posix } from 'node:path';
import { sha256Hex } from "@red-cup-engineering/cryptographic-computer-data-engineering-services-section/integrity";
import { sha256 } from "@red-cup-engineering/cryptographic-computer-data-engineering-services-section/hash";

const IMMUTABLE = 'public, max-age=31536000, immutable';
const DEFAULT_EXTENSIONS = Object.freeze(['.css', '.js', '.mjs']);
const HTML_ATTRIBUTES = Object.freeze(new Map([
  ['a', ['href']], ['area', ['href']], ['audio', ['src']], ['embed', ['src']],
  ['form', ['action']], ['iframe', ['src']], ['img', ['src']], ['input', ['src']],
  ['link', ['href']], ['object', ['data']], ['script', ['src']], ['source', ['src']],
  ['track', ['src']], ['video', ['src', 'poster']],
]));

/** Transform one completed inventory into immutable fingerprinted JS/CSS assets. */
export function transformBrowserAssetInventory({ artifacts, config = {} } = {}) {
  const diagnostics = [];
  let inventory;
  let options;
  try {
    inventory = normalizedInventory(artifacts);
    options = normalizedConfig(config);
  } catch (error) {
    return failed('BAI-001', error instanceof Error ? error.message : String(error));
  }
  const selected = selectedPaths(inventory, options, diagnostics);
  if (diagnostics.length > 0) return emptyResult(diagnostics);
  const mapping = new Map();
  const visiting = [];

  function fingerprint(path) {
    if (mapping.has(path)) return mapping.get(path);
    const cycleAt = visiting.indexOf(path);
    if (cycleAt !== -1) {
      diagnostics.push(diagnostic('BAI-002', `fingerprinted asset references form a cycle: ${[...visiting.slice(cycleAt), path].join(' -> ')}`, path));
      return undefined;
    }
    visiting.push(path);
    const record = inventory.get(path);
    let body = record.body;
    if (typeof body === 'string') {
      const dependencies = referencedSelectedPaths(path, body, selected);
      for (const dependency of dependencies) fingerprint(dependency);
      if (diagnostics.length === 0) body = rewriteText(path, body, mapping, { integrity: false });
    } else if (/\.(?:css|m?js)$/iu.test(path)) {
      diagnostics.push(diagnostic('BAI-005', 'selected JS/CSS asset must have a text body', path));
    }
    visiting.pop();
    if (diagnostics.length > 0) return undefined;
    const bytes = typeof body === 'string' ? Buffer.from(body, 'utf8') : Buffer.from(body);
    const hash = sha256Hex(bytes).slice(0, options.hashLength);
    const target = fingerprintedPath(path, hash);
    if ((inventory.has(target) && !selected.has(target)) || [...mapping.values()].some((item) => item.path === target)) {
      diagnostics.push(diagnostic('BAI-003', 'fingerprinted asset path collides with another artifact', target));
      return undefined;
    }
    const item = Object.freeze({
      source: path, path: target, body, bytes: bytes.byteLength,
      digest: `sha256-${sha256(bytes).toString("base64")}`,
      integrity: `sha384-${createHash('sha384').update(bytes).digest('base64')}`,
    });
    mapping.set(path, item);
    return item;
  }

  for (const path of [...selected].sort(compareText)) fingerprint(path);
  if (diagnostics.length > 0) return emptyResult(diagnostics);

  const output = new Map();
  for (const [path, record] of inventory) {
    if (selected.has(path)) continue;
    const body = isRewritable(path, record.mediaType) && typeof record.body === 'string'
      ? rewriteText(path, record.body, mapping, { integrity: options.integrity })
      : record.body;
    output.set(path, freezeRecord({ ...record, body }));
  }
  for (const item of [...mapping.values()].sort((left, right) => compareText(left.path, right.path))) {
    const source = inventory.get(item.source);
    output.set(item.path, freezeRecord({ ...source, body: item.body, cacheControl: IMMUTABLE,
      provenance: Object.freeze({ transformer: 'browser-asset-inventory', source: item.source, integrity: item.integrity,
        ...(source.provenance === undefined ? {} : { input: source.provenance }) }) }));
  }

  const manifest = deepFreeze({
    kind: 'browser-asset-manifest', version: 1,
    assets: [...mapping.values()].sort((left, right) => compareText(left.source, right.source)).map(({ source, path, bytes, digest, integrity }) => ({ source, path, bytes, digest, integrity })),
  });
  if (options.manifestPath !== false) {
    if (output.has(options.manifestPath)) return emptyResult([diagnostic('BAI-003', 'asset manifest path collides with another artifact', options.manifestPath)]);
    output.set(options.manifestPath, freezeRecord({
      body: `${JSON.stringify(manifest, null, 2)}\n`, mediaType: 'application/json; charset=utf-8',
      cacheControl: 'public, max-age=0, must-revalidate', provenance: Object.freeze({ transformer: 'browser-asset-inventory' }),
    }));
  }
  return deepFreeze({ artifacts: [...output].sort(([left], [right]) => compareText(left, right)).map(([path, record]) => ({ ...record, path })), mapping: manifest.assets, manifest, diagnostics });
}

function normalizedConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new TypeError('config must be an object');
  const hashLength = config.hashLength ?? 12;
  if (!Number.isInteger(hashLength) || hashLength < 8 || hashLength > 64) throw new TypeError('hashLength must be an integer from 8 through 64');
  const includePaths = optionalPaths(config.includePaths, 'includePaths');
  const excludePaths = new Set(optionalPaths(config.excludePaths, 'excludePaths') ?? []);
  const extensions = config.extensions ?? DEFAULT_EXTENSIONS;
  if (!Array.isArray(extensions) || extensions.some((item) => typeof item !== 'string' || !/^\.[a-z0-9]+$/iu.test(item))) throw new TypeError('extensions must be an array of dotted file extensions');
  const manifestPath = config.manifestPath === false ? false : safePath(config.manifestPath ?? 'asset-manifest.json', 'manifestPath');
  if (config.integrity !== undefined && typeof config.integrity !== 'boolean') throw new TypeError('integrity must be boolean');
  return Object.freeze({ hashLength, includePaths, excludePaths, extensions: new Set(extensions.map((item) => item.toLowerCase())), manifestPath, integrity: config.integrity !== false });
}

function selectedPaths(inventory, options, diagnostics) {
  const selected = new Set();
  if (options.includePaths !== undefined) {
    for (const path of options.includePaths) {
      if (!inventory.has(path)) diagnostics.push(diagnostic('BAI-004', 'included asset is absent from the inventory', path));
      else if (!options.excludePaths.has(path)) selected.add(path);
    }
  } else {
    for (const path of inventory.keys()) if (options.extensions.has(extname(path).toLowerCase()) && !options.excludePaths.has(path)) selected.add(path);
  }
  return selected;
}

function referencedSelectedPaths(sourcePath, body, selected) {
  const result = new Set();
  visitReferences(sourcePath, body, (reference) => { if (selected.has(reference.path)) result.add(reference.path); });
  return [...result].sort(compareText);
}

function rewriteText(sourcePath, body, mapping, { integrity }) {
  if (sourcePath.endsWith('.html') || sourcePath.endsWith('.htm')) return rewriteHtml(sourcePath, body, mapping, integrity);
  if (sourcePath.endsWith('.css')) return rewriteCss(sourcePath, body, mapping);
  if (sourcePath.endsWith('.js') || sourcePath.endsWith('.mjs')) return rewriteJavaScript(sourcePath, body, mapping);
  return body;
}

function rewriteHtml(sourcePath, html, mapping, integrity) {
  return html.replace(/<([a-z][a-z0-9-]*)(?:\s[^<>]*?)?>/giu, (tag, rawName) => {
    const name = rawName.toLowerCase();
    const attributes = HTML_ATTRIBUTES.get(name);
    if (attributes === undefined) return tag;
    let result = tag;
    let integrityAsset;
    for (const attribute of attributes) {
      const found = attributeMatch(result, attribute);
      if (found === undefined) continue;
      const reference = resolveReference(sourcePath, found.value);
      const asset = reference === undefined ? undefined : mapping.get(reference.path);
      if (asset === undefined) continue;
      result = replaceAttribute(result, found, rewrittenReference(sourcePath, found.value, asset.path));
      if ((name === 'script' && attribute === 'src') || (name === 'link' && attribute === 'href' && isStylesheetLink(result))) integrityAsset = asset;
    }
    if (integrityAsset !== undefined) result = integrity
      ? setAttribute(result, 'integrity', integrityAsset.integrity)
      : removeAttribute(result, 'integrity');
    return result;
  });
}

function rewriteCss(sourcePath, css, mapping) {
  let output = css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/giu, (whole, quote, value) => {
    const asset = mappedReference(sourcePath, value, mapping);
    return asset === undefined ? whole : `url(${quote}${rewrittenReference(sourcePath, value, asset.path)}${quote})`;
  });
  output = output.replace(/(@import\s+)(["'])([^"']+)\2/giu, (whole, prefix, quote, value) => {
    const asset = mappedReference(sourcePath, value, mapping);
    return asset === undefined ? whole : `${prefix}${quote}${rewrittenReference(sourcePath, value, asset.path)}${quote}`;
  });
  return output;
}

function rewriteJavaScript(sourcePath, javascript, mapping) {
  return javascript.replace(/(\b(?:import|export)\s+(?:[^'";]*?\s+from\s*)?|\bimport\s*\(\s*)(["'])([^"']+)\2/gu, (whole, prefix, quote, value) => {
    const asset = mappedReference(sourcePath, value, mapping);
    return asset === undefined ? whole : `${prefix}${quote}${rewrittenReference(sourcePath, value, asset.path)}${quote}`;
  });
}

function visitReferences(sourcePath, body, visit) {
  if (sourcePath.endsWith('.css')) {
    for (const match of body.matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)|@import\s+(["'])([^"']+)\3/giu)) visitResolved(sourcePath, match[2] ?? match[4], visit);
  } else if (sourcePath.endsWith('.js') || sourcePath.endsWith('.mjs')) {
    for (const match of body.matchAll(/(?:\b(?:import|export)\s+(?:[^'";]*?\s+from\s*)?|\bimport\s*\(\s*)(["'])([^"']+)\1/gu)) visitResolved(sourcePath, match[2], visit);
  }
}

function visitResolved(sourcePath, value, visit) { const found = resolveReference(sourcePath, value); if (found !== undefined) visit(found); }
function mappedReference(sourcePath, value, mapping) { const found = resolveReference(sourcePath, value); return found === undefined ? undefined : mapping.get(found.path); }
function resolveReference(sourcePath, raw) {
  if (typeof raw !== 'string' || raw.startsWith('#') || /^[a-z][a-z0-9+.-]*:/iu.test(raw) || raw.startsWith('//')) return undefined;
  let url;
  try { url = new URL(raw, `https://inventory.invalid/${sourcePath}`); } catch { return undefined; }
  if (url.origin !== 'https://inventory.invalid') return undefined;
  let path;
  try { path = decodeURIComponent(url.pathname.slice(1)); } catch { return undefined; }
  return Object.freeze({ path, search: url.search, hash: url.hash });
}

function rewrittenReference(sourcePath, raw, targetPath) {
  const found = resolveReference(sourcePath, raw);
  const suffix = `${found?.search ?? ''}${found?.hash ?? ''}`;
  if (raw.startsWith('/')) return `/${targetPath}${suffix}`;
  const relative = posix.relative(dirname(sourcePath), targetPath) || posix.basename(targetPath);
  return `${raw.startsWith('./') && !relative.startsWith('.') ? './' : ''}${relative}${suffix}`;
}

function fingerprintedPath(path, hash) { const extension = extname(path); return extension ? `${path.slice(0, -extension.length)}.${hash}${extension}` : `${path}.${hash}`; }
function isStylesheetLink(tag) { return /\brel\s*=\s*(?:["'][^"']*\bstylesheet\b[^"']*["']|stylesheet(?:\s|>))/iu.test(tag); }
function attributeMatch(tag, name) {
  const expression = new RegExp(`\\b${name}\\s*=\\s*(?:(["'])(.*?)\\1|([^\\s>]+))`, 'iu');
  const match = expression.exec(tag);
  return match === null ? undefined : { index: match.index, length: match[0].length, prefix: match[0].slice(0, match[0].indexOf('=') + 1), quote: match[1] ?? '"', value: match[2] ?? match[3] };
}
function replaceAttribute(tag, match, value) { return `${tag.slice(0, match.index)}${match.prefix}${match.quote}${value}${match.quote}${tag.slice(match.index + match.length)}`; }
function setAttribute(tag, name, value) {
  const found = attributeMatch(tag, name);
  if (found !== undefined) return replaceAttribute(tag, found, value);
  return tag.replace(/\s*\/?>(?=$)/u, (end) => ` ${name}="${value}"${end}`);
}
function removeAttribute(tag, name) {
  const found = attributeMatch(tag, name);
  if (found === undefined) return tag;
  const start = found.index > 0 && /\s/u.test(tag[found.index - 1]) ? found.index - 1 : found.index;
  return `${tag.slice(0, start)}${tag.slice(found.index + found.length)}`;
}

function normalizedInventory(value) {
  if (!value || typeof value[Symbol.iterator] !== 'function') throw new TypeError('artifacts must be an iterable inventory');
  const result = new Map();
  for (const entry of value) {
    const tuple = Array.isArray(entry); const path = tuple ? entry[0] : entry?.path; const raw = tuple ? entry[1] : entry;
    safePath(path, 'artifact path');
    if (result.has(path)) throw new TypeError(`artifact path is duplicated: ${path}`);
    const record = raw && typeof raw === 'object' && !(raw instanceof Uint8Array) && 'body' in raw ? raw : { body: raw };
    if (typeof record.body !== 'string' && !(record.body instanceof Uint8Array)) throw new TypeError(`artifact body must be a string or Uint8Array: ${path}`);
    result.set(path, freezeRecord(record));
  }
  return result;
}
function optionalPaths(value, field) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new TypeError(`${field} must be an array`);
  return Object.freeze([...new Set(value.map((path) => safePath(path, field)))].sort(compareText));
}
function safePath(value, field) {
  if (typeof value !== 'string' || !value || value.startsWith('/') || value.includes('\\') || /[?#\u0000-\u001f\u007f]/u.test(value) || value.split('/').some((part) => !part || part === '.' || part === '..')) throw new TypeError(`${field} must contain safe relative artifact paths`);
  return value;
}
function isRewritable(path, mediaType) { return /\.(?:html?|css|m?js)$/iu.test(path) || /^(?:text\/html|text\/css|application\/(?:java|ecma)script)/iu.test(mediaType ?? ''); }
function freezeRecord(record) { return Object.freeze({ ...record }); }
function compareText(left, right) { return left < right ? -1 : left > right ? 1 : 0; }
function diagnostic(code, message, subject) { return Object.freeze({ severity: 'error', code, message, subject }); }
function failed(code, message) { return emptyResult([diagnostic(code, message, 'input')]); }
function emptyResult(diagnostics) { return deepFreeze({ artifacts: [], mapping: [], manifest: null, diagnostics }); }
function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value) || ArrayBuffer.isView(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}
