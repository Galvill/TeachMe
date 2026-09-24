import { useEffect, useState } from "react";
import { useTheme } from "../theme";

type Props = { code: string; lang: string };

/**
 * Syntax-highlighted code block. Renders a plain `<pre><code>` immediately and
 * swaps in Shiki-highlighted HTML once it's ready. An unrecognized language or
 * any highlighting failure leaves the plain version in place. Re-highlights
 * when the app theme changes.
 */
export default function CodeBlock({ code, lang }: Props) {
  const { theme } = useTheme();
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);

    import("shiki")
      .then(({ codeToHtml }) => codeToHtml(code, { lang, theme: theme === "dark" ? "github-dark" : "github-light" }))
      .then((result) => {
        if (!cancelled) setHtml(result);
      })
      .catch(() => {
        // Unknown/unsupported language or highlighter failure: keep the plain rendering.
        if (!cancelled) setHtml(null);
      });

    return () => {
      cancelled = true;
    };
  }, [code, lang, theme]);

  if (html) {
    return <div dangerouslySetInnerHTML={{ __html: html }} />;
  }

  return (
    <pre className="code-block">
      <code>{code}</code>
    </pre>
  );
}
