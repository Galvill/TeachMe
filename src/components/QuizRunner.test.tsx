// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Catalog, ProjectProgress, QuizDetail } from "../../shared/types";
import { CatalogProvider } from "../catalog";
import { ProgressProvider } from "../ProgressProvider";
import QuizRunner from "./QuizRunner";

vi.mock("../api", () => ({
  getCatalog: vi.fn(),
  getProgress: vi.fn(),
  putProgress: vi.fn(),
}));

vi.mock("./Markdown", () => ({
  default: ({ source }: { source: string; baseDir: string }) => <div data-testid="markdown">{source}</div>,
}));

import { getCatalog, getProgress, putProgress } from "../api";

const catalog: Catalog = {
  project: "acme",
  repoRoot: "/repo/acme",
  courses: [{ slug: "basics", title: "Basics course", description: "", duration: null, pageCount: 1, quizzes: ["final-quiz"] }],
  quizzes: [],
  errors: [],
  warnings: [],
};

const singleQuiz: QuizDetail = {
  slug: "final-quiz",
  title: "Final Quiz",
  description: "",
  passingScore: 60,
  course: "basics",
  intro: "Intro text.",
  questions: [
    {
      slug: "q1",
      title: "Question one",
      prompt: "Prompt one",
      options: [
        { md: "Right", correct: true },
        { md: "Wrong", correct: false },
      ],
      multi: false,
      explanation: "Because right is right.",
    },
    {
      slug: "q2",
      title: "Question two",
      prompt: "Prompt two",
      options: [
        { md: "Also right", correct: true },
        { md: "Also wrong", correct: false },
      ],
      multi: false,
      explanation: null,
    },
  ],
};

const multiQuiz: QuizDetail = {
  slug: "multi-quiz",
  title: "Multi Quiz",
  description: "",
  passingScore: 100,
  course: null,
  intro: "Pick every correct option.",
  questions: [
    {
      slug: "m1",
      title: "Question multi",
      prompt: "Pick both correct answers",
      options: [
        { md: "Correct A", correct: true },
        { md: "Correct B", correct: true },
        { md: "Wrong C", correct: false },
      ],
      multi: true,
      explanation: null,
    },
  ],
};

async function renderRunner(quiz: QuizDetail, context: "standalone" | `course:${string}`, progress: ProjectProgress, onContinue?: () => void) {
  vi.mocked(getCatalog).mockResolvedValue(catalog);
  vi.mocked(getProgress).mockResolvedValue(progress);
  vi.mocked(putProgress).mockResolvedValue(undefined);
  render(
    <MemoryRouter>
      <CatalogProvider>
        <ProgressProvider>
          <QuizRunner quiz={quiz} context={context} onContinue={onContinue} />
        </ProgressProvider>
      </CatalogProvider>
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { level: 1, name: quiz.title });
}

describe("QuizRunner", () => {
  beforeEach(() => {
    vi.mocked(getCatalog).mockReset();
    vi.mocked(getProgress).mockReset();
    vi.mocked(putProgress).mockReset();
  });

  it("single choice flow scores", async () => {
    await renderRunner(singleQuiz, "standalone", { courses: {}, quizzes: {} });

    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await screen.findByText("Question 1 of 2");

    // Q1: pick the correct option
    fireEvent.click(screen.getByRole("radio", { name: /Right/ }));
    fireEvent.click(screen.getByRole("button", { name: "Check answer" }));
    expect(screen.getByText("Because right is right.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    // Q2: pick the wrong option
    await screen.findByText("Question 2 of 2");
    fireEvent.click(screen.getByRole("radio", { name: "Also wrong" }));
    fireEvent.click(screen.getByRole("button", { name: "Check answer" }));
    fireEvent.click(screen.getByRole("button", { name: "See results" }));

    await screen.findByText("1/2 (50%)");
    expect(screen.getByText("Not passed")).toBeTruthy();
  });

  it("multi requires exact set", async () => {
    await renderRunner(multiQuiz, "standalone", { courses: {}, quizzes: {} });

    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await screen.findByText("Question 1 of 1");
    expect(screen.getByText("Select all that apply")).toBeTruthy();

    // Select only one of the two correct options: not an exact match.
    fireEvent.click(screen.getByRole("checkbox", { name: "Correct A" }));
    fireEvent.click(screen.getByRole("button", { name: "Check answer" }));
    fireEvent.click(screen.getByRole("button", { name: "See results" }));

    await screen.findByText("0/1 (0%)");
  });

  it("check disabled until selection", async () => {
    await renderRunner(singleQuiz, "standalone", { courses: {}, quizzes: {} });

    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await screen.findByText("Question 1 of 2");

    const checkButton = screen.getByRole("button", { name: "Check answer" }) as HTMLButtonElement;
    expect(checkButton.disabled).toBe(true);

    fireEvent.click(screen.getByRole("radio", { name: /Right/ }));
    expect(checkButton.disabled).toBe(false);
  });

  it("attempt saved once", async () => {
    await renderRunner(singleQuiz, "standalone", { courses: {}, quizzes: {} });

    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await screen.findByText("Question 1 of 2");
    fireEvent.click(screen.getByRole("radio", { name: /Right/ }));
    fireEvent.click(screen.getByRole("button", { name: "Check answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await screen.findByText("Question 2 of 2");
    fireEvent.click(screen.getByRole("radio", { name: /Also right/ }));
    fireEvent.click(screen.getByRole("button", { name: "Check answer" }));
    fireEvent.click(screen.getByRole("button", { name: "See results" }));

    await screen.findByText("2/2 (100%)");
    await waitFor(() => expect(putProgress).toHaveBeenCalledTimes(1));
    const saved = vi.mocked(putProgress).mock.calls[0][0];
    expect(saved.quizzes["final-quiz"].attempts).toHaveLength(1);
    const attempt = saved.quizzes["final-quiz"].attempts[0];
    expect(attempt.context).toBe("standalone");
    expect(attempt.score).toBe(2);
    expect(attempt.total).toBe(2);
    expect(attempt.answers).toEqual({ q1: [0], q2: [0] });

    // Standalone results also offer a way back and to the related course.
    expect(screen.getByRole("link", { name: "Back to home" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Basics course" }).getAttribute("href")).toBe("/courses/basics");
  });

  it("retry resets", async () => {
    await renderRunner(singleQuiz, "standalone", { courses: {}, quizzes: {} });

    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await screen.findByText("Question 1 of 2");
    fireEvent.click(screen.getByRole("radio", { name: /Right/ }));
    fireEvent.click(screen.getByRole("button", { name: "Check answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Question 2 of 2");
    fireEvent.click(screen.getByRole("radio", { name: /Also wrong/ }));
    fireEvent.click(screen.getByRole("button", { name: "Check answer" }));
    fireEvent.click(screen.getByRole("button", { name: "See results" }));

    await screen.findByText("1/2 (50%)");
    await waitFor(() => expect(putProgress).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    // Retry skips the start screen and goes straight to question 1.
    await screen.findByText("Question 1 of 2");
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
    const rightOption = screen.getByRole("radio", { name: /Right/ }) as HTMLInputElement;
    expect(rightOption.checked).toBe(false);

    // Completing the retried attempt saves a second attempt.
    fireEvent.click(rightOption);
    fireEvent.click(screen.getByRole("button", { name: "Check answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Question 2 of 2");
    fireEvent.click(screen.getByRole("radio", { name: /Also right/ }));
    fireEvent.click(screen.getByRole("button", { name: "Check answer" }));
    fireEvent.click(screen.getByRole("button", { name: "See results" }));

    await screen.findByText("2/2 (100%)");
    await waitFor(() => expect(putProgress).toHaveBeenCalledTimes(2));
    const saved = vi.mocked(putProgress).mock.calls[1][0];
    expect(saved.quizzes["final-quiz"].attempts).toHaveLength(2);
  });

  it("continue shown in course context", async () => {
    const onContinue = vi.fn();
    await renderRunner(singleQuiz, "course:basics", { courses: {}, quizzes: {} }, onContinue);

    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await screen.findByText("Question 1 of 2");
    fireEvent.click(screen.getByRole("radio", { name: /Right/ }));
    fireEvent.click(screen.getByRole("button", { name: "Check answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Question 2 of 2");
    fireEvent.click(screen.getByRole("radio", { name: /Also right/ }));
    fireEvent.click(screen.getByRole("button", { name: "Check answer" }));
    fireEvent.click(screen.getByRole("button", { name: "See results" }));

    await screen.findByText("2/2 (100%)");
    expect(screen.queryByRole("link", { name: "Back to home" })).toBeNull();

    const continueButton = screen.getByRole("button", { name: "Continue" });
    fireEvent.click(continueButton);
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});
