import { readFile, readdir } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';

const MEDIA_TYPES = Object.freeze({
  '.avif': 'image/avif',
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8',
});

export function mediaTypeFor(path) {
  if (path === 'feed.atom.xml') return 'application/atom+xml; charset=utf-8';
  return MEDIA_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

export async function collectPublicAssets(publicDir) {
  const assets = new Map();
  const refusals = [];
  if (!publicDir) return { assets, refusals };

  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = join(directory, entry.name);
      const name = relative(publicDir, full).split(sep).join('/');
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) assets.set(name, await readFile(full));
      else refusals.push({
        code: 'R-15',
        subject: name,
        reason: 'public assets must be ordinary files or directories; symbolic links and special files are not followed',
      });
    }
  }

  try {
    await walk(publicDir);
  } catch (error) {
    refusals.push({
      code: 'R-15',
      subject: 'publicDir',
      reason: `cannot read configured public asset directory: ${error.message}`,
    });
  }
  return { assets, refusals };
}
