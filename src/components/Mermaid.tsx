import { useEffect, useId, useState } from "react";
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

/**
 * Renders a Mermaid diagram from source. Lazy-loads mermaid, re-initializes
 * it with the current theme before every render (so it stays in sync when
 * the user toggles theme), and falls back to an inline error box with the
 * diagram source on failure without breaking the rest of the page.
 */
export default function Mermaid({ code }: Props) {
  const { theme } = useTheme();
  const id = `mermaid-${sanitizeId(useId())}`;
  const [state, setState] = useState<State>({ status: "loading" });

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

  if (state.status === "error") {
    return (
      <div className="render-error mermaid-error">
        <p>{state.message}</p>
        <pre>{code}</pre>
      </div>
    );
  }

  if (state.status === "ok") {
    return <div className="mermaid" dangerouslySetInnerHTML={{ __html: state.svg }} />;
  }

  return <div className="mermaid" aria-busy="true" />;
}
