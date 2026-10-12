import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { parse } from "parse5";

function within(root, name) {
  const result = resolve(root, name);
  if (result === root || !result.startsWith(root + sep)) throw new Error(`asset path escapes its carrier: ${name}`);
  return result;
}

// HTML is the entry carrier. Source modules are inputs, never a second public
// tree or an independently maintained vendor inventory.
export async function buildCloudflareStaticAssetTree({ rootDirectory, outputDirectory = "dist", assets = [], ...obsolete }) {
  if (Object.keys(obsolete).length) throw new Error(`obsolete source-tree publication options: ${Object.keys(obsolete).join(", ")}`);
  const root = resolve(rootDirectory);
  const target = within(root, outputDirectory);
  if (target === join(root, "web") || target.startsWith(join(root, "web") + sep)) throw new Error("output would replace authored web files");
  await mkdir(dirname(target), { recursive: true });
  const output = await mkdtemp(target + "-stage-");
  try {
  const notices = new Map();
  const packageCache = new Map();
  async function licenseFor(input) {
    let directory = dirname(resolve(root, input));
    while (directory !== dirname(directory)) {
      if (packageCache.has(directory)) return packageCache.get(directory);
      try {
        const pkg = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
        let notice;
        for (const name of ["LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING"]) {
          try { notice = { name: pkg.name, text: await readFile(join(directory, name), "utf8") }; break; } catch (err) { if (err.code !== "ENOENT") throw err; }
        }
        packageCache.set(directory, notice);
        return notice;
      } catch (err) { if (err.code !== "ENOENT") throw err; }
      directory = dirname(directory);
    }
  }
  async function bundle(sourcePath, contents, destination) {
    const result = await build({
      absWorkingDir: root,
      ...(contents === undefined ? { entryPoints: [sourcePath] } : { stdin: { contents, resolveDir: dirname(sourcePath), sourcefile: relative(root, sourcePath), loader: "js" } }),
      bundle: true, platform: "browser", format: "esm", target: "es2022", write: false,
      outfile: destination, metafile: true, legalComments: "eof", logLevel: "silent",
      inject: [fileURLToPath(new URL("./browser-buffer.mjs", import.meta.url))],
      // Browser modules are never native command-line entry points.
      define: { "import.meta.main": "false" },
      plugins: [{ name: "web-urls", setup(builder) {
        builder.onResolve({ filter: /^https?:\/\// }, ({ path }) => ({ path, external: true }));
        builder.onResolve({ filter: /^\// }, ({ path, kind }) => kind === "entry-point" ? undefined : { path: within(root, path.slice(1)) });
      } }],
    });
    for (const file of result.outputFiles) {
      await mkdir(dirname(file.path), { recursive: true });
      await writeFile(file.path, file.contents);
    }
    for (const input of Object.keys(result.metafile.inputs)) {
      if (input === "<stdin>") continue;
      const notice = await licenseFor(input);
      if (notice) notices.set(notice.name, notice.text);
    }
  }
  async function html(sourcePath, destination) {
    const source = await readFile(sourcePath, "utf8");
    const document = parse(source, { sourceCodeLocationInfo: true });
    const scripts = [];
    function visit(node) {
      if (node.tagName === "script") scripts.push(node);
      for (const child of node.childNodes ?? []) visit(child);
      if (node.content) visit(node.content);
    }
    visit(document);
    const replacements = [];
    for (const [index, script] of scripts.entries()) {
      const attr = Object.fromEntries(script.attrs.map(({ name, value }) => [name, value]));
      const location = script.sourceCodeLocation;
      if (attr.type === "importmap") {
        // Package resolution follows maintained package exports, rather than
        // a separately copied and renamed runtime module graph.
        replacements.push({ ...location, text: "" });
      } else if (attr.type === "module") {
        if (attr.src && /^(?:https?:)?\/\//.test(attr.src)) continue;
        const entry = attr.src
          ? within(root, new URL(attr.src, `https://publication.invalid/${relative(root, sourcePath).split(sep).join("/")}`).pathname.slice(1))
          : sourcePath;
        const out = attr.src ? within(output, relative(root, entry)) : destination.replace(/\.html$/, `.module-${index}.mjs`);
        const contents = attr.src ? undefined : source.slice(location.startTag.endOffset, location.endTag.startOffset);
        await bundle(entry, contents, out);
        const url = "/" + relative(output, out).split(sep).join("/");
        replacements.push({ ...location, text: `<script type="module" src="${url}"></script>` });
      }
    }
    let published = source;
    for (const change of replacements.sort((a, b) => b.startOffset - a.startOffset)) {
      published = published.slice(0, change.startOffset) + change.text + published.slice(change.endOffset);
    }
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, published);
  }
  async function web(sourceDirectory, destinationDirectory) {
    for (const entry of await readdir(sourceDirectory, { withFileTypes: true })) {
      if (["test", "tests", "node_modules"].includes(entry.name) || /\.test\./.test(entry.name)) continue;
      const source = join(sourceDirectory, entry.name), destination = join(destinationDirectory, entry.name);
      if (entry.isDirectory()) await web(source, destination);
      else if (entry.name.endsWith(".html")) await html(source, destination);
      else if (!/\.(?:m?js|[mc]?ts)$/.test(entry.name)) { await mkdir(dirname(destination), { recursive: true }); await cp(source, destination); }
    }
  }
  await web(join(root, "web"), join(output, "web"));
  for (const asset of assets) {
    const source = within(root, asset), destination = within(output, asset);
    await mkdir(dirname(destination), { recursive: true });
    await cp(source, destination);
  }
  if (notices.size) await writeFile(join(output, "THIRD_PARTY_NOTICES.txt"), [...notices].sort(([a], [b]) => a.localeCompare(b)).map(([name, text]) => `${name}\n${text}`).join("\n\n"));
  for (let attempt = 0; ; attempt++) {
    await rm(target, { recursive: true, force: true });
    try { await rename(output, target); break; }
    catch (error) {
      // Independent local launchers can finish the same publication together.
      if (error.code !== "ENOTEMPTY" || attempt >= 3) throw error;
    }
  }
  return target;
  } finally { await rm(output, { recursive: true, force: true }); }
}
