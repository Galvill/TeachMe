import { describe, expect, it } from "vitest";
import type { Attempt, CourseSummary, ProjectProgress, TocItem } from "../shared/types";
import {
  addAttempt,
  bestAttempt,
  coursePercent,
  isCorrect,
  markVisited,
  summaryPercent,
} from "./progress";

const emptyProgress: ProjectProgress = { courses: {}, quizzes: {} };

describe("markVisited", () => {
  it("is idempotent", () => {
    const once = markVisited(emptyProgress, "intro", "p1");
    const twice = markVisited(once, "intro", "p1");
    expect(twice.courses.intro.visited).toEqual(["p1"]);
    expect(twice.courses.intro.lastPage).toBe("p1");
    // inputs never mutated
    expect(emptyProgress.courses).toEqual({});
    expect(once.courses.intro.visited).toEqual(["p1"]);
  });

  it("adds a second page and updates lastPage", () => {
    const once = markVisited(emptyProgress, "intro", "p1");
    const twice = markVisited(once, "intro", "p2");
    expect(twice.courses.intro.visited).toEqual(["p1", "p2"]);
    expect(twice.courses.intro.lastPage).toBe("p2");
  });
});

describe("addAttempt", () => {
  it("appends an attempt without mutating input", () => {
    const attempt: Attempt = {
      context: "standalone",
      date: "2026-01-01T00:00:00Z",
      score: 1,
      total: 2,
      answers: {},
    };
    const next = addAttempt(emptyProgress, "quiz-1", attempt);
    expect(next.quizzes["quiz-1"].attempts).toEqual([attempt]);
    expect(emptyProgress.quizzes).toEqual({});
  });
});

describe("coursePercent", () => {
  it("counts quizzes", () => {
    const toc: TocItem[] = [
      { type: "page", path: "p1", title: "P1", section: null },
      { type: "page", path: "p2", title: "P2", section: null },
      { type: "quiz", path: "q1", title: "Q1", section: null, quizSlug: "quiz-1" },
    ];
    const p: ProjectProgress = {
      courses: { intro: { visited: ["p1"], lastPage: "p1" } },
      quizzes: {
        "quiz-1": {
          attempts: [{ context: "course:intro", date: "2026-01-01", score: 1, total: 1, answers: {} }],
        },
      },
    };
    // visited p1 + attempted quiz-1 = 2 of 3 => round(66.67) = 67
    expect(coursePercent(toc, p, "intro")).toBe(67);
  });

  it("empty toc returns 0", () => {
    expect(coursePercent([], emptyProgress, "intro")).toBe(0);
  });
});

describe("bestAttempt", () => {
  it("tie goes to latest", () => {
    const a1: Attempt = { context: "standalone", date: "2026-01-01T00:00:00Z", score: 2, total: 4, answers: {} };
    const a2: Attempt = { context: "standalone", date: "2026-01-02T00:00:00Z", score: 1, total: 2, answers: {} };
    const p: ProjectProgress = { courses: {}, quizzes: { q: { attempts: [a1, a2] } } };
    expect(bestAttempt(p, "q")).toBe(a2);
  });

  it("picks the highest score/total ratio", () => {
    const low: Attempt = { context: "standalone", date: "2026-01-01T00:00:00Z", score: 1, total: 4, answers: {} };
    const high: Attempt = { context: "standalone", date: "2026-01-02T00:00:00Z", score: 3, total: 4, answers: {} };
    const p: ProjectProgress = { courses: {}, quizzes: { q: { attempts: [high, low] } } };
    expect(bestAttempt(p, "q")).toBe(high);
  });

  it("returns null when no attempts", () => {
    expect(bestAttempt(emptyProgress, "q")).toBeNull();
  });
});

describe("isCorrect", () => {
  it("multi requires exact set", () => {
    expect(isCorrect([true, false, true], [0, 2])).toBe(true);
    expect(isCorrect([true, false, true], [2, 0])).toBe(true);
    expect(isCorrect([true, false, true], [0])).toBe(false);
    expect(isCorrect([true, false, true], [0, 1, 2])).toBe(false);
    expect(isCorrect([false, false, false], [])).toBe(true);
  });
});

describe("summaryPercent", () => {
  it("caps at 100", () => {
    const s: CourseSummary = {
      slug: "intro",
      title: "Intro",
      description: "",
      duration: null,
      pageCount: 1,
      quizzes: ["quiz-1"],
    };
    const p: ProjectProgress = {
      courses: { intro: { visited: ["p1", "p2"], lastPage: "p2" } },
      quizzes: {
        "quiz-1": {
          attempts: [{ context: "course:intro", date: "2026-01-01", score: 1, total: 1, answers: {} }],
        },
      },
    };
    expect(summaryPercent(s, p)).toBe(100);
  });

  it("is 0 when the denominator is 0", () => {
    const s: CourseSummary = { slug: "empty", title: "Empty", description: "", duration: null, pageCount: 0, quizzes: [] };
    expect(summaryPercent(s, emptyProgress)).toBe(0);
  });
});
