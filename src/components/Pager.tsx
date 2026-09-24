import { Link } from "react-router";
import type { TocItem } from "../../shared/types";
import { coursePath } from "../courseNav";

type Props = {
  courseSlug: string;
  prev: TocItem | null;
  next: TocItem | null;
};

/** Prev/next pager between TOC items; renders nothing when there is neither. */
export default function Pager({ courseSlug, prev, next }: Props) {
  if (!prev && !next) return null;
  return (
    <nav className="pager" aria-label="Course pages">
      {prev && (
        <Link to={coursePath(courseSlug, prev.path)} className="pager__link pager__link--prev">
          <span className="pager__title">← {prev.title}</span>
        </Link>
      )}
      {next && (
        <Link to={coursePath(courseSlug, next.path)} className="pager__link pager__link--next">
          <span className="pager__title">{next.title} →</span>
        </Link>
      )}
    </nav>
  );
}
