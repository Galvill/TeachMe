type Props = {
  sources: string[];
  repoRoot: string;
};

/** `vscode://file/<abs path>` for a repo-relative source; Windows roots get forward slashes. */
function sourceHref(repoRoot: string, path: string): string {
  const root = repoRoot.startsWith("/") ? repoRoot : `/${repoRoot.replace(/\\/g, "/")}`;
  return `vscode://file${root}/${path}`;
}

/** Links to the source files a page was written from; hidden when there are none. */
export default function SourcesFooter({ sources, repoRoot }: Props) {
  if (sources.length === 0) return null;
  return (
    <footer className="sources">
      <h2>Sources</h2>
      <ul>
        {sources.map((path) => (
          <li key={path}>
            <a href={sourceHref(repoRoot, path)}>{path}</a>
          </li>
        ))}
      </ul>
    </footer>
  );
}
