// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CourseDetail, PageDetail } from "../shared/types";
import App from "./App";

vi.mock("./api", () => ({
  getCatalog: vi.fn(),
  getCourse: vi.fn(),
  getPage: vi.fn(),
  getProgress: vi.fn(),
  putProgress: vi.fn(),
}));

import { getCatalog, getCourse, getPage, getProgress, putProgress } from "./api";

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

  it("shows page not found for unknown routes", async () => {
    renderAt("/nope");
    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to home" }).getAttribute("href")).toBe("/");
  });
});
