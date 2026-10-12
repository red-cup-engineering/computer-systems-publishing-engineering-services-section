import { extensionType } from "@red-cup-engineering/computer-serialized-content-engineering-services-section/services/http-data-services-section/src/media-type";
import { strongEtag } from "@red-cup-engineering/http-services-section/response";

const DEFAULT_INDEX = Object.freeze(["index.html"]);
const DEFAULT_CACHE_CONTROL = "public, max-age=0, must-revalidate";
const DEFAULT_NOT_FOUND_CACHE_CONTROL = "no-store";

function normalizedArtifactPath(path, label) {
  if (typeof path !== "string" || path.length === 0) {
    throw new TypeError(`${label} must be a non-empty relative artifact path`);
  }
  if (path.includes("\\") || path.startsWith("/")) {
    throw new TypeError(`${label} must be a slash-separated relative artifact path`);
  }
  const segments = path.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new TypeError(`${label} must not contain empty, current-directory, or parent-directory segments`);
  }
  return path;
}

function requestPath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  if (!decoded.startsWith("/") || decoded.includes("\\") || decoded.includes("\0")) return undefined;
  const segments = decoded.slice(1).split("/");
  if (segments.some((segment) => segment === "." || segment === "..")) return undefined;
  return segments.filter(Boolean).join("/");
}

function artifactBody(value) {
  if (typeof value === "string" || Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (value && typeof value === "object" && "body" in value) return artifactBody(value.body);
  throw new TypeError("artifact inventory values must be strings, Buffers, or Uint8Arrays");
}

function cachePolicy(option, path, fallback) {
  const value = typeof option === "function" ? option(path) : option;
  if (value === false) return undefined;
  if (value !== undefined && (typeof value !== "string" || value.length === 0)) {
    throw new TypeError("cache-control policy must be a non-empty string, false, or a function returning either value");
  }
  return value ?? fallback;
}

function artifactRepresentation(inventory, path, options, status) {
  const value = inventory.get(path);
  const body = artifactBody(value);
  const metadata = value && typeof value === "object" && !Buffer.isBuffer(value) && !(value instanceof Uint8Array) ? value : {};
  const cacheControl = cachePolicy(
    status === 404 ? options.notFoundCacheControl : (metadata.cacheControl ?? options.cacheControl),
    path,
    status === 404 ? DEFAULT_NOT_FOUND_CACHE_CONTROL : DEFAULT_CACHE_CONTROL,
  );
  return {
    ...(status === undefined ? {} : { status }),
    type: metadata.mediaType ?? extensionType(path),
    body,
    ...(options.etag === false ? {} : { etag: metadata.etag ?? strongEtag(body) }),
    ...(cacheControl === undefined ? {} : { cacheControl }),
  };
}

function resolveArtifact(inventory, path, index) {
  if (path && inventory.has(path)) return path;
  const prefix = path ? `${path}/` : "";
  for (const name of index) {
    const candidate = `${prefix}${name}`;
    if (inventory.has(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Form one application resource over an in-memory release inventory.
 *
 * @param {ReadonlyMap<string, string | Uint8Array>} inventory
 * @param {{
 *   index?: readonly string[],
 *   notFoundPath?: string | false,
 *   etag?: boolean,
 *   cacheControl?: string | false | ((path: string) => string | false | undefined),
 *   notFoundCacheControl?: string | false | ((path: string) => string | false | undefined),
 * }} [options]
 */
export function artifactInventory(inventory, options = {}) {
  if (!inventory || typeof inventory.has !== "function" || typeof inventory.get !== "function") {
    throw new TypeError("artifactInventory requires a Map-like inventory with has(path) and get(path)");
  }
  const index = Object.freeze((options.index ?? DEFAULT_INDEX).map((name) => normalizedArtifactPath(name, "index entry")));
  if (index.length === 0) throw new TypeError("artifactInventory needs at least one index entry");
  const notFoundPath = options.notFoundPath === false
    ? undefined
    : options.notFoundPath === undefined
      ? undefined
      : normalizedArtifactPath(options.notFoundPath, "notFoundPath");

  return {
    resources: [{
      route: "/*",
      match: /^\/.*$/,
      methods: ["GET", "HEAD"],
      handler: (ctx) => {
        // URL normalizes encoded dot segments before exposing pathname. Prefer
        // Node's raw request target when the app is running under the server,
        // so traversal-shaped requests are rejected rather than normalized
        // into a potentially valid artifact address.
        const rawTarget = typeof ctx.req?.url === "string"
          ? ctx.req.url.split(/[?#]/, 1)[0]
          : ctx.url.pathname;
        const requested = requestPath(rawTarget);
        const path = requested === undefined ? undefined : resolveArtifact(inventory, requested, index);
        if (path !== undefined) {
          return artifactRepresentation(inventory, path, options);
        }
        if (notFoundPath !== undefined && inventory.has(notFoundPath)) {
          return artifactRepresentation(inventory, notFoundPath, options, 404);
        }
        return {
          status: 404,
          type: "text/plain; charset=utf-8",
          body: "Not Found",
          cacheControl: cachePolicy(options.notFoundCacheControl, "", DEFAULT_NOT_FOUND_CACHE_CONTROL),
        };
      },
    }],
  };
}
