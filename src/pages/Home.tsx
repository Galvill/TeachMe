import { Link } from "react-router";
import type { CourseSummary, QuizSummary } from "../../shared/types";
import { useCatalog } from "../catalog";
import ResetCourseButton from "../components/ResetCourseButton";
import { bestAttempt, summaryPercent } from "../progress";
import { useProgress } from "../ProgressProvider";

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function CourseCard({ course }: { course: CourseSummary }) {
  const { progress } = useProgress();
  const percent = summaryPercent(course, progress);
  const lastPage = progress.courses[course.slug]?.lastPage ?? null;
  const base = `/courses/${encodeURIComponent(course.slug)}`;
  const href = percent > 0 && lastPage ? `${base}/${encodePath(lastPage)}` : base;
  const titleId = `course-${course.slug}`;
  const meta = plural(course.pageCount, "lesson") + (course.duration ? ` · ${course.duration}` : "");

  return (
    <article className="card course-card" aria-labelledby={titleId}>
      <h3 id={titleId} className="card__title">
        {course.title}
      </h3>
      {course.description && <p className="card__desc">{course.description}</p>}
      <p className="card__meta">{meta}</p>
      <div className="course-card__footer">
        <div
          className="progress"
          role="progressbar"
          aria-label={`${course.title} progress`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <div className="progress__fill" style={{ width: `${percent}%` }} />
        </div>
        <span className="course-card__percent">{percent}%</span>
        <Link to={href} className={percent === 0 ? "button button--primary" : "button"}>
          {percent === 0 ? "Start" : "Continue"}
        </Link>
      </div>
      <div className="course-card__reset">
        <ResetCourseButton courseSlug={course.slug} courseTitle={course.title} quizSlugs={course.quizzes} />
      </div>
    </article>
  );
}

function QuizRow({ quiz }: { quiz: QuizSummary }) {
  const { progress } = useProgress();
  const best = bestAttempt(progress, quiz.slug);
  const passed = best !== null && best.total > 0 && (100 * best.score) / best.total >= quiz.passingScore;

  return (
    <li>
      <Link to={`/quizzes/${encodeURIComponent(quiz.slug)}`} className="quiz-row">
        <span className="quiz-row__title">{quiz.title}</span>
        <span className="quiz-row__meta">{plural(quiz.questionCount, "question")}</span>
        <span className="quiz-row__meta">pass {quiz.passingScore}%</span>
        <span className={`quiz-row__score${passed ? " is-passed" : ""}`}>
          {best && `${best.score}/${best.total}${passed ? " ✓" : ""}`}
        </span>
      </Link>
    </li>
  );
}

export default function Home() {
  const catalog = useCatalog();

  return (
    <main className="page">
      <section className="home-section" aria-labelledby="courses-heading">
        <h2 id="courses-heading" className="section-title">
          Courses
        </h2>
        {catalog.courses.length === 0 ? (
          <p className="empty">No courses yet. Add one under <code>.teachme/courses/</code>.</p>
        ) : (
          <div className="card-list">
            {catalog.courses.map((c) => (
              <CourseCard key={c.slug} course={c} />
            ))}
          </div>
        )}
      </section>
      <section className="home-section" aria-labelledby="quizzes-heading">
        <h2 id="quizzes-heading" className="section-title">
          Quizzes
        </h2>
        {catalog.quizzes.length === 0 ? (
          <p className="empty">No quizzes yet. Add one under <code>.teachme/quizzes/</code>.</p>
        ) : (
          <ul className="quiz-list">
            {catalog.quizzes.map((q) => (
              <QuizRow key={q.slug} quiz={q} />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
