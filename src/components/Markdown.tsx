import { isValidElement, type ComponentProps, type ReactNode } from "react";
import ReactMarkdown, { defaultUrlTransform, type Components, type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";
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

  const stack: string[] = [];
  for (const segment of [...baseDir.split("/"), ...src.split("/")]) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      stack.pop(); // clamp at root: popping an empty stack is a no-op
      continue;
    }
    stack.push(segment);
  }
  return `/content/${stack.join("/")}`;
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

/** External `http(s)://` links open in a new tab; hrefs are otherwise left as-is. */
function A({ node: _node, href, children, ...rest }: AProps) {
  const external = typeof href === "string" && /^https?:\/\//i.test(href);
  return (
    <a href={href} {...rest} {...(external ? { target: "_blank", rel: "noreferrer" } : {})}>
      {children}
    </a>
  );
}

const components: Components = { pre: Pre, a: A };

/**
 * Renders Markdown source: GFM tables/strikethrough/etc, syntax-highlighted
 * code, Mermaid diagrams and content-relative images. Raw HTML is never
 * enabled (no rehype-raw) since content may come from anywhere on disk.
 */
export default function Markdown({ source, baseDir }: Props) {
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
