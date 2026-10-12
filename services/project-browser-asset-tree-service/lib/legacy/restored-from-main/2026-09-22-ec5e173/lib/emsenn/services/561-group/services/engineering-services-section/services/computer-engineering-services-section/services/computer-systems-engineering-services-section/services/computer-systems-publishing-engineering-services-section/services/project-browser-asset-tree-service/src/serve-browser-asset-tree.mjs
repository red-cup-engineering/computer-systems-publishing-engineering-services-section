import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { stripTypeScriptTypes } from "node:module";
import sirv from "sirv";

const STATIC_OPTIONS = { dev: true, etag: true, extensions: [] };

function resolveModule(rootDirectory, pathname) {
  const filePath = path.resolve(rootDirectory, `.${decodeURIComponent(pathname)}`);
  return filePath.startsWith(`${rootDirectory}${path.sep}`) ? filePath : null;
}

function send(res, status, body, type = "text/plain") {
  res.writeHead(status, { "Content-Type": `${type}; charset=utf-8` });
  res.end(body);
}

function serveFrom(middleware, pathname, req, res) {
  const originalUrl = req.url;
  req.url = pathname;
  middleware(req, res, () => send(res, 404, "not found"));
  req.url = originalUrl;
}

/**
 * A `node:http` dev server for one package's browser tree: serves `rootDirectory` as static
 * assets via `sirv`, strips TypeScript syntax from any `.mts` request so the browser can load
 * engine source directly (unmodified, un-duplicated), and optionally proxies declared vendor URL
 * prefixes to their own on-disk trees (for vendored packages a browser's native ESM loader
 * cannot resolve bare specifiers for on its own) and serves a JSON `manifest` value at
 * `/api/manifest`.
 *
 * The front door (`/`) is always a real HTTP redirect to `/web/index.html`, never a same-URL
 * internal rewrite — a rewrite leaves the browser's address bar at `/`, so any path-relative
 * reference inside `web/index.html` (e.g. `css/style.css`) resolves against `/` instead and
 * silently 404s.
 */
export function createBrowserAssetDevServer({ rootDirectory, vendorRoots = {}, manifest }) {
  const serveStatic = sirv(rootDirectory, STATIC_OPTIONS);
  const vendorServers = Object.fromEntries(
    Object.entries(vendorRoots).map(([prefix, base]) => [prefix, sirv(base, STATIC_OPTIONS)]),
  );

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname === "/") {
        res.writeHead(302, { Location: "/web/index.html" });
        res.end();
        return;
      }
      if (manifest !== undefined && url.pathname === "/api/manifest") {
        send(res, 200, JSON.stringify(manifest, null, 2), "application/json");
        return;
      }
      if (url.pathname.endsWith(".mts")) {
        const filePath = resolveModule(rootDirectory, url.pathname);
        if (!filePath) {
          send(res, 403, "forbidden");
          return;
        }
        const raw = await readFile(filePath, "utf8");
        send(res, 200, stripTypeScriptTypes(raw, { mode: "strip" }), "text/javascript");
        return;
      }
      const vendorPrefix = Object.keys(vendorServers).find((prefix) => url.pathname.startsWith(prefix));
      if (vendorPrefix !== undefined) {
        serveFrom(vendorServers[vendorPrefix], url.pathname.slice(vendorPrefix.length - 1), req, res);
        return;
      }
      serveFrom(serveStatic, url.pathname, req, res);
    } catch (err) {
      if (err && err.code === "ENOENT") {
        send(res, 404, "not found");
        return;
      }
      send(res, 500, `server error: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}

/** Reads the dev server's port from a CLI arg (`argv[2]`) or the `PORT` env var, falling back to `defaultPort`. */
export function configuredDevServerPort({ argv = process.argv, env = process.env, defaultPort }) {
  return Number(argv[2] ?? env["PORT"] ?? defaultPort);
}
