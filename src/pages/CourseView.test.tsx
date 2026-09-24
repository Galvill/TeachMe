// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Catalog, CourseDetail, PageDetail, ProjectProgress, QuizDetail, TocItem } from "../../shared/types";
import App from "../App";
import { neighbors } from "../courseNav";

vi.mock("../api", () => {
  class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.name = "ApiError";
      this.status = status;
    }
  }
  return {
    ApiError,
    getCatalog: vi.fn(),
    getCourse: vi.fn(),
    getPage: vi.fn(),
    getQuiz: vi.fn(),
    getProgress: vi.fn(),
    putProgress: vi.fn(),
  };
});

vi.mock("../components/Markdown", () => ({
  default: ({ source }: { source: string; baseDir: string }) => <div data-testid="markdown">{source}</div>,
}));

import { ApiError, getCatalog, getCourse, getPage, getProgress, getQuiz, putProgress } from "../api";

const catalog: Catalog = {
  project: "acme",
  repoRoot: "/repo/acme",
  courses: [
    { slug: "basics", title: "Basics", description: "Start here.", duration: "20 min", pageCount: 3, quizzes: ["sec-quiz", "final-quiz"] },
  ],
  quizzes: [
    { slug: "sec-quiz", title: "Section Quiz", description: "", questionCount: 4, passingScore: 75 },
    { slug: "final-quiz", title: "Final Exam", description: "", questionCount: 8, passingScore: 80 },
  ],
  errors: [],
  warnings: [],
};

const toc: TocItem[] = [
  { type: "page", path: "01-welcome", title: "Welcome", section: null },
  { type: "page", path: "02-writing/01-pages", title: "Pages", section: "Writing" },
  { type: "page", path: "02-writing/02-quizzes", title: "Quizzes", section: "Writing" },
  { type: "quiz", path: "_quiz/sec-quiz", title: "Section Quiz", section: "Writing", quizSlug: "sec-quiz" },
  { type: "quiz", path: "_quiz/final-quiz", title: "Final Exam", section: null, quizSlug: "final-quiz" },
];

const course: CourseDetail = {
  slug: "basics",
  title: "Basics",
  description: "Start here.",
  duration: "20 min",
  quiz: "final-quiz",
  intro: "Intro body.",
  toc,
};

const pages: Record<string, PageDetail> = {
  "01-welcome": { path: "01-welcome", title: "Welcome", body: "Welcome body.", sources: ["src/welcome.ts"], file: "courses/basics/01-welcome.md" },
  "02-writing/01-pages": {
    path: "02-writing/01-pages",
    title: "Pages",
    body: "Pages body.",
    sources: ["src/pages.ts"],
    file: "courses/basics/02-writing/01-pages.md",
  },
  "02-writing/02-quizzes": {
    path: "02-writing/02-quizzes",
    title: "Quizzes",
    body: "Quizzes body.",
    sources: [],
    file: "courses/basics/02-writing/02-quizzes.md",
  },
};

const quizzes: Record<string, QuizDetail> = {
  "sec-quiz": {
    slug: "sec-quiz",
    title: "Section Quiz",
    description: "",
    passingScore: 75,
    course: "basics",
    intro: "Section quiz intro.",
    questions: [
      {
        slug: "sq1",
        title: "Section question",
        prompt: "Section prompt",
        options: [
          { md: "Right", correct: true },
          { md: "Wrong", correct: false },
        ],
        multi: false,
        explanation: null,
      },
    ],
  },
  "final-quiz": {
    slug: "final-quiz",
    title: "Final Exam",
    description: "",
    passingScore: 80,
    course: "basics",
    intro: "Final exam intro.",
    questions: [
      {
        slug: "fq1",
        title: "Final question",
        prompt: "Final prompt",
        options: [
          { md: "Right", correct: true },
          { md: "Wrong", correct: false },
        ],
        multi: false,
        explanation: null,
      },
    ],
  },
};

async function renderCourse(initialPath: string, progress: ProjectProgress, courseDetail: CourseDetail = course) {
  vi.mocked(getCatalog).mockResolvedValue(catalog);
  vi.mocked(getProgress).mockResolvedValue(progress);
  vi.mocked(putProgress).mockResolvedValue(undefined);
  vi.mocked(getCourse).mockResolvedValue(courseDetail);
  vi.mocked(getPage).mockImplementation(async (_slug: string, path: string) => {
    const page = pages[path];
    if (!page) throw new ApiError(404, "Page not found");
    return page;
  });
  vi.mocked(getQuiz).mockImplementation(async (slug: string) => {
    const quiz = quizzes[slug];
    if (!quiz) throw new ApiError(404, "Quiz not found");
    return quiz;
  });
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <App />
    </MemoryRouter>,
  );
}

describe("CourseView", () => {
  beforeEach(() => {
    vi.mocked(getCatalog).mockReset();
    vi.mocked(getCourse).mockReset();
    vi.mocked(getPage).mockReset();
    vi.mocked(getQuiz).mockReset();
    vi.mocked(getProgress).mockReset();
    vi.mocked(putProgress).mockReset();
  });

  it("toc states", async () => {
    await renderCourse("/courses/basics/02-writing/01-pages", {
      courses: { basics: { visited: ["01-welcome"], lastPage: "01-welcome" } },
      quizzes: {
        "sec-quiz": { attempts: [{ context: "course:basics", date: "2026-01-01T00:00:00Z", score: 2, total: 4, answers: {} }] },
      },
    });

    await screen.findByRole("heading", { level: 1, name: "Pages" });
    const sidebar = within(document.getElementById("course-toc")!);

    // section header appears once, not once per item in that section
    expect(sidebar.getAllByText("Writing")).toHaveLength(1);
    expect(screen.getByText("Writing · Lesson 2 of 3")).toBeTruthy();

    const welcome = sidebar.getByText("Welcome").closest("a")!;
    expect(welcome.className).toContain("is-visited");
    expect(welcome.className).not.toContain("is-current");
    expect(welcome.querySelector(".toc__marker")?.textContent).toBe("✓");

    const pagesItem = sidebar.getByText("Pages").closest("a")!;
    expect(pagesItem.className).toContain("is-current");
    expect(pagesItem.querySelector(".toc__marker")?.textContent).toBe("●");

    const quizzesItem = sidebar.getByText("Quizzes").closest("a")!;
    expect(quizzesItem.className).not.toContain("is-visited");
    expect(quizzesItem.className).not.toContain("is-current");
    expect(quizzesItem.querySelector(".toc__marker")?.textContent).toBe("○");

    const secQuiz = sidebar.getByText("Section Quiz").closest("a")!;
    expect(secQuiz.querySelector(".toc__marker")?.textContent).toBe("◇");
    expect(secQuiz.className).toContain("is-failed");
    expect(secQuiz.querySelector(".toc__score")?.textContent).toBe("2/4");

    // final course quiz (section null) is labelled specially and has no attempts yet
    const finalQuiz = sidebar.getByText("Final quiz").closest("a")!;
    expect(finalQuiz.className).not.toContain("is-failed");
    expect(finalQuiz.querySelector(".toc__score")).toBeNull();
  });

  it("toc quiz badge and failed mark count only attempts made in this course", async () => {
    await renderCourse("/courses/basics/01-welcome", {
      courses: {},
      quizzes: {
        "sec-quiz": { attempts: [{ context: "standalone", date: "2026-01-01T00:00:00Z", score: 1, total: 4, answers: {} }] },
        "final-quiz": {
          attempts: [
            { context: "standalone", date: "2026-01-01T00:00:00Z", score: 8, total: 8, answers: {} },
            { context: "course:other", date: "2026-01-02T00:00:00Z", score: 8, total: 8, answers: {} },
            { context: "course:basics", date: "2026-01-03T00:00:00Z", score: 3, total: 8, answers: {} },
          ],
        },
      },
    });
    await screen.findByRole("heading", { level: 1, name: "Welcome" });
    const sidebar = within(document.getElementById("course-toc")!);

    // only a standalone attempt: no badge, no failed mark
    const secQuiz = sidebar.getByText("Section Quiz").closest("a")!;
    expect(secQuiz.querySelector(".toc__score")).toBeNull();
    expect(secQuiz.className).not.toContain("is-failed");

    // best in-course attempt is 3/8 (below 80%), despite 8/8 elsewhere
    const finalQuiz = sidebar.getByText("Final quiz").closest("a")!;
    expect(finalQuiz.querySelector(".toc__score")?.textContent).toBe("3/8");
    expect(finalQuiz.className).toContain("is-failed");
  });

  it("pager and arrow keys", async () => {
    await renderCourse("/courses/basics/02-writing/01-pages", { courses: {}, quizzes: {} });
    await screen.findByRole("heading", { level: 1, name: "Pages" });

    const pager = screen.getByRole("navigation", { name: "Course pages" });
    expect(within(pager).getByText("← Welcome")).toBeTruthy();
    expect(within(pager).getByText("Quizzes →")).toBeTruthy();

    // Under full-suite parallel load, the microtask chain behind this navigation
    // (mocked getPage resolving, React committing, router updating) can take
    // longer than Testing Library's default 1000ms findBy* timeout even though
    // nothing is actually broken. Give these two post-navigation assertions
    // more headroom rather than raising the global default (see #8).
    fireEvent.keyDown(document, { key: "ArrowRight" });
    await screen.findByRole("heading", { level: 1, name: "Quizzes" }, { timeout: 5000 });

    fireEvent.keyDown(document, { key: "ArrowLeft" });
    await screen.findByRole("heading", { level: 1, name: "Pages" }, { timeout: 5000 });
  });

  it("arrow keys ignored in input", async () => {
    await renderCourse("/courses/basics/02-writing/01-pages", { courses: {}, quizzes: {} });
    await screen.findByRole("heading", { level: 1, name: "Pages" });

    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "ArrowRight" });

    // still on the same page
    expect(screen.getByRole("heading", { level: 1, name: "Pages" })).toBeTruthy();
    document.body.removeChild(input);
  });

  it("visiting marks progress", async () => {
    await renderCourse("/courses/basics/01-welcome", { courses: {}, quizzes: {} });
    await screen.findByRole("heading", { level: 1, name: "Welcome" });

    await waitFor(() => expect(putProgress).toHaveBeenCalled());
    const saved = vi.mocked(putProgress).mock.calls.at(-1)![0];
    expect(saved.courses.basics.visited).toContain("01-welcome");
    expect(saved.courses.basics.lastPage).toBe("01-welcome");
  });

  it("neighbors crosses sections and quizzes", () => {
    expect(neighbors(toc, "01-welcome")).toEqual({ prev: null, next: toc[1] });
    expect(neighbors(toc, "02-writing/02-quizzes")).toEqual({ prev: toc[1], next: toc[3] });
    expect(neighbors(toc, "_quiz/sec-quiz")).toEqual({ prev: toc[2], next: toc[4] });
    expect(neighbors(toc, "_quiz/final-quiz")).toEqual({ prev: toc[3], next: null });
    expect(neighbors(toc, "does-not-exist")).toEqual({ prev: null, next: null });
  });

  it("landing page offers Start then Continue once visited", async () => {
    await renderCourse("/courses/basics", { courses: {}, quizzes: {} });
    await screen.findByRole("heading", { level: 1, name: "Basics" });
    const start = screen.getByRole("link", { name: "Start" });
    expect(start.getAttribute("href")).toBe("/courses/basics/01-welcome");
    cleanup();

    await renderCourse("/courses/basics", { courses: { basics: { visited: ["01-welcome"], lastPage: "01-welcome" } }, quizzes: {} });
    await screen.findByRole("heading", { level: 1, name: "Basics" });
    const cont = screen.getByRole("link", { name: "Continue" });
    expect(cont.getAttribute("href")).toBe("/courses/basics/01-welcome");
  });

  it("quiz item runs inline and Continue moves to the next TOC item", async () => {
    await renderCourse("/courses/basics/_quiz/sec-quiz", { courses: {}, quizzes: {} });
    await screen.findByRole("heading", { level: 1, name: "Section Quiz" });
    expect(screen.queryByRole("link", { name: "Open quiz" })).toBeNull();
    // TOC and pager stay visible around the inline quiz.
    expect(document.getElementById("course-toc")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Course pages" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await screen.findByText("Question 1 of 1");
    fireEvent.click(screen.getByRole("radio", { name: "Right" }));
    fireEvent.click(screen.getByRole("button", { name: "Check answer" }));
    fireEvent.click(screen.getByRole("button", { name: "See results" }));

    const continueButton = await screen.findByRole("button", { name: "Continue" });
    fireEvent.click(continueButton);

    await screen.findByRole("heading", { level: 1, name: "Final Exam" });
  });

  it("a course-final quiz offers Back to catalog in its results and pager", async () => {
    await renderCourse("/courses/basics/_quiz/final-quiz", { courses: {}, quizzes: {} });
    await screen.findByRole("heading", { level: 1, name: "Final Exam" });

    const pager = screen.getByRole("navigation", { name: "Course pages" });
    expect(within(pager).getByRole("link", { name: /Back to catalog/ }).getAttribute("href")).toBe("/");

    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await screen.findByText("Question 1 of 1");
    fireEvent.click(screen.getByRole("radio", { name: "Right" }));
    fireEvent.click(screen.getByRole("button", { name: "Check answer" }));
    fireEvent.click(screen.getByRole("button", { name: "See results" }));

    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Back to catalog" }));
    await screen.findByRole("heading", { name: "Courses" }, { timeout: 5000 });
  });

  it("the last page of a page-terminated course links back to the catalog, also via ArrowRight", async () => {
    const pagesOnly: CourseDetail = { ...course, quiz: null, toc: toc.filter((i) => i.type === "page") };
    await renderCourse("/courses/basics/02-writing/02-quizzes", { courses: {}, quizzes: {} }, pagesOnly);
    await screen.findByRole("heading", { level: 1, name: "Quizzes" });

    const pager = screen.getByRole("navigation", { name: "Course pages" });
    expect(within(pager).getByText("← Pages")).toBeTruthy();
    const back = within(pager).getByRole("link", { name: /Back to catalog/ });
    expect(back.getAttribute("href")).toBe("/");
    expect(within(pager).getByText("End of course")).toBeTruthy();

    fireEvent.keyDown(document, { key: "ArrowRight" });
    await screen.findByRole("heading", { name: "Courses" }, { timeout: 5000 });
  });

  it("pages before the end keep the plain next link", async () => {
    await renderCourse("/courses/basics/02-writing/02-quizzes", { courses: {}, quizzes: {} });
    await screen.findByRole("heading", { level: 1, name: "Quizzes" });
    const pager = screen.getByRole("navigation", { name: "Course pages" });
    expect(within(pager).queryByRole("link", { name: /Back to catalog/ })).toBeNull();
    expect(within(pager).getByText("Section Quiz →")).toBeTruthy();
  });

  it("sidebar toggle lives in the sticky header and drives the TOC", async () => {
    await renderCourse("/courses/basics/01-welcome", { courses: {}, quizzes: {} });
    await screen.findByRole("heading", { level: 1, name: "Welcome" });

    const header = document.querySelector("header.app-header") as HTMLElement;
    const toggle = await within(header).findByRole("button", { name: "Collapse table of contents" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.getAttribute("aria-controls")).toBe("course-toc");
    // only one toggle, and not inside the scrolling main column
    expect(screen.getAllByRole("button", { name: /table of contents/ })).toHaveLength(1);
    expect(document.querySelector(".course-main .sidebar-toggle")).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-label")).toBe("Expand table of contents");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector(".course-layout")!.className).toContain("is-collapsed");
    expect(document.getElementById("course-toc")!.className).not.toContain("is-open");

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById("course-toc")!.className).toContain("is-open");
  });

  it("reset progress on the landing is confirm-gated and reverts Continue to Start", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    await renderCourse("/courses/basics", {
      courses: { basics: { visited: ["01-welcome"], lastPage: "01-welcome" } },
      quizzes: {
        "sec-quiz": {
          attempts: [
            { context: "course:basics", date: "2026-01-01T00:00:00Z", score: 1, total: 1, answers: {} },
            { context: "standalone", date: "2026-01-02T00:00:00Z", score: 0, total: 1, answers: {} },
          ],
        },
      },
    });
    await screen.findByRole("heading", { level: 1, name: "Basics" });
    const reset = screen.getByRole("button", { name: /Reset progress/ });

    confirmSpy.mockReturnValueOnce(false);
    fireEvent.click(reset);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy.mock.calls[0][0]).toContain("taken on their own or from another course are kept");
    expect(screen.getByRole("link", { name: "Continue" })).toBeTruthy();
    expect(putProgress).not.toHaveBeenCalled();

    confirmSpy.mockReturnValueOnce(true);
    fireEvent.click(reset);
    expect(await screen.findByRole("link", { name: "Start" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Reset progress/ })).toBeNull();
    // the standalone attempt kept at sec-quiz doesn't count toward the course
    const sidebar = within(document.getElementById("course-toc")!);
    expect(sidebar.getByRole("progressbar", { name: "Basics progress" }).getAttribute("aria-valuenow")).toBe("0");

    await waitFor(() => expect(putProgress).toHaveBeenCalled());
    const saved = vi.mocked(putProgress).mock.calls.at(-1)![0];
    expect(saved.courses.basics).toBeUndefined();
    expect(saved.quizzes["sec-quiz"].attempts).toEqual([
      { context: "standalone", date: "2026-01-02T00:00:00Z", score: 0, total: 1, answers: {} },
    ]);
    confirmSpy.mockRestore();
  });

  it("no reset control on the landing without course progress", async () => {
    await renderCourse("/courses/basics", { courses: {}, quizzes: {} });
    await screen.findByRole("heading", { level: 1, name: "Basics" });
    expect(screen.queryByRole("button", { name: /Reset progress/ })).toBeNull();
  });

  it("unknown page shows Page not found with a link back to the course", async () => {
    await renderCourse("/courses/basics/does-not-exist", { courses: {}, quizzes: {} });
    await screen.findByRole("heading", { name: "Page not found" });
    const back = screen.getByRole("link", { name: /Basics/ });
    expect(back.getAttribute("href")).toBe("/courses/basics");
  });
});
