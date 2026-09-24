// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CourseDetail, PageDetail } from "../shared/types";
import App from "./App";

vi.mock("./api", () => ({
  getCatalog: vi.fn(),
  getCourse: vi.fn(),
  getPage: vi.fn(),
  getQuiz: vi.fn(),
  getProgress: vi.fn(),
  putProgress: vi.fn(),
}));

import { getCatalog, getCourse, getPage, getProgress, getQuiz, putProgress } from "./api";

const course: CourseDetail = {
  slug: "basics",
  title: "Basics",
  description: "",
  duration: null,
  quiz: null,
  intro: "Intro.",
  toc: [{ type: "page", path: "01-welcome", title: "Welcome", section: null }],
};

const page: PageDetail = { path: "01-welcome", title: "Welcome", body: "Welcome body.", sources: [], file: "courses/basics/01-welcome.md" };

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe("App", () => {
  beforeEach(() => {
    vi.mocked(getCatalog).mockResolvedValue({ project: "acme", repoRoot: "/r", courses: [], quizzes: [], errors: [], warnings: [] });
    vi.mocked(getProgress).mockResolvedValue({ courses: {}, quizzes: {} });
    vi.mocked(getCourse).mockResolvedValue(course);
    vi.mocked(getPage).mockResolvedValue(page);
    vi.mocked(putProgress).mockResolvedValue(undefined);
  });

  it("renders title", async () => {
    renderAt("/");
    const brand = await screen.findByRole("link", { name: /TeachMe/ });
    expect(brand.textContent).toBe("TeachMe · acme");
  });

  it("routes course URLs", async () => {
    renderAt("/courses/basics/01-welcome");
    expect(await screen.findByRole("heading", { level: 1, name: "Welcome" })).toBeTruthy();
  });

  it("keeps the header when a page fails to render", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getPage).mockResolvedValue({ ...page, sources: "src/app.ts" as unknown as string[] });
    renderAt("/courses/basics/01-welcome");
    expect(await screen.findByText("Something went wrong displaying this page.")).toBeTruthy();
    expect(screen.getByRole("link", { name: /TeachMe/ }).textContent).toBe("TeachMe · acme");
    vi.mocked(console.error).mockRestore();
  });

  it("header shows the TOC toggle only on course routes", async () => {
    vi.mocked(getQuiz).mockResolvedValue({
      slug: "q",
      title: "Standalone quiz",
      description: "",
      passingScore: 50,
      course: null,
      intro: "Quiz intro.",
      questions: [],
    });
    const toggleName = /table of contents/;

    renderAt("/");
    await screen.findByRole("heading", { name: "Courses" });
    expect(screen.queryByRole("button", { name: toggleName })).toBeNull();
    cleanup();

    renderAt("/quizzes/q");
    await screen.findByRole("heading", { level: 1, name: "Standalone quiz" });
    expect(screen.queryByRole("button", { name: toggleName })).toBeNull();
    cleanup();

    renderAt("/courses/basics/01-welcome");
    await screen.findByRole("heading", { level: 1, name: "Welcome" });
    const header = document.querySelector("header.app-header") as HTMLElement;
    expect((await within(header).findByRole("button", { name: toggleName })).getAttribute("aria-controls")).toBe("course-toc");
  });

  it("header drops the TOC toggle when leaving a course", async () => {
    renderAt("/courses/basics/01-welcome");
    await screen.findByRole("heading", { level: 1, name: "Welcome" });
    expect(await screen.findByRole("button", { name: /table of contents/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: /TeachMe/ }));
    await screen.findByRole("heading", { name: "Courses" });
    expect(screen.queryByRole("button", { name: /table of contents/ })).toBeNull();
  });

  it("shows page not found for unknown routes", async () => {
    renderAt("/nope");
    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to home" }).getAttribute("href")).toBe("/");
  });
});
