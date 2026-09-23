type Props = {
  sources: string[];
  repoRoot: string;
};

/** Links to the source files a page was written from; hidden when there are none. */
export default function SourcesFooter({ sources, repoRoot }: Props) {
  if (sources.length === 0) return null;
  return (
    <footer className="sources">
      <h2>Sources</h2>
      <ul>
        {sources.map((path) => (
          <li key={path}>
            <a href={`vscode://file/${repoRoot}/${path}`}>{path}</a>
          </li>
        ))}
      </ul>
    </footer>
  );
}
