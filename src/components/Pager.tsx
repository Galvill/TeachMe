import { Link } from "react-router";
import type { TocItem } from "../../shared/types";
import { coursePath } from "../courseNav";

/** Label for the end-of-course action, shared by the pager and an inline final quiz's results. */
export const CATALOG_LABEL = "Back to catalog";

type Props = {
  courseSlug: string;
  prev: TocItem | null;
  next: TocItem | null;
  /** True on the course's last TOC item: the next slot links back to the catalog (`/`). */
  atEnd?: boolean;
};

/** Prev/next pager between TOC items; renders nothing when there is nothing to link to. */
export default function Pager({ courseSlug, prev, next, atEnd = false }: Props) {
  if (!prev && !next && !atEnd) return null;
  return (
    <nav className="pager" aria-label="Course pages">
      {prev && (
        <Link to={coursePath(courseSlug, prev.path)} className="pager__link pager__link--prev">
          <span className="pager__title">← {prev.title}</span>
        </Link>
      )}
      {next ? (
        <Link to={coursePath(courseSlug, next.path)} className="pager__link pager__link--next">
          <span className="pager__title">{next.title} →</span>
        </Link>
      ) : (
        atEnd && (
          <Link to="/" className="pager__link pager__link--next pager__link--end">
            <span className="pager__hint">End of course</span>
            <span className="pager__title">{CATALOG_LABEL} →</span>
          </Link>
        )
      )}
    </nav>
  );
}
