/**
 * News property distribution: push a completed build to the channels that
 * carry attention (search, the fediverse's social layer, WebSub) per the
 * news-property specification §4.3. Every function takes an injectable
 * `fetch` so the effect is testable; no function throws on a missing
 * credential or missing configuration — it returns a typed refusal instead,
 * because a pulse with five configured channels and one unconfigured one
 * must still ship the other four.
 */

/**
 * @typedef {object} ManifestRoute
 * @property {string} url
 * @property {string|null} hash
 * @property {string|null} title
 */

/**
 * @typedef {object} RouteChange
 * @property {string} url
 * @property {'new'|'changed'} status
 */

/**
 * @typedef {object} ChannelReceipt
 * @property {string} channel
 * @property {boolean} attempted
 * @property {'ok'|'refused'|'error'} status
 * @property {string[]} urls
 * @property {string} [reason]
 * @property {number} [httpStatus]
 */

const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
const BLUESKY_SERVICE = "https://bsky.social";

/**
 * Read the public routes out of a build manifest. A build manifest's exact
 * shape is the build lot's to fix; this tolerates the shapes a `manifest.json`
 * plausibly takes (`routes`, `pages`, `artifacts`, or the manifest itself
 * being the array) so distribution does not hard-couple to one.
 * @param {object|Array|null|undefined} manifest
 * @returns {ManifestRoute[]}
 */
function manifestRoutes(manifest) {
  if (manifest === null || manifest === undefined) return [];
  if (typeof manifest !== "object") {
    throw new TypeError("news-property distribute manifest must be an object or array");
  }
  const source = Array.isArray(manifest) ? manifest
    : Array.isArray(manifest.routes) ? manifest.routes
    : Array.isArray(manifest.pages) ? manifest.pages
    : Array.isArray(manifest.artifacts) ? manifest.artifacts
    : [];
  return source
    .filter((entry) => entry && typeof entry === "object" && typeof entry.url === "string" && entry.url.trim() !== "")
    .map((entry) => ({
      url: entry.url,
      hash: typeof entry.hash === "string" ? entry.hash
        : typeof entry.contentHash === "string" ? entry.contentHash
        : null,
      title: typeof entry.title === "string" && entry.title.trim() !== "" ? entry.title.trim() : null,
    }));
}

/**
 * Diff two build manifests for public routes that are new or changed.
 * A route missing from the current manifest (removed) is not reported —
 * distribution announces additions and edits, never deletions.
 * @param {object|Array|null|undefined} manifest current build manifest
 * @param {object|Array|null|undefined} previousManifest prior build manifest, or null for a first build
 * @returns {RouteChange[]}
 */
export function diffManifestRoutes(manifest, previousManifest) {
  const current = manifestRoutes(manifest);
  const previous = new Map(manifestRoutes(previousManifest).map((route) => [route.url, route.hash]));
  const changes = [];
  for (const route of current) {
    if (!previous.has(route.url)) {
      changes.push({ url: route.url, status: "new" });
    } else if (previous.get(route.url) !== route.hash) {
      changes.push({ url: route.url, status: "changed" });
    }
  }
  return changes;
}

/**
 * Submit changed URLs to IndexNow (api.indexnow.org) so participating search
 * engines recrawl them without waiting for a sitemap crawl.
 * @param {object} input
 * @param {string} [input.key] IndexNow verification key (property.distribution.indexNow.key)
 * @param {string} [input.keyLocation] URL of the hosted key file, when it is not at `/​<key>.txt`
 * @param {string} [input.host] the property's domain, e.g. "koios.news"
 * @param {string[]} [input.urls] changed page URLs
 * @param {typeof fetch} [input.fetch] injectable fetch
 * @returns {Promise<ChannelReceipt>}
 * @throws {TypeError} when `urls`/`host`/`key` are present but `fetch` is not a function
 */
export async function submitIndexNow({ key, keyLocation, host, urls, fetch: doFetch } = {}) {
  const list = Array.isArray(urls) ? urls.filter((url) => typeof url === "string" && url.trim() !== "") : [];
  if (typeof key !== "string" || key.trim() === "") {
    return { channel: "indexnow", attempted: false, status: "refused", reason: "missing-credential: IndexNow key is not configured (property.distribution.indexNow.key)", urls: list };
  }
  if (typeof host !== "string" || host.trim() === "") {
    return { channel: "indexnow", attempted: false, status: "refused", reason: "missing-config: IndexNow host is not configured (property.origin)", urls: list };
  }
  if (list.length === 0) {
    return { channel: "indexnow", attempted: false, status: "refused", reason: "no-changed-urls: nothing new or changed to submit", urls: list };
  }
  if (typeof doFetch !== "function") throw new TypeError("submitIndexNow requires an injectable fetch");
  const body = {
    host,
    key,
    urlList: list,
    ...(typeof keyLocation === "string" && keyLocation.trim() !== "" ? { keyLocation } : {}),
  };
  try {
    const response = await doFetch(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    });
    return {
      channel: "indexnow",
      attempted: true,
      status: response.ok ? "ok" : "error",
      urls: list,
      httpStatus: response.status,
      ...(response.ok ? {} : { reason: `indexnow-http-${response.status}` }),
    };
  } catch (error) {
    return { channel: "indexnow", attempted: true, status: "error", urls: list, reason: `indexnow-network-error: ${error.message}` };
  }
}

/**
 * Notify a WebSub hub that a topic (feed) changed, per the WebSub publisher
 * notification: a form POST to the hub with `hub.mode=publish` and one
 * `hub.url` per topic.
 * @param {object} input
 * @param {string} [input.hub] the hub URL (property.distribution.websubHub)
 * @param {string[]} [input.topics] feed URLs that changed
 * @param {typeof fetch} [input.fetch] injectable fetch
 * @returns {Promise<ChannelReceipt>}
 * @throws {TypeError} when `hub`/`topics` are present but `fetch` is not a function
 */
export async function publishWebSub({ hub, topics, fetch: doFetch } = {}) {
  const list = Array.isArray(topics) ? topics.filter((url) => typeof url === "string" && url.trim() !== "") : [];
  if (typeof hub !== "string" || hub.trim() === "") {
    return { channel: "websub", attempted: false, status: "refused", reason: "missing-config: WebSub hub is not configured (property.distribution.websubHub)", urls: list };
  }
  if (list.length === 0) {
    return { channel: "websub", attempted: false, status: "refused", reason: "no-topics: no feed URLs are configured to publish", urls: list };
  }
  if (typeof doFetch !== "function") throw new TypeError("publishWebSub requires an injectable fetch");
  const form = new URLSearchParams();
  form.append("hub.mode", "publish");
  for (const topic of list) form.append("hub.url", topic);
  try {
    const response = await doFetch(hub, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    return {
      channel: "websub",
      attempted: true,
      status: response.ok ? "ok" : "error",
      urls: list,
      httpStatus: response.status,
      ...(response.ok ? {} : { reason: `websub-http-${response.status}` }),
    };
  } catch (error) {
    return { channel: "websub", attempted: true, status: "error", urls: list, reason: `websub-network-error: ${error.message}` };
  }
}

/**
 * Compute the UTF-8 byte-offset link facet Bluesky's richtext format
 * requires, when `url` appears verbatim inside `text`.
 * @param {string} text
 * @param {string|undefined} url
 * @returns {Array<{index: {byteStart: number, byteEnd: number}, features: Array<{$type: string, uri: string}>}>}
 */
function blueskyLinkFacets(text, url) {
  if (typeof url !== "string" || url.trim() === "") return [];
  const index = text.indexOf(url);
  if (index === -1) return [];
  const encoder = new TextEncoder();
  const byteStart = encoder.encode(text.slice(0, index)).length;
  const byteEnd = byteStart + encoder.encode(url).length;
  return [{ index: { byteStart, byteEnd }, features: [{ $type: "app.bsky.richtext.facet#link", uri: url }] }];
}

/**
 * Post story announcements to Bluesky: `com.atproto.server.createSession`
 * to exchange the app password for a session, then
 * one `com.atproto.repo.createRecord` per article with a link facet.
 * @param {object} input
 * @param {string} [input.handle] Bluesky handle (property.distribution.blueskyHandle)
 * @param {string} [input.appPassword] Bluesky app password (env `BLUESKY_APP_PASSWORD`, never stored in the property record)
 * @param {string} [input.text] post text
 * @param {string} [input.url] the story URL to link
 * @param {Array<{text:string,url:string,image?:{bytes:Uint8Array,mimeType:string,alt:string,sanitized:true,aspectRatio?:{width:number,height:number}}}>} [input.stories] announcements for one build
 * @param {typeof fetch} [input.fetch] injectable fetch
 * @param {() => string} [input.now] override for the record's `createdAt` (tests only)
 * @returns {Promise<ChannelReceipt & {uri?: string|null}>}
 * @throws {TypeError} when credentials and text are present but `fetch` is not a function
 */
export async function postBluesky({ handle, appPassword, text, url, stories, fetch: doFetch, now } = {}) {
  const announcements = Array.isArray(stories) ? stories : [{ text, url }];
  const urls = announcements.map((story) => story?.url).filter((value) => typeof value === "string" && value.trim() !== "");
  if (typeof handle !== "string" || handle.trim() === "") {
    return { channel: "bluesky", attempted: false, status: "refused", reason: "missing-config: Bluesky handle is not configured (property.distribution.blueskyHandle)", urls };
  }
  if (typeof appPassword !== "string" || appPassword.trim() === "") {
    return { channel: "bluesky", attempted: false, status: "refused", reason: "missing-credential: BLUESKY_APP_PASSWORD is not set in the environment", urls };
  }
  if (announcements.length === 0 || announcements.some((story) => typeof story?.text !== "string" || story.text.trim() === "")) {
    return { channel: "bluesky", attempted: false, status: "refused", reason: "missing-content: no post text was composed for this pulse", urls };
  }
  if (typeof doFetch !== "function") throw new TypeError("postBluesky requires an injectable fetch");

  let session;
  try {
    const sessionResponse = await doFetch(`${BLUESKY_SERVICE}/xrpc/com.atproto.server.createSession`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identifier: handle, password: appPassword }),
    });
    if (!sessionResponse.ok) {
      return { channel: "bluesky", attempted: true, status: "error", urls, reason: `bluesky-session-http-${sessionResponse.status}` };
    }
    session = await sessionResponse.json();
  } catch (error) {
    return { channel: "bluesky", attempted: true, status: "error", urls, reason: `bluesky-session-network-error: ${error.message}` };
  }
  if (typeof session?.accessJwt !== "string" || typeof session?.did !== "string") {
    return { channel: "bluesky", attempted: true, status: "error", urls, reason: "bluesky-session-missing-tokens" };
  }

  const posts = [];
  for (const story of announcements) {
    const facets = blueskyLinkFacets(story.text, story.url);
    let embed;
    if (story.image !== undefined) {
      const image = story.image;
      const bytes = image?.bytes;
      const byteLength = bytes?.byteLength;
      if (!(bytes instanceof Uint8Array) || !Number.isSafeInteger(byteLength) || byteLength < 1) {
        posts.push({ url: story.url, status: "error", reason: "bluesky-image-bytes-required" });
        continue;
      }
      if (byteLength > 2 * 1024 * 1024) {
        posts.push({ url: story.url, status: "error", reason: "bluesky-image-over-2mb" });
        continue;
      }
      if (!["image/png", "image/jpeg", "image/webp"].includes(image.mimeType)) {
        posts.push({ url: story.url, status: "error", reason: "bluesky-image-mime-unsupported" });
        continue;
      }
      if (typeof image.alt !== "string" || !image.alt.trim()) {
        posts.push({ url: story.url, status: "error", reason: "bluesky-image-alt-required" });
        continue;
      }
      if (image.sanitized !== true) {
        posts.push({ url: story.url, status: "error", reason: "bluesky-image-metadata-not-sanitized" });
        continue;
      }
      let aspectRatio;
      if (image.aspectRatio !== undefined) {
        const { width, height } = image.aspectRatio;
        if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1) {
          posts.push({ url: story.url, status: "error", reason: "bluesky-image-aspect-ratio-invalid" });
          continue;
        }
        aspectRatio = { width, height };
      }
      let uploaded;
      try {
        const blobResponse = await doFetch(`${BLUESKY_SERVICE}/xrpc/com.atproto.repo.uploadBlob`, {
          method: "POST",
          headers: { "content-type": image.mimeType, authorization: `Bearer ${session.accessJwt}` },
          body: bytes,
        });
        if (!blobResponse.ok) {
          posts.push({ url: story.url, status: "error", reason: `bluesky-blob-http-${blobResponse.status}` });
          continue;
        }
        const body = await blobResponse.json();
        uploaded = body?.blob;
        if (uploaded === undefined) {
          posts.push({ url: story.url, status: "error", reason: "bluesky-blob-missing" });
          continue;
        }
      } catch (error) {
        posts.push({ url: story.url, status: "error", reason: `bluesky-blob-network-error: ${error.message}` });
        continue;
      }
      embed = {
        $type: "app.bsky.embed.images",
        images: [{ alt: image.alt.trim(), image: uploaded, ...(aspectRatio ? { aspectRatio } : {}) }],
      };
    }
    const record = {
      $type: "app.bsky.feed.post",
      text: story.text,
      createdAt: typeof now === "function" ? now() : new Date().toISOString(),
      ...(facets.length > 0 ? { facets } : {}),
      ...(embed ? { embed } : {}),
    };
    try {
      const recordResponse = await doFetch(`${BLUESKY_SERVICE}/xrpc/com.atproto.repo.createRecord`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${session.accessJwt}` },
        body: JSON.stringify({ repo: session.did, collection: "app.bsky.feed.post", record }),
      });
      if (!recordResponse.ok) {
        posts.push({ url: story.url, status: "error", reason: `bluesky-record-http-${recordResponse.status}` });
        continue;
      }
      const created = await recordResponse.json();
      posts.push({ url: story.url, status: "ok", uri: typeof created?.uri === "string" ? created.uri : null });
    } catch (error) {
      posts.push({ url: story.url, status: "error", reason: `bluesky-record-network-error: ${error.message}` });
    }
  }
  const failed = posts.filter((post) => post.status === "error");
  return { channel: "bluesky", attempted: true, status: failed.length === 0 ? "ok" : "error", urls, posts,
    ...(posts.length === 1 && posts[0].status === "ok" ? { uri: posts[0].uri } : {}),
    ...(failed.length > 0 ? { reason: `${failed.length} of ${posts.length} Bluesky article announcements failed` } : {}) };
}

/**
 * Derive the bare domain IndexNow expects from a property's https origin.
 * @param {string|undefined} origin
 * @returns {string|undefined}
 */
function hostFromOrigin(origin) {
  if (typeof origin !== "string" || origin.trim() === "") return undefined;
  try {
    return new URL(origin).host;
  } catch {
    return undefined;
  }
}

/**
 * Compose one headline and canonical link for a Bluesky article announcement.
 * @param {object} property
 * @param {ManifestRoute} article
 * @returns {string}
 */
function composeBlueskyText(property, article) {
  const name = typeof property?.name === "string" && property.name.trim() !== "" ? property.name : "the newsroom";
  const headline = article.title ?? `New from ${name}`;
  const room = 300 - Array.from(article.url).length - 2;
  if (room <= 0) return article.url;
  const letters = Array.from(headline);
  const shortHeadline = letters.length <= room ? headline : `${letters.slice(0, room - 1).join("")}…`;
  return `${shortHeadline}\n\n${article.url}`;
}

/**
 * Run every configured distribution channel for one build against its
 * previous build, and return one receipt per channel. No channel throws on
 * missing configuration or credentials; each refuses with a reason instead,
 * so one unconfigured channel never blocks the others.
 * @param {object} input
 * @param {object} input.property the property record (reads `name`, `origin`, `distribution`)
 * @param {object|Array} input.manifest the just-built manifest
 * @param {object|Array|null} [input.previousManifest] the prior build's manifest, or null/absent for a first build
 * @param {Record<string, string>} [input.env] environment variables (reads `BLUESKY_APP_PASSWORD`)
 * @param {typeof fetch} [input.fetch] injectable fetch, forwarded to every channel
 * @returns {Promise<{routes: RouteChange[], receipts: ChannelReceipt[]}>}
 * @throws {TypeError} when `property` or `manifest` is not an object
 */
export async function distributeBuild({ property, manifest, previousManifest, env = {}, fetch: doFetch } = {}) {
  if (property === null || typeof property !== "object") throw new TypeError("distributeBuild requires a property record");
  if (manifest === null || typeof manifest !== "object") throw new TypeError("distributeBuild requires a build manifest");

  const changes = diffManifestRoutes(manifest, previousManifest ?? null);
  const changedUrls = changes.map((change) => change.url);
  const newRoutes = changes.filter((change) => change.status === "new");
  const distribution = property.distribution ?? {};
  const indexNow = distribution.indexNow ?? {};

  const receipts = [];
  receipts.push(await submitIndexNow({
    key: indexNow.key,
    keyLocation: indexNow.keyLocation,
    host: indexNow.host ?? hostFromOrigin(property.origin),
    urls: changedUrls,
    fetch: doFetch,
  }));

  const feeds = Array.isArray(distribution.feeds) && distribution.feeds.length > 0
    ? distribution.feeds
    : (typeof property.origin === "string" && property.origin.trim() !== "" ? [`${property.origin.replace(/\/+$/, "")}/feed.xml`] : []);
  receipts.push(await publishWebSub({ hub: distribution.websubHub, topics: feeds, fetch: doFetch }));

  const titles = new Map(manifestRoutes(manifest).map((route) => [route.url, route.title]));
  const newArticles = newRoutes.filter((route) => {
    try { return new URL(route.url).origin === property.origin && /^\/posts\/[^/]+\/$/u.test(new URL(route.url).pathname); }
    catch { return false; }
  }).map((route) => ({ ...route, title: titles.get(route.url) ?? null }));
  receipts.push(await postBluesky({
    handle: distribution.blueskyHandle,
    appPassword: env.BLUESKY_APP_PASSWORD,
    stories: newArticles.map((article) => ({ text: composeBlueskyText(property, article), url: article.url })),
    fetch: doFetch,
  }));

  return { routes: changes, receipts };
}
