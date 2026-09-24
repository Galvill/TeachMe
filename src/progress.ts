import type { Attempt, CourseSummary, ProjectProgress, TocItem } from "../shared/types";

/**
 * Add `path` to the course's visited list (once) and set it as `lastPage`.
 * Never mutates `p`.
 */
export function markVisited(p: ProjectProgress, course: string, path: string): ProjectProgress {
  const existing = p.courses[course] ?? { visited: [], lastPage: null };
  const visited = existing.visited.includes(path) ? existing.visited : [...existing.visited, path];
  return {
    ...p,
    courses: {
      ...p.courses,
      [course]: { visited, lastPage: path },
    },
  };
}

/**
 * Append an attempt to a quiz's attempt list. Never mutates `p`.
 */
export function addAttempt(p: ProjectProgress, quiz: string, a: Attempt): ProjectProgress {
  const existing = p.quizzes[quiz] ?? { attempts: [] };
  return {
    ...p,
    quizzes: {
      ...p.quizzes,
      [quiz]: { attempts: [...existing.attempts, a] },
    },
  };
}

/**
 * Percent of `toc` completed: a page item counts when its path is in the
 * course's visited list; a quiz item counts when that quiz has any attempt.
 * Empty toc => 0.
 */
export function coursePercent(toc: TocItem[], p: ProjectProgress, course: string): number {
  if (toc.length === 0) return 0;
  const visited = new Set(p.courses[course]?.visited ?? []);
  let count = 0;
  for (const item of toc) {
    if (item.type === "page") {
      if (visited.has(item.path)) count++;
    } else if (item.type === "quiz") {
      if (item.quizSlug && (p.quizzes[item.quizSlug]?.attempts.length ?? 0) > 0) count++;
    }
  }
  return Math.round((100 * count) / toc.length);
}

/**
 * Percent complete for a catalog course summary (which has no TOC): counts
 * visited pages plus quizzes with at least one attempt, out of pageCount +
 * quizzes.length. Capped at 100; 0 when the denominator is 0.
 */
export function summaryPercent(s: CourseSummary, p: ProjectProgress): number {
  const denominator = s.pageCount + s.quizzes.length;
  if (denominator === 0) return 0;
  const visitedCount = p.courses[s.slug]?.visited.length ?? 0;
  const quizzesWithAttempt = s.quizzes.filter((q) => (p.quizzes[q]?.attempts.length ?? 0) > 0).length;
  const percent = Math.round((100 * (visitedCount + quizzesWithAttempt)) / denominator);
  return Math.min(100, percent);
}

/**
 * The attempt with the highest score/total ratio; ties go to the attempt
 * with the later `date`. Null when there are no attempts.
 */
export function bestAttempt(p: ProjectProgress, quiz: string): Attempt | null {
  const attempts = p.quizzes[quiz]?.attempts ?? [];
  if (attempts.length === 0) return null;
  return attempts.reduce((best, a) => {
    const bestRatio = best.score / best.total;
    const ratio = a.score / a.total;
    if (ratio > bestRatio) return a;
    if (ratio < bestRatio) return best;
    return new Date(a.date).getTime() >= new Date(best.date).getTime() ? a : best;
  });
}

/**
 * True when the set of selected indices exactly equals the set of correct
 * indices.
 */
export function isCorrect(correct: boolean[], selected: number[]): boolean {
  const correctIndices = new Set(correct.flatMap((c, i) => (c ? [i] : [])));
  const selectedIndices = new Set(selected);
  if (correctIndices.size !== selectedIndices.size) return false;
  for (const idx of correctIndices) {
    if (!selectedIndices.has(idx)) return false;
  }
  return true;
}

/** The attempt context a course's inline quizzes save under. */
function courseContext(course: string): Attempt["context"] {
  return `course:${course}`;
}

/**
 * Clear one course's progress: drops its `visited`/`lastPage` entry and, for
 * each of the course's quiz slugs, the attempts made *inside this course*
 * (`context === "course:<course>"`). Standalone attempts and attempts made
 * from another course sharing the quiz slug are kept, because
 * `ProjectProgress.quizzes` is keyed by quiz slug only. A quiz left with no
 * attempts loses its entry. Never mutates `p`; returns `p` unchanged when
 * there is nothing to clear.
 */
export function resetCourse(p: ProjectProgress, course: string, quizSlugs: string[]): ProjectProgress {
  if (!hasCourseProgress(p, course, quizSlugs)) return p;
  const { [course]: _removed, ...courses } = p.courses;
  const ctx = courseContext(course);
  const quizzes = { ...p.quizzes };
  for (const slug of quizSlugs) {
    const existing = quizzes[slug];
    if (!existing) continue;
    const attempts = existing.attempts.filter((a) => a.context !== ctx);
    if (attempts.length === existing.attempts.length) continue;
    if (attempts.length === 0) delete quizzes[slug];
    else quizzes[slug] = { attempts };
  }
  return { ...p, courses, quizzes };
}

/**
 * True when `resetCourse` would clear anything: the course has a progress
 * entry, or one of its quizzes has an attempt made inside this course.
 */
export function hasCourseProgress(p: ProjectProgress, course: string, quizSlugs: string[]): boolean {
  if (p.courses[course]) return true;
  const ctx = courseContext(course);
  return quizSlugs.some((slug) => (p.quizzes[slug]?.attempts ?? []).some((a) => a.context === ctx));
}
