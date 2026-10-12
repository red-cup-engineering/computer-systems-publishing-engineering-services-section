import { createHash } from "node:crypto";

const DEFAULT_MANIFEST_PATH = "manifest.webmanifest";
const DEFAULT_WORKER_PATH = "service-worker.js";

function diagnostic(code, message, subject, severity = "error", details) {
  return Object.freeze({
    severity,
    code,
    message,
    ...(subject === undefined ? {} : { subject }),
    ...(details === undefined ? {} : { details }),
  });
}

function safeArtifactPath(value) {
  return typeof value === "string"
    && value.length > 0
    && !value.startsWith("/")
    && !value.includes("\\")
    && value.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
}

function artifactBody(value) {
  if (typeof value === "string" || value instanceof Uint8Array) return value;
  if (value && (typeof value.body === "string" || value.body instanceof Uint8Array)) return value.body;
  return undefined;
}

function inventoryEntries(value, diagnostics) {
  if (!value || typeof value[Symbol.iterator] !== "function") {
    diagnostics.push(diagnostic("PWA-001", "artifacts must be a Map or iterable inventory", "artifacts"));
    return new Map();
  }
  const entries = new Map();
  for (const candidate of value) {
    const path = Array.isArray(candidate) ? candidate[0] : candidate?.path;
    const raw = Array.isArray(candidate) ? candidate[1] : candidate;
    const body = artifactBody(raw);
    if (!safeArtifactPath(path) || body === undefined) {
      diagnostics.push(diagnostic("PWA-001", "each artifact needs a safe relative path and string or Uint8Array body", path));
      continue;
    }
    if (entries.has(path)) {
      diagnostics.push(diagnostic("PWA-001", "artifact paths must be unique", path));
      continue;
    }
    entries.set(path, body);
  }
  return new Map([...entries].sort(([left], [right]) => left.localeCompare(right)));
}

function sameOriginPath(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return false;
  try {
    const url = new URL(value, "https://pwa.invalid");
    return url.origin === "https://pwa.invalid" && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
}

function urlForArtifact(path) {
  const segments = path.split("/").map(encodeURIComponent);
  if (segments.at(-1) === "index.html") {
    segments.pop();
    return `/${segments.length ? `${segments.join("/")}/` : ""}`;
  }
  return `/${segments.join("/")}`;
}

function stringArray(value, subject, diagnostics) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    diagnostics.push(diagnostic("PWA-002", `${subject} must be an array of strings`, subject));
    return [];
  }
  return [...new Set(value)].sort();
}

function manifestObject(config, diagnostics) {
  const manifest = config.manifest ?? {};
  const name = manifest.name;
  if (typeof name !== "string" || name.trim().length === 0) {
    diagnostics.push(diagnostic("PWA-002", "manifest.name must be a non-empty string", "manifest.name"));
  }
  const optionalString = (key) => {
    const value = manifest[key];
    if (value === undefined) return undefined;
    if (typeof value === "string" && value.length > 0) return value;
    diagnostics.push(diagnostic("PWA-002", `manifest.${key} must be a non-empty string when supplied`, `manifest.${key}`));
    return undefined;
  };
  const startUrl = manifest.startUrl ?? "/";
  if (!sameOriginPath(startUrl)) diagnostics.push(diagnostic("PWA-002", "manifest.startUrl must be a same-origin absolute path without a fragment", "manifest.startUrl"));
  if (manifest.scope !== undefined && !sameOriginPath(manifest.scope)) {
    diagnostics.push(diagnostic("PWA-002", "manifest.scope must be a same-origin absolute path without a fragment", "manifest.scope"));
  }
  const icons = manifest.icons ?? [];
  const validIcons = Array.isArray(icons)
    ? icons.filter((icon) => icon && sameOriginPath(icon.src) && typeof icon.sizes === "string" && icon.sizes.length > 0 && typeof icon.type === "string" && icon.type.length > 0)
    : [];
  if (!Array.isArray(icons) || validIcons.length !== icons.length) {
    diagnostics.push(diagnostic("PWA-002", "manifest.icons must contain src, sizes, and type; src must be a same-origin path", "manifest.icons"));
  }
  const categories = stringArray(manifest.categories, "manifest.categories", diagnostics);
  const shortName = optionalString("shortName");
  const description = optionalString("description");
  const display = optionalString("display");
  const backgroundColor = optionalString("backgroundColor");
  const themeColor = optionalString("themeColor");
  const orientation = optionalString("orientation");
  const id = optionalString("id");
  const lang = optionalString("lang");
  const dir = optionalString("dir");
  return {
    name: typeof name === "string" ? name : "",
    short_name: shortName ?? name,
    ...(description === undefined ? {} : { description }),
    start_url: sameOriginPath(startUrl) ? startUrl : "/",
    ...(sameOriginPath(manifest.scope) ? { scope: manifest.scope } : {}),
    display: display ?? "standalone",
    ...(backgroundColor === undefined ? {} : { background_color: backgroundColor }),
    ...(themeColor === undefined ? {} : { theme_color: themeColor }),
    ...(orientation === undefined ? {} : { orientation }),
    ...(id === undefined ? {} : { id }),
    ...(lang === undefined ? {} : { lang }),
    ...(dir === undefined ? {} : { dir }),
    ...(categories?.length ? { categories } : {}),
    icons: validIcons.map((icon) => ({
      src: icon.src,
      sizes: icon.sizes,
      type: icon.type,
      ...(typeof icon.purpose === "string" ? { purpose: icon.purpose } : {}),
    })),
  };
}

function digestInventory(entries, manifestBody, urls, options) {
  const hash = createHash("sha256");
  hash.update(manifestBody);
  hash.update("\0");
  for (const url of urls) {
    hash.update(url);
    hash.update("\0");
  }
  for (const [path, body] of entries) {
    hash.update(path);
    hash.update("\0");
    hash.update(body);
    hash.update("\0");
  }
  hash.update(JSON.stringify(options));
  return hash.digest("hex");
}

function serviceWorkerSource({ cacheName, cachePrefix, precacheUrls, offlineFallback, runtimeCaching, skipWaiting, claimClients, offlineResponse }) {
  return `/* generated by project-progressive-web-app-artifacts-service */
const CACHE_NAME=${JSON.stringify(cacheName)};
const CACHE_PREFIX=${JSON.stringify(cachePrefix)};
const PRECACHE=${JSON.stringify(precacheUrls)};
const OFFLINE_FALLBACK=${JSON.stringify(offlineFallback)};
const RUNTIME_CACHING=${JSON.stringify(runtimeCaching)};
self.addEventListener("install",event=>event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(PRECACHE))${skipWaiting ? ".then(()=>self.skipWaiting())" : ""}));
self.addEventListener("activate",event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith(CACHE_PREFIX)&&key!==CACHE_NAME).map(key=>caches.delete(key))))${claimClients ? ".then(()=>self.clients.claim())" : ""}));
self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET")return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE_NAME);
    const cached=await cache.match(event.request);
    if(cached)return cached;
    try{
      const response=await fetch(event.request);
      if(RUNTIME_CACHING&&response.ok&&new URL(event.request.url).origin===self.location.origin){const copy=response.clone();event.waitUntil(cache.put(event.request,copy))}
      return response;
    }catch{
      if(event.request.mode==="navigate"&&OFFLINE_FALLBACK){const fallback=await cache.match(OFFLINE_FALLBACK);if(fallback)return fallback}
      return new Response(${JSON.stringify(offlineResponse.body)},{status:${offlineResponse.status},headers:{"content-type":${JSON.stringify(offlineResponse.mediaType)}}});
    }
  })());
});
`;
}

/** Project a manifest and service worker from an existing release inventory. */
export function projectProgressiveWebAppArtifacts({ artifacts, config = {} } = {}) {
  const diagnostics = [];
  const entries = inventoryEntries(artifacts, diagnostics);
  const manifestPath = config.manifestPath ?? DEFAULT_MANIFEST_PATH;
  const serviceWorkerPath = config.serviceWorkerPath ?? DEFAULT_WORKER_PATH;
  for (const [subject, path] of [["manifestPath", manifestPath], ["serviceWorkerPath", serviceWorkerPath]]) {
    if (!safeArtifactPath(path)) diagnostics.push(diagnostic("PWA-002", `${subject} must be a safe relative artifact path`, subject));
  }
  if (manifestPath === serviceWorkerPath) diagnostics.push(diagnostic("PWA-002", "manifestPath and serviceWorkerPath must differ", manifestPath));

  const manifest = manifestObject(config, diagnostics);
  const manifestBody = `${JSON.stringify(manifest, null, 2)}\n`;
  const includePaths = stringArray(config.precache?.includePaths, "precache.includePaths", diagnostics);
  const excludePaths = new Set(stringArray(config.precache?.excludePaths, "precache.excludePaths", diagnostics) ?? []);
  const selectedPaths = includePaths ?? [...entries.keys()];
  const selected = [];
  for (const path of selectedPaths) {
    if (!entries.has(path)) {
      diagnostics.push(diagnostic("PWA-002", "precache include path is absent from the artifact inventory", path));
    } else if (!excludePaths.has(path) && path !== serviceWorkerPath && path !== manifestPath) {
      selected.push(path);
    }
  }

  const additionalUrls = stringArray(config.precache?.additionalUrls, "precache.additionalUrls", diagnostics) ?? [];
  const safeAdditional = additionalUrls.filter((url) => {
    if (sameOriginPath(url)) return true;
    diagnostics.push(diagnostic("PWA-002", "additional precache URLs must be same-origin absolute paths without fragments", url));
    return false;
  });
  const manifestUrl = urlForArtifact(manifestPath);
  const offlineFallback = config.offlineFallback === null ? null : (config.offlineFallback ?? manifest.start_url);
  if (offlineFallback !== null && !sameOriginPath(offlineFallback)) {
    diagnostics.push(diagnostic("PWA-002", "offlineFallback must be null or a same-origin absolute path without a fragment", "offlineFallback"));
  }
  const precacheUrls = [...new Set([
    ...selected.map(urlForArtifact), manifestUrl, ...safeAdditional,
    ...(offlineFallback && sameOriginPath(offlineFallback) ? [offlineFallback] : []),
  ])].sort();

  const defaultPrefix = String(manifest.short_name || manifest.name || "pwa")
    .toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "pwa";
  const cachePrefix = config.cacheNamePrefix ?? defaultPrefix;
  if (typeof cachePrefix !== "string" || !/^[A-Za-z0-9._-]+$/.test(cachePrefix)) {
    diagnostics.push(diagnostic("PWA-002", "cacheNamePrefix must contain only letters, numbers, dot, underscore, or hyphen", "cacheNamePrefix"));
  }
  if (config.cacheName !== undefined && (typeof config.cacheName !== "string" || config.cacheName.length === 0)) {
    diagnostics.push(diagnostic("PWA-002", "cacheName must be a non-empty string when supplied", "cacheName"));
  }

  const workerOptions = {
    offlineFallback: offlineFallback && sameOriginPath(offlineFallback) ? offlineFallback : null,
    runtimeCaching: config.runtimeCaching !== false,
    skipWaiting: config.skipWaiting !== false,
    claimClients: config.claimClients !== false,
  };
  const digest = digestInventory(new Map(selected.map((path) => [path, entries.get(path)])), manifestBody, precacheUrls, workerOptions);
  const effectivePrefix = typeof cachePrefix === "string" && /^[A-Za-z0-9._-]+$/.test(cachePrefix) ? cachePrefix : "pwa";
  const cacheName = typeof config.cacheName === "string" && config.cacheName.length > 0
    ? config.cacheName
    : `${effectivePrefix}-${digest.slice(0, 16)}`;
  const suppliedOfflineResponse = {
    body: config.offlineResponse?.body ?? "Offline",
    status: config.offlineResponse?.status ?? 503,
    mediaType: config.offlineResponse?.mediaType ?? "text/plain; charset=utf-8",
  };
  const validOfflineResponse = typeof suppliedOfflineResponse.body === "string"
    && Number.isInteger(suppliedOfflineResponse.status)
    && suppliedOfflineResponse.status >= 400
    && suppliedOfflineResponse.status <= 599
    && typeof suppliedOfflineResponse.mediaType === "string";
  if (!validOfflineResponse) {
    diagnostics.push(diagnostic("PWA-002", "offlineResponse needs a string body/mediaType and an integer 4xx or 5xx status", "offlineResponse"));
  }
  const offlineResponse = validOfflineResponse
    ? suppliedOfflineResponse
    : { body: "Offline", status: 503, mediaType: "text/plain; charset=utf-8" };

  const projected = [];
  if (entries.has(manifestPath)) diagnostics.push(diagnostic("PWA-003", "generated manifest path collides with an existing artifact", manifestPath));
  else if (safeArtifactPath(manifestPath)) projected.push({ path: manifestPath, body: manifestBody, mediaType: "application/manifest+json; charset=utf-8", source: "pwa:manifest" });
  if (entries.has(serviceWorkerPath)) diagnostics.push(diagnostic("PWA-003", "generated service worker path collides with an existing artifact", serviceWorkerPath));
  else if (safeArtifactPath(serviceWorkerPath) && manifestPath !== serviceWorkerPath) projected.push({
    path: serviceWorkerPath,
    body: serviceWorkerSource({ cacheName, cachePrefix: `${effectivePrefix}-`, precacheUrls, ...workerOptions, offlineResponse }),
    mediaType: "text/javascript; charset=utf-8",
    cacheControl: "no-cache",
    source: `pwa:service-worker:${digest}`,
  });
  return Object.freeze({ artifacts: Object.freeze(projected), diagnostics: Object.freeze(diagnostics) });
}

/** Form a build-projector-contract-compatible projector for a configured PWA. */
export function createProgressiveWebAppProjector(config = {}, { name = "progressive-web-app", priority = 90 } = {}) {
  return Object.freeze({
    name,
    priority,
    project(context = {}) {
      return projectProgressiveWebAppArtifacts({ artifacts: context.artifacts, config });
    },
  });
}
