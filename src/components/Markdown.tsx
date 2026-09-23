import { isValidElement, useMemo, type ComponentProps, type ReactNode } from "react";
import ReactMarkdown, { defaultUrlTransform, type Components, type ExtraProps } from "react-markdown";
import { Link } from "react-router";
import remarkGfm from "remark-gfm";
import { coursePath } from "../courseNav";
import CodeBlock from "./CodeBlock";
import Mermaid from "./Mermaid";

type Props = { source: string; baseDir: string };

/** True when `src` carries its own scheme (`http:`, `https:`, `data:`, `mailto:`, ...). */
function hasScheme(src: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(src);
}

/**
 * Resolve a Markdown-relative URL (typically an image `src`) against the
 * page's content-relative folder. Anything with a scheme, a root-relative
 * path (`/...`) or a fragment (`#...`) is returned untouched. Relative paths
 * are joined onto `baseDir` and normalized (`.`/`..` resolved), clamped so
 * they can never escape above the content root.
 */
export function resolveContentUrl(baseDir: string, src: string): string {
  if (!src || hasScheme(src) || src.startsWith("/") || src.startsWith("#")) return src;
  return `/content/${joinSegments(baseDir, src).join("/")}`;
}

/** Join `rel` onto `baseDir` and normalize `.`/`..`, clamped at the content root. */
function joinSegments(baseDir: string, rel: string): string[] {
  const stack: string[] = [];
  for (const segment of [...baseDir.split("/"), ...rel.split("/")]) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      stack.pop(); // clamp at root: popping an empty stack is a no-op
      continue;
    }
    stack.push(segment);
  }
  return stack;
}

/** Strip a leading `NN-` numeric prefix, as the loader does for slugs. */
function stripPrefix(name: string): string {
  return /^\d+-(.+)$/.exec(name)?.[1] ?? name;
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Map a relative link to a lesson's `.md` file (optionally with `#anchor`) to
 * its app route. `href` is resolved against the page's content-relative
 * `baseDir`; only `courses/<course>/[<NN-section>/]<NN-page>.md` maps (to
 * `/courses/<course>/[<section-slug>/]<page-slug>`). Anything else — other
 * `.md` files, non-`.md` links, absolute, fragment-only or schemed URLs —
 * returns null and is left as-is.
 */
export function resolveLessonLink(baseDir: string, href: string): string | null {
  if (!href || hasScheme(href) || href.startsWith("/") || href.startsWith("#")) return null;
  const hashIndex = href.indexOf("#");
  const pathPart = hashIndex === -1 ? href : href.slice(0, hashIndex);
  const anchor = hashIndex === -1 ? "" : href.slice(hashIndex);
  if (!pathPart.endsWith(".md")) return null;

  const segments = joinSegments(baseDir, pathPart).map(safeDecode);
  if (segments[0] !== "courses" || segments.length < 3 || segments.length > 4) return null;
  const [, course, ...rest] = segments;
  const fileName = rest[rest.length - 1];
  if (rest.some((name) => name.startsWith("_")) || (rest.length === 1 && fileName === "course.md")) return null;

  const pageSlug = stripPrefix(fileName.slice(0, -".md".length));
  const pagePath = rest.length === 2 ? `${stripPrefix(rest[0])}/${pageSlug}` : pageSlug;
  return coursePath(course, pagePath) + anchor;
}

/** Flatten a rendered React child tree back to plain text (fenced code has no nested markup). */
function flattenText(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(flattenText).join("");
  if (isValidElement(node)) return flattenText((node.props as { children?: ReactNode }).children);
  return "";
}

type PreProps = ComponentProps<"pre"> & ExtraProps;

/**
 * react-markdown >=9 has no `inline` prop, so block vs. inline code is told
 * apart here: a fenced block arrives as `<pre><code class="language-x">`, and
 * we take over its single `code` child. `mermaid` goes to `<Mermaid>`, any
 * other language to `<CodeBlock>`, and anything without a language (or that
 * isn't a single `code` element) falls back to the default `<pre>`. Inline
 * code never reaches here, so it keeps react-markdown's default rendering.
 */
function Pre({ children }: PreProps) {
  const child = Array.isArray(children) ? children[0] : children;
  if (isValidElement<{ className?: string; children?: ReactNode }>(child)) {
    const lang = /language-(\S+)/.exec(child.props.className ?? "")?.[1];
    const code = flattenText(child.props.children);
    if (lang === "mermaid") return <Mermaid code={code} />;
    if (lang) return <CodeBlock code={code} lang={lang} />;
  }
  return <pre>{children}</pre>;
}

type AProps = ComponentProps<"a"> & ExtraProps;

/**
 * Links to a lesson's `.md` file become client-side router links to that
 * lesson; external `http(s)://` links open in a new tab; other hrefs are left
 * as-is.
 */
function makeA(baseDir: string) {
  return function A({ node: _node, href, children, ...rest }: AProps) {
    const lesson = typeof href === "string" ? resolveLessonLink(baseDir, href) : null;
    if (lesson !== null) {
      return (
        <Link to={lesson} {...rest}>
          {children}
        </Link>
      );
    }
    const external = typeof href === "string" && /^https?:\/\//i.test(href);
    return (
      <a href={href} {...rest} {...(external ? { target: "_blank", rel: "noreferrer" } : {})}>
        {children}
      </a>
    );
  };
}

/**
 * Renders Markdown source: GFM tables/strikethrough/etc, syntax-highlighted
 * code, Mermaid diagrams, content-relative images and lesson-to-lesson links. Raw HTML is never
 * enabled (no rehype-raw) since content may come from anywhere on disk.
 */
export default function Markdown({ source, baseDir }: Props) {
  const components = useMemo<Components>(() => ({ pre: Pre, a: makeA(baseDir) }), [baseDir]);
  return (
    <div className="prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={components}
        urlTransform={(url, _key, node) => {
          // Sanitize every URL first (blocks `javascript:` etc, same as react-markdown's own
          // default) — "leave hrefs as-is" only means "don't rewrite them", not "skip this".
          const safe = defaultUrlTransform(url);
          return node.tagName === "img" ? resolveContentUrl(baseDir, safe) : safe;
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
