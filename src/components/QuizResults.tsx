import { Link } from "react-router";
import type { Attempt, QuizDetail } from "../../shared/types";
import { useCatalog } from "../catalog";
import { isCorrect } from "../progress";
import Markdown from "./Markdown";

type Props = {
  quiz: QuizDetail;
  attempt: Attempt;
  onRetry: () => void;
  onContinue?: () => void;
};

/** Results screen: score, pass/fail, per-question review, and the context-appropriate next steps. */
export default function QuizResults({ quiz, attempt, onRetry, onContinue }: Props) {
  const catalog = useCatalog();
  const baseDir = `quizzes/${quiz.slug}`;
  const percent = Math.round((100 * attempt.score) / attempt.total);
  const passed = percent >= quiz.passingScore;
  const inCourse = attempt.context.startsWith("course:");
  const relatedCourse = quiz.course ? catalog.courses.find((c) => c.slug === quiz.course) : null;

  return (
    <div className="quiz">
      <div className="quiz__header">
        <p className="result-score">
          {attempt.score}/{attempt.total} ({percent}%)
        </p>
        <p className={passed ? "result-status--pass" : "result-status--fail"}>{passed ? "Passed" : "Not passed"}</p>
      </div>
      <ul className="result-list">
        {quiz.questions.map((q) => {
          const selected = attempt.answers[q.slug] ?? [];
          const correctOptions = q.options.filter((o) => o.correct);
          const ok = isCorrect(
            q.options.map((o) => o.correct),
            selected,
          );
          return (
            <li key={q.slug}>
              <details>
                <summary>
                  <span className={ok ? "is-correct" : "is-incorrect"} aria-hidden="true">
                    {ok ? "✓" : "✗"}
                  </span>
                  <span>{q.title}</span>
                </summary>
                <div className="result-detail">
                  <p>Your answer</p>
                  {selected.length === 0 ? (
                    <p>(no answer)</p>
                  ) : (
                    selected.map((i) => <Markdown key={i} source={q.options[i].md} baseDir={baseDir} />)
                  )}
                  <p>Correct answer</p>
                  {correctOptions.map((o, i) => (
                    <Markdown key={i} source={o.md} baseDir={baseDir} />
                  ))}
                  {q.explanation && (
                    <div className="explanation">
                      <Markdown source={q.explanation} baseDir={baseDir} />
                    </div>
                  )}
                </div>
              </details>
            </li>
          );
        })}
      </ul>
      <div className="quiz__actions">
        <button type="button" className="button" onClick={onRetry}>
          Retry
        </button>
        {inCourse ? (
          onContinue && (
            <button type="button" className="button button--primary" onClick={onContinue}>
              Continue
            </button>
          )
        ) : (
          <>
            <Link to="/" className="button button--primary">
              Back to home
            </Link>
            {quiz.course && (
              <Link to={`/courses/${encodeURIComponent(quiz.course)}`} className="button">
                {relatedCourse?.title ?? quiz.course}
              </Link>
            )}
          </>
        )}
      </div>
    </div>
  );
}
