import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { stripTypeScriptTypes } from "node:module";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mts": "text/javascript; charset=utf-8", // stripped before serving — see module doc
  ".json": "application/json; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function contentTypeFor(filePath) {
  return MIME[path.extname(filePath)] ?? "application/octet-stream";
}

function resolveInside(base, rel) {
  const filePath = path.normalize(path.join(base, rel));
  if (filePath !== base && !filePath.startsWith(base + path.sep)) return null; // traversal guard
  return filePath;
}

/**
 * A zero-runtime-dependency `node:http` static file server for one package's browser tree
 * (house style: no framework, just Node — the games shelf's own long-standing convention).
 * Serves `rootDirectory` as-is, strips TypeScript syntax from any `.mts` request so the browser
 * loads the real engine source directly (unmodified, un-duplicated), and proxies declared vendor
 * URL prefixes to their own on-disk trees for vendored packages a browser's native ESM loader
 * cannot resolve bare specifiers for on its own.
 *
 * `frontDoor: "redirect"` (the default) — a single-page shelf: `/` is a real HTTP redirect to
 * `/web/index.html`, never a same-URL internal rewrite (a rewrite leaves the browser's address
 * bar at `/`, so any path-relative reference inside `web/index.html` resolves against `/` and
 * silently 404s); every other path resolves directly under `rootDirectory`, mirroring the
 * filesystem exactly.
 *
 * `frontDoor: "pretty-urls"` — a multi-page/multi-game shelf: `/`, and any path ending in `/`,
 * resolve to that directory's `index.html` under `rootDirectory/web` with no redirect (so
 * `/pig/`, `/farkle/`, ... each resolve to their own `web/<game>/index.html`); fully qualified
 * `/src/...` and `/web/...` requests still resolve straight under `rootDirectory`.
 */
export function createStaticBrowserDevServer({ rootDirectory, vendorRoots = {}, frontDoor = "redirect" }) {
  const webRoot = path.join(rootDirectory, "web");

  async function resolveFile(pathname) {
    const decoded = decodeURIComponent(pathname);
    for (const [prefix, base] of Object.entries(vendorRoots)) {
      if (decoded.startsWith(prefix)) return resolveInside(base, decoded.slice(prefix.length));
    }
    if (frontDoor === "pretty-urls") {
      if (decoded.startsWith("/src/") || decoded.startsWith("/web/")) return resolveInside(rootDirectory, decoded);
      let rel = decoded;
      if (rel === "/" || rel === "") rel = "/index.html";
      else if (rel.endsWith("/")) rel = `${rel}index.html`;
      return resolveInside(webRoot, rel);
    }
    return resolveInside(rootDirectory, decoded);
  }

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (frontDoor === "redirect" && (url.pathname === "/" || url.pathname === "")) {
        res.writeHead(302, { Location: "/web/index.html" });
        res.end();
        return;
      }
      const filePath = await resolveFile(url.pathname);
      if (!filePath) {
        res.writeHead(403);
        res.end("forbidden");
        return;
      }
      const raw = await readFile(filePath);
      const ext = path.extname(filePath);
      const body = ext === ".mts" ? Buffer.from(stripTypeScriptTypes(raw.toString("utf8"), { mode: "strip" })) : raw;
      res.writeHead(200, { "Content-Type": contentTypeFor(filePath) });
      res.end(body);
    } catch (err) {
      if (err && err.code === "ENOENT") {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("not found");
        return;
      }
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(`server error: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}
