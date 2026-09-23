import { useState } from "react";
import type { Issue } from "../../shared/types";

type Props = { errors: Issue[]; warnings: Issue[] };

/** Content errors and warnings from the catalog; dismissible, hidden when there are none. */
export default function ErrorBanner({ errors, warnings }: Props) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed || (errors.length === 0 && warnings.length === 0)) return null;

  const items = [
    ...errors.map((issue) => ({ level: "ERROR", issue })),
    ...warnings.map((issue) => ({ level: "WARN", issue })),
  ];

  return (
    <div role="alert" className={`banner ${errors.length > 0 ? "banner--error" : "banner--warn"}`}>
      <ul className="banner__list">
        {items.map(({ level, issue }, i) => (
          <li key={i}>
            <span className={`banner__level banner__level--${level.toLowerCase()}`}>{level}</span>{" "}
            <code>{issue.file}</code>: {issue.message}
          </li>
        ))}
      </ul>
      <button type="button" className="icon-button" onClick={() => setDismissed(true)} aria-label="Dismiss">
        &times;
      </button>
    </div>
  );
}
