import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useTheme } from "../theme";

type Props = { code: string };

type State = { status: "loading" } | { status: "ok"; svg: string } | { status: "error"; message: string };

/** Strip everything outside mermaid's allowed id characters (React's `useId` includes `:`). */
function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "");
}

/** Mirrors `--font-sans` in styles.css; used when the stylesheet isn't loaded (e.g. tests). */
export const FALLBACK_FONT_FAMILY =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif';

/**
 * The app's sans-serif stack, read from the `--font-sans` token so diagram
 * labels are measured and drawn in the same font as the surrounding page
 * instead of Mermaid's own default (`"trebuchet ms", verdana, arial`).
 */
export function appFontFamily(): string {
  const fromCss = getComputedStyle(document.documentElement).getPropertyValue("--font-sans").trim();
  return fromCss || FALLBACK_FONT_FAMILY;
}

/** Mermaid's own `viewBox` margin around the drawn diagram (flowchart `diagramPadding`). */
const VIEWBOX_PADDING = 8;

/**
 * Grow an inserted diagram's `viewBox` so it covers everything actually drawn.
 *
 * Mermaid computes the `viewBox` once, from `getBBox()` in a detached render
 * container, and an outer `<svg>` clips whatever falls outside it. If the
 * diagram paints larger where it is finally shown (a label measured one way
 * and drawn another), nodes at the right and bottom edges get cut off. This
 * re-measures in the live page and only ever widens the box, never shrinks it.
 * Returns whether the `viewBox` changed.
 */
export function fitViewBox(svg: SVGSVGElement): boolean {
  const parts = (svg.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return false;
  if (typeof svg.getBBox !== "function") return false;
  let box: DOMRect;
  try {
    box = svg.getBBox();
  } catch {
    return false; // not rendered (e.g. display: none) — nothing to measure
  }
  if (box.width <= 0 || box.height <= 0) return false;

  const [vx, vy, vw, vh] = parts;
  // Ignore sub-pixel float noise between Mermaid's numbers and ours.
  const grow = (from: number, to: number, outward: 1 | -1) => ((to - from) * outward > 0.5 ? to : from);
  const x0 = grow(vx, box.x - VIEWBOX_PADDING, -1);
  const y0 = grow(vy, box.y - VIEWBOX_PADDING, -1);
  const x1 = grow(vx + vw, box.x + box.width + VIEWBOX_PADDING, 1);
  const y1 = grow(vy + vh, box.y + box.height + VIEWBOX_PADDING, 1);
  if (x0 === vx && y0 === vy && x1 === vx + vw && y1 === vy + vh) return false;

  svg.setAttribute("viewBox", `${x0} ${y0} ${x1 - x0} ${y1 - y0}`);
  // With `useMaxWidth`, Mermaid caps the rendered width at the viewBox width; keep them in step.
  if (svg.style.maxWidth) svg.style.maxWidth = `${x1 - x0}px`;
  return true;
}

/**
 * Renders a Mermaid diagram from source. Lazy-loads mermaid, re-initializes
 * it with the current theme before every render (so it stays in sync when
 * the user toggles theme), and falls back to an inline error box with the
 * diagram source on failure without breaking the rest of the page. Once the
 * SVG is in the page, `fitViewBox` widens its box to whatever was drawn.
 */
export default function Mermaid({ code }: Props) {
  const { theme } = useTheme();
  const id = `mermaid-${sanitizeId(useId())}`;
  const [state, setState] = useState<State>({ status: "loading" });
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    import("mermaid")
      .then(async ({ default: mermaid }) => {
        const fontFamily = appFontFamily();
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: theme === "dark" ? "dark" : "default",
          // Pin the font explicitly: layout measures label text in this font, and
          // Mermaid's default stack resolves differently per OS (issue #3).
          fontFamily,
          themeVariables: { fontFamily },
          // Draw labels as plain SVG <text> instead of HTML inside <foreignObject>
          // (Mermaid's default). foreignObject labels are sized by the browser's
          // CSS layout in a detached element, which is the least predictable
          // measurement path across machines (issue #3).
          htmlLabels: false,
        });
        try {
          const { svg } = await mermaid.render(id, code);
          if (!cancelled) setState({ status: "ok", svg });
        } catch (err) {
          // Mermaid can leave a detached render target in the document on failure.
          document.getElementById(`d${id}`)?.remove();
          document.getElementById(id)?.remove();
          if (!cancelled) setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
      });

    return () => {
      cancelled = true;
    };
  }, [code, theme, id]);

  const svgMarkup = state.status === "ok" ? state.svg : null;
  useLayoutEffect(() => {
    const svg = containerRef.current?.querySelector("svg");
    if (!svgMarkup || !svg) return;
    fitViewBox(svg);
    // System fonts can still swap in after first paint; re-fit once they settle.
    let active = true;
    document.fonts?.ready.then(() => {
      if (active && svg.isConnected) fitViewBox(svg);
    });
    return () => {
      active = false;
    };
  }, [svgMarkup]);

  if (state.status === "error") {
    return (
      <div className="render-error mermaid-error">
        <p>{state.message}</p>
        <pre>{code}</pre>
      </div>
    );
  }

  if (state.status === "ok") {
    return <div className="mermaid" ref={containerRef} dangerouslySetInnerHTML={{ __html: state.svg }} />;
  }

  return <div className="mermaid" aria-busy="true" />;
}
