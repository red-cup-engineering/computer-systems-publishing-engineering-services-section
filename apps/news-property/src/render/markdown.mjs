/**
 * Deterministic rendering of the house Markdown subset to HTML. Ported from
 * the Koios.News carrier's `markdown.mts` (ATX headings, paragraphs, lists,
 * blockquotes, links, strong, emphasis, inline code, fenced code, horizontal
 * rules) and extended with image support. All text is escaped; raw HTML in
 * the source is never passed through.
 */

/**
 * Escape the five HTML-significant characters in a string.
 * @param {string} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Escape a URL for use in an href/src attribute, refusing schemes other than
 * http(s), site-relative, fragment, and mailto.
 * @param {string} url
 * @returns {string}
 */
function escapeUrl(url, baseUrl) {
  const trimmed = url.trim();
  if (!/^(https?:\/\/|\/|#|mailto:)/iu.test(trimmed)) return "#";
  return escapeHtml(baseUrl && /^(\/|#)/u.test(trimmed) ? new URL(trimmed, baseUrl).href : trimmed);
}

/**
 * @typedef {object} MarkdownRenderOptions
 * @property {(ids: string[], raw: string) => string} [citation] renders a `[@key]` citation marker
 * @property {string} [baseUrl] resolves article-relative links for every reading surface
 */

const CITATION_PATTERN = /\[(?:cite:)?@([A-Za-z0-9][A-Za-z0-9_:.#/$%&+?~=-]*(?:\s*;\s*@[A-Za-z0-9][A-Za-z0-9_:.#/$%&+?~=-]*)*)\]/gu;
const IMAGE_PATTERN = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/gu;
const LINK_PATTERN = /\[([^\]]+)\]\(([^)\s]+)\)/gu;

/**
 * Apply inline spans (images, code, citations, links, strong, emphasis) to
 * already-escaped-safe source text.
 * @param {string} text
 * @param {MarkdownRenderOptions} [options]
 * @returns {string}
 */
export function renderInline(text, options = {}) {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/gu, (_m, code) => `<code>${code}</code>`);
  if (options.citation !== undefined) {
    out = out.replace(CITATION_PATTERN, (raw, keys) => {
      const ids = keys.split(/\s*;\s*@/u).map((key) => key.trim()).filter(Boolean);
      return ids.length === 0 ? raw : options.citation(ids, raw) ?? raw;
    });
  }
  out = out.replace(IMAGE_PATTERN, (_m, alt, src, title) => {
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
    return `<img src="${escapeUrl(src.replaceAll("&amp;", "&"), options.baseUrl)}" alt="${alt}"${titleAttr} loading="lazy">`;
  });
  out = out.replace(LINK_PATTERN, (_m, label, url) => `<a href="${escapeUrl(url.replaceAll("&amp;", "&"), options.baseUrl)}">${label}</a>`);
  out = out.replace(/\*\*([^*]+)\*\*/gu, "<strong>$1</strong>");
  out = out.replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s).,;:!?]|$)/gu, "$1<em>$2</em>");
  return out;
}

/**
 * @typedef {{kind:"heading",level:number,text:string}
 *   |{kind:"paragraph",lines:string[]}
 *   |{kind:"ul",items:string[]}
 *   |{kind:"ol",items:string[]}
 *   |{kind:"blockquote",lines:string[]}
 *   |{kind:"code",lines:string[]}
 *   |{kind:"hr"}} Block
 */

/**
 * @param {string} markdown
 * @returns {Block[]}
 */
function parseBlocks(markdown) {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const blocks = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (line.trim() === "") { index += 1; continue; }
    const heading = line.match(/^(#{1,6})\s+(.*)$/u);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2].trim() });
      index += 1;
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/u.test(line)) {
      blocks.push({ kind: "hr" });
      index += 1;
      continue;
    }
    if (line.startsWith("```")) {
      const code = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? "").startsWith("```")) {
        code.push(lines[index] ?? "");
        index += 1;
      }
      index += 1;
      blocks.push({ kind: "code", lines: code });
      continue;
    }
    if (/^\s*[-*]\s+/u.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*[-*]\s+/u.test(lines[index] ?? "")) {
        items.push((lines[index] ?? "").replace(/^\s*[-*]\s+/u, ""));
        index += 1;
      }
      blocks.push({ kind: "ul", items });
      continue;
    }
    if (/^\s*\d+[.)]\s+/u.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*\d+[.)]\s+/u.test(lines[index] ?? "")) {
        items.push((lines[index] ?? "").replace(/^\s*\d+[.)]\s+/u, ""));
        index += 1;
      }
      blocks.push({ kind: "ol", items });
      continue;
    }
    if (line.startsWith(">")) {
      const quote = [];
      while (index < lines.length && (lines[index] ?? "").startsWith(">")) {
        quote.push((lines[index] ?? "").replace(/^>\s?/u, ""));
        index += 1;
      }
      blocks.push({ kind: "blockquote", lines: quote });
      continue;
    }
    const paragraph = [];
    while (index < lines.length) {
      const current = lines[index] ?? "";
      if (current.trim() === "" || /^(#{1,6})\s/u.test(current) || /^\s*[-*]\s+/u.test(current) ||
        /^\s*\d+[.)]\s+/u.test(current) || current.startsWith(">") || current.startsWith("```")) break;
      paragraph.push(current);
      index += 1;
    }
    blocks.push({ kind: "paragraph", lines: paragraph });
  }
  return blocks;
}

/**
 * @param {Block} block
 * @param {MarkdownRenderOptions} options
 * @returns {string}
 */
function renderBlock(block, options) {
  switch (block.kind) {
    case "heading":
      return `<h${block.level}>${renderInline(block.text, options)}</h${block.level}>`;
    case "paragraph":
      return `<p>${renderInline(block.lines.join(" "), options)}</p>`;
    case "ul":
      return `<ul>${block.items.map((item) => `<li>${renderInline(item, options)}</li>`).join("")}</ul>`;
    case "ol":
      return `<ol>${block.items.map((item) => `<li>${renderInline(item, options)}</li>`).join("")}</ol>`;
    case "blockquote":
      return `<blockquote><p>${renderInline(block.lines.join(" "), options)}</p></blockquote>`;
    case "code":
      return `<pre><code>${block.lines.map(escapeHtml).join("\n")}</code></pre>`;
    case "hr":
      return "<hr>";
    default:
      return "";
  }
}

/**
 * Render the house Markdown subset to HTML. Deterministic; every text run is
 * escaped before any tag is emitted.
 * @param {string} markdown
 * @param {MarkdownRenderOptions} [options]
 * @returns {string}
 */
export function renderMarkdown(markdown, options = {}) {
  return parseBlocks(markdown).map((block) => renderBlock(block, options)).join("\n");
}
