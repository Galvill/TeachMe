import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

/** @typedef {import('../shared/types.js').Issue} Issue */
/** @typedef {{ errors: Issue[]; warnings: Issue[] }} Issues */

const MERMAID_RE = /```mermaid[ \t]*\r?\n([\s\S]*?)```/g;
const IMAGE_RE = /!\[[^\]]*\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g;
const URL_SCHEME_RE = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;

/**
 * Read and parse a Markdown file's frontmatter. On invalid YAML, records an
 * `Invalid frontmatter: <message>` error and returns `ok: false`.
 * @param {string} absPath
 * @param {(absPath: string) => string} relPath
 * @param {Issues} issues
 * @returns {{ ok: boolean; data: Record<string, unknown>; content: string }}
 */
export function tryReadMarkdown(absPath, relPath, issues) {
  const raw = fs.readFileSync(absPath, "utf8");
  try {
    // gray-matter caches parses by input string; pass {} as options to avoid
    // stale results across tests/files.
    const parsed = matter(raw, {});
    return { ok: true, data: parsed.data, content: parsed.content };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    issues.errors.push({
      file: relPath(absPath),
      message: `Invalid frontmatter: ${message.split("\n")[0]}`,
    });
    return { ok: false, data: {}, content: "" };
  }
}

/**
 * Normalize a frontmatter `sources:` value to a list of paths. Missing → [];
 * a lone string → a one-element list. Anything else that is not a list of
 * strings records a `sources must be a list of file paths` error and keeps
 * only the string entries (or [] if none).
 * @param {unknown} raw
 * @param {string} file
 * @param {Issues} issues
 * @returns {string[]}
 */
export function normalizeSources(raw, file, issues) {
  if (raw == null) return [];
  if (typeof raw === "string") return [raw];
  const list = Array.isArray(raw) ? raw : [];
  /** @type {string[]} */
  const valid = list.filter((s) => typeof s === "string");
  if (!Array.isArray(raw) || valid.length !== list.length) {
    issues.errors.push({ file, message: "sources must be a list of file paths" });
  }
  return valid;
}

/**
 * Warn for each `sources:` entry that does not exist under `repoRoot`.
 * @param {string[]} sources
 * @param {string} file
 * @param {string} repoRoot
 * @param {Issues} issues
 * @returns {void}
 */
export function checkSources(sources, file, repoRoot, issues) {
  for (const src of sources) {
    if (!fs.existsSync(path.join(repoRoot, src))) {
      issues.warnings.push({ file, message: `Source not found: ${src}` });
    }
  }
}

/**
 * @param {string} src
 * @returns {boolean}
 */
function isAbsoluteOrAnchorRef(src) {
  return src.startsWith("/") || src.startsWith("#") || URL_SCHEME_RE.test(src);
}

/**
 * Scan Markdown text for empty fenced mermaid blocks and relative image
 * links that don't resolve, pushing warnings for each.
 * @param {string} text
 * @param {string} absDir directory the Markdown file lives in
 * @param {string} file contentDir-relative path of the Markdown file
 * @param {Issues} issues
 * @returns {void}
 */
export function checkMarkdownContent(text, absDir, file, issues) {
  if (!text) return;

  MERMAID_RE.lastIndex = 0;
  /** @type {RegExpExecArray | null} */
  let mermaidMatch;
  while ((mermaidMatch = MERMAID_RE.exec(text))) {
    if (mermaidMatch[1].trim() === "") {
      issues.warnings.push({ file, message: "Empty mermaid block" });
    }
  }

  IMAGE_RE.lastIndex = 0;
  /** @type {RegExpExecArray | null} */
  let imageMatch;
  while ((imageMatch = IMAGE_RE.exec(text))) {
    const src = imageMatch[1];
    if (isAbsoluteOrAnchorRef(src)) continue;
    if (!fs.existsSync(path.resolve(absDir, src))) {
      issues.warnings.push({ file, message: `Image not found: ${src}` });
    }
  }
}
