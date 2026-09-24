import { useState } from "react";
import type { Attempt, QuizDetail } from "../../shared/types";
import { addAttempt, isCorrect } from "../progress";
import { useProgress } from "../ProgressProvider";
import Markdown from "./Markdown";
import QuizResults from "./QuizResults";

type Props = {
  quiz: QuizDetail;
  context: Attempt["context"];
  onContinue?: () => void;
  /** Text for the in-course Continue button (default "Continue"). */
  continueLabel?: string;
};

type Phase = "start" | "question" | "results";

/**
 * Runs a quiz one question at a time: start screen -> question (with
 * check/next) -> results. Saves exactly one attempt when results are first
 * reached; Retry restarts straight into question 1.
 */
export default function QuizRunner({ quiz, context, onContinue, continueLabel }: Props) {
  const { update } = useProgress();
  const [phase, setPhase] = useState<Phase>("start");
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number[]>>({});
  const [selected, setSelected] = useState<number[]>([]);
  const [checked, setChecked] = useState(false);
  const [lastAttempt, setLastAttempt] = useState<Attempt | null>(null);

  const baseDir = `quizzes/${quiz.slug}`;
  const total = quiz.questions.length;

  function toggleOption(i: number, multi: boolean) {
    if (checked) return;
    setSelected((current) => {
      if (!multi) return [i];
      return current.includes(i) ? current.filter((x) => x !== i) : [...current, i].sort((a, b) => a - b);
    });
  }

  function finish(answers: Record<string, number[]>) {
    let score = 0;
    for (const q of quiz.questions) {
      if (
        isCorrect(
          q.options.map((o) => o.correct),
          answers[q.slug] ?? [],
        )
      ) {
        score++;
      }
    }
    const attempt: Attempt = { context, date: new Date().toISOString(), score, total, answers };
    update((p) => addAttempt(p, quiz.slug, attempt));
    setLastAttempt(attempt);
    setPhase("results");
  }

  function next() {
    const updated = { ...answers, [question.slug]: selected };
    setAnswers(updated);
    if (index + 1 < total) {
      setIndex((i) => i + 1);
      setSelected([]);
      setChecked(false);
    } else {
      finish(updated);
    }
  }

  function retry() {
    setIndex(0);
    setAnswers({});
    setSelected([]);
    setChecked(false);
    setLastAttempt(null);
    setPhase("question");
  }

  if (phase === "start") {
    return (
      <div className="quiz">
        <div className="quiz__header">
          <h1>{quiz.title}</h1>
          <Markdown source={quiz.intro} baseDir={baseDir} />
          <p className="quiz__hint">
            {total} question{total === 1 ? "" : "s"} · pass {quiz.passingScore}%
          </p>
        </div>
        <div className="quiz__actions">
          <button type="button" className="button button--primary" onClick={() => setPhase("question")}>
            Start
          </button>
        </div>
      </div>
    );
  }

  if (phase === "results" && lastAttempt) {
    return <QuizResults quiz={quiz} attempt={lastAttempt} onRetry={retry} onContinue={onContinue} continueLabel={continueLabel} />;
  }

  const question = quiz.questions[index];
  const percent = Math.round((100 * index) / total);
  const isLast = index + 1 === total;

  return (
    <div className="quiz">
      <div className="quiz__header">
        <p className="quiz__counter">
          Question {index + 1} of {total}
        </p>
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
          <div className="progress__fill" style={{ width: `${percent}%` }} />
        </div>
      </div>
      <Markdown source={question.prompt} baseDir={baseDir} />
      {question.multi && <p className="quiz__hint">Select all that apply</p>}
      <fieldset className="option-list" aria-label={question.multi ? "Select all that apply" : "Options"}>
        {question.options.map((opt, i) => {
          const isSelected = selected.includes(i);
          const classes = ["option"];
          if (checked) {
            classes.push("is-locked");
            if (opt.correct) classes.push("is-correct");
            else if (isSelected) classes.push("is-incorrect");
          } else if (isSelected) {
            classes.push("is-selected");
          }
          return (
            <label key={i} className={classes.join(" ")}>
              <input
                type={question.multi ? "checkbox" : "radio"}
                name={`question-${question.slug}`}
                checked={isSelected}
                disabled={checked}
                onChange={() => toggleOption(i, question.multi)}
              />
              <span className="option__body">
                <Markdown source={opt.md} baseDir={baseDir} />
              </span>
            </label>
          );
        })}
      </fieldset>
      {checked && question.explanation && (
        <div className="explanation">
          <Markdown source={question.explanation} baseDir={baseDir} />
        </div>
      )}
      <div className="quiz__actions">
        {!checked ? (
          <button type="button" className="button button--primary" disabled={selected.length === 0} onClick={() => setChecked(true)}>
            Check answer
          </button>
        ) : (
          <button type="button" className="button button--primary" onClick={next}>
            {isLast ? "See results" : "Next"}
          </button>
        )}
      </div>
    </div>
  );
}
