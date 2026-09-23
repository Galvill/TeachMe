import type { TocItem } from "../shared/types";

/** Build the URL for a TOC item's path inside a course, encoding each `/`-separated segment. */
export function coursePath(slug: string, itemPath: string): string {
  const segments = itemPath
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  return `/courses/${encodeURIComponent(slug)}/${segments}`;
}

/**
 * The TOC items immediately before/after `path` in document order (pages and
 * quizzes share one sequence, so this crosses section and quiz boundaries).
 * Both are null when `path` isn't found in `toc`; `prev`/`next` are null at
 * the start/end of the course.
 */
export function neighbors(toc: TocItem[], path: string): { prev: TocItem | null; next: TocItem | null } {
  const index = toc.findIndex((item) => item.path === path);
  if (index === -1) return { prev: null, next: null };
  return {
    prev: index > 0 ? toc[index - 1] : null,
    next: index < toc.length - 1 ? toc[index + 1] : null,
  };
}
