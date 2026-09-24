import { Fragment } from "react";
import { Link } from "react-router";
import type { TocItem } from "../../shared/types";
import { useCatalog } from "../catalog";
import { coursePath } from "../courseNav";
import { bestAttempt, coursePercent } from "../progress";
import { useProgress } from "../ProgressProvider";

type Props = {
  courseSlug: string;
  courseTitle: string;
  toc: TocItem[];
  currentPath: string | null;
  open: boolean;
  onNavigate: () => void;
};

/** Human label: the final course quiz (no section) is called out specially. */
function label(item: TocItem): string {
  if (item.type === "quiz" && item.section === null) return "Final quiz";
  return item.title;
}

/** Renders the course's collapsible TOC sidebar: back link, title, progress bar and item list. */
export default function Toc({ courseSlug, courseTitle, toc, currentPath, open, onNavigate }: Props) {
  const { progress } = useProgress();
  const catalog = useCatalog();
  const percent = coursePercent(toc, progress, courseSlug);
  const visitedPaths = new Set(progress.courses[courseSlug]?.visited ?? []);

  let lastSection: string | null = null;

  return (
    <aside id="course-toc" className={`sidebar${open ? " is-open" : ""}`}>
      <Link to="/" className="sidebar__back">
        ← All courses
      </Link>
      <h2 className="sidebar__title">{courseTitle}</h2>
      <div className="sidebar__progress">
        <div
          className="progress"
          role="progressbar"
          aria-label={`${courseTitle} progress`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <div className="progress__fill" style={{ width: `${percent}%` }} />
        </div>
        <span>{percent}%</span>
      </div>
      <ul className="toc">
        {toc.map((item) => {
          const showHeader = item.section !== null && item.section !== lastSection;
          lastSection = item.section;

          const current = currentPath === item.path;
          const visited = item.type === "page" && visitedPaths.has(item.path);

          const best = item.type === "quiz" && item.quizSlug ? bestAttempt(progress, item.quizSlug) : null;
          const passingScore = item.type === "quiz" && item.quizSlug ? catalog.quizzes.find((q) => q.slug === item.quizSlug)?.passingScore : undefined;
          const bestPercent = best ? Math.round((100 * best.score) / best.total) : null;
          const failed = best !== null && bestPercent !== null && passingScore !== undefined && bestPercent < passingScore;

          const classes = ["toc__item"];
          if (current) classes.push("is-current");
          if (visited) classes.push("is-visited");
          if (failed) classes.push("is-failed");

          return (
            <Fragment key={item.path}>
              {showHeader && (
                <li className="toc__section" role="presentation">
                  {item.section}
                </li>
              )}
              <li>
                <Link
                  to={coursePath(courseSlug, item.path)}
                  className={classes.join(" ")}
                  aria-current={current ? "page" : undefined}
                  onClick={onNavigate}
                >
                  <span className="toc__marker" aria-hidden="true">
                    {item.type === "quiz" ? "◇" : current ? "●" : visited ? "✓" : "○"}
                  </span>
                  <span className="toc__label">{label(item)}</span>
                  {best && (
                    <span
                      className="toc__score"
                      aria-label={failed ? `${best.score} of ${best.total}, below the pass mark` : `${best.score} of ${best.total}`}
                    >
                      {best.score}/{best.total}
                    </span>
                  )}
                </Link>
              </li>
            </Fragment>
          );
        })}
      </ul>
    </aside>
  );
}
