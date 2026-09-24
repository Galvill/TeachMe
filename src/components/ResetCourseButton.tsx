import { hasCourseProgress, resetCourse } from "../progress";
import { useProgress } from "../ProgressProvider";

type Props = {
  courseSlug: string;
  courseTitle: string;
  /** Slugs of the quizzes in this course's TOC. */
  quizSlugs: string[];
};

/**
 * Confirm-gated "Reset progress" button for one course. Renders nothing when
 * the course has no progress to clear. Only attempts made inside this course
 * are removed; standalone attempts and other courses' attempts at a shared
 * quiz are kept (see `resetCourse`).
 */
export default function ResetCourseButton({ courseSlug, courseTitle, quizSlugs }: Props) {
  const { progress, update } = useProgress();
  if (!hasCourseProgress(progress, courseSlug, quizSlugs)) return null;

  function handleClick() {
    const message =
      `Reset your progress in "${courseTitle}"?\n\n` +
      "This clears the lessons marked as visited and the quiz attempts made inside this course. " +
      "Attempts at the same quizzes taken on their own or from another course are kept. This can't be undone.";
    if (!window.confirm(message)) return;
    update((p) => resetCourse(p, courseSlug, quizSlugs));
  }

  return (
    <button type="button" className="button button--quiet" onClick={handleClick} aria-label={`Reset progress in ${courseTitle}`}>
      Reset progress
    </button>
  );
}
