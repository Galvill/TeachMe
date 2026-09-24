import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import type { QuizDetail } from "../../shared/types";
import { ApiError, getQuiz } from "../api";
import QuizRunner from "../components/QuizRunner";

type State =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error"; message: string }
  | { status: "ready"; quiz: QuizDetail };

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Standalone quiz page (`/quizzes/:slug`): fetches the quiz and runs it. */
export default function QuizView() {
  const { slug } = useParams<{ slug: string }>();
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    getQuiz(slug as string)
      .then((quiz) => {
        if (!cancelled) setState({ status: "ready", quiz });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setState({ status: "not-found" });
        } else {
          setState({ status: "error", message: messageOf(err) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (state.status === "loading") {
    return (
      <main className="page center-message">
        <p role="status">Loading…</p>
      </main>
    );
  }

  if (state.status === "not-found") {
    return (
      <main className="page center-message">
        <h1>Quiz not found</h1>
        <p>
          <Link to="/">Back to home</Link>
        </p>
      </main>
    );
  }

  if (state.status === "error") {
    return (
      <main className="page center-message">
        <p role="alert">{state.message}</p>
      </main>
    );
  }

  return (
    <main className="page">
      <QuizRunner quiz={state.quiz} context="standalone" />
    </main>
  );
}
