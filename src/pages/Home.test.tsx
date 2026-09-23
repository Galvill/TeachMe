// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Catalog, ProjectProgress } from "../../shared/types";
import App from "../App";
import ErrorBanner from "../components/ErrorBanner";

vi.mock("../api", () => ({
  getCatalog: vi.fn(),
  getProgress: vi.fn(),
  putProgress: vi.fn(),
}));

import { getCatalog, getProgress } from "../api";

const catalog: Catalog = {
  project: "acme",
  repoRoot: "/repo/acme",
  courses: [
    { slug: "basics", title: "Basics", description: "Start here.", duration: "20 min", pageCount: 3, quizzes: ["basics-final"] },
    { slug: "deep-dive", title: "Deep dive", description: "Internals.", duration: null, pageCount: 1, quizzes: [] },
  ],
  quizzes: [
    { slug: "basics-final", title: "Basics final", description: "", questionCount: 4, passingScore: 75 },
    { slug: "untried", title: "Untried quiz", description: "", questionCount: 1, passingScore: 50 },
  ],
  errors: [],
  warnings: [],
};

async function renderHome(progress: ProjectProgress) {
  vi.mocked(getCatalog).mockResolvedValue(catalog);
  vi.mocked(getProgress).mockResolvedValue(progress);
  render(
    <MemoryRouter initialEntries={["/"]}>
      <App />
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { name: "Courses" });
}

describe("Home", () => {
  beforeEach(() => {
    vi.mocked(getCatalog).mockReset();
    vi.mocked(getProgress).mockReset();
  });

  it("home lists courses and quizzes", async () => {
    await renderHome({
      courses: {},
      quizzes: {
        "basics-final": {
          attempts: [
            { context: "standalone", date: "2026-01-01T00:00:00Z", score: 2, total: 4, answers: {} },
            { context: "standalone", date: "2026-01-02T00:00:00Z", score: 3, total: 4, answers: {} },
          ],
        },
      },
    });

    expect(screen.getByRole("link", { name: /TeachMe · acme/ }).getAttribute("href")).toBe("/");

    const basics = screen.getByRole("article", { name: "Basics" });
    expect(within(basics).getByText("Start here.")).toBeTruthy();
    expect(within(basics).getByText("3 lessons · 20 min")).toBeTruthy();
    // 1 attempted quiz of 4 items = 25%
    expect(within(basics).getByRole("progressbar").getAttribute("aria-valuenow")).toBe("25");
    const deep = screen.getByRole("article", { name: "Deep dive" });
    expect(within(deep).getByText("1 lesson")).toBeTruthy();
    const start = within(deep).getByRole("link", { name: "Start" });
    expect(start.getAttribute("href")).toBe("/courses/deep-dive");

    const quizRow = screen.getByRole("link", { name: /Basics final/ });
    expect(quizRow.getAttribute("href")).toBe("/quizzes/basics-final");
    expect(within(quizRow).getByText("4 questions")).toBeTruthy();
    expect(within(quizRow).getByText("3/4 ✓")).toBeTruthy();
    const untried = screen.getByRole("link", { name: /Untried quiz/ });
    expect(within(untried).getByText("1 question")).toBeTruthy();
    expect(within(untried).queryByText(/\d+\/\d+/)).toBeNull();
  });

  it("continue links to lastPage", async () => {
    await renderHome({
      courses: { basics: { visited: ["01-welcome", "02-writing/01-pages"], lastPage: "02-writing/01-pages" } },
      quizzes: {
        "basics-final": {
          attempts: [{ context: "standalone", date: "2026-01-01T00:00:00Z", score: 1, total: 4, answers: {} }],
        },
      },
    });

    const basics = screen.getByRole("article", { name: "Basics" });
    const cont = within(basics).getByRole("link", { name: "Continue" });
    expect(cont.getAttribute("href")).toBe("/courses/basics/02-writing/01-pages");
    expect(within(basics).queryByRole("link", { name: "Start" })).toBeNull();
    // failed best attempt: score shown without the pass mark
    const quizRow = screen.getByRole("link", { name: /Basics final/ });
    expect(within(quizRow).getByText("1/4")).toBeTruthy();
  });

  it("shows a message when the catalog cannot be loaded", async () => {
    vi.mocked(getCatalog).mockRejectedValue(new Error("offline"));
    vi.mocked(getProgress).mockResolvedValue({ courses: {}, quizzes: {} });
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByText("Could not load content: offline")).toBeTruthy();
  });

  it("banner shows errors and dismisses", () => {
    render(
      <ErrorBanner
        errors={[{ file: "courses/a/course.md", message: "missing title" }]}
        warnings={[{ file: "quizzes/q/quiz.md", message: "no questions" }]}
      />,
    );
    const banner = screen.getByRole("alert");
    expect(within(banner).getByText(/ERROR/).closest("li")?.textContent).toContain("courses/a/course.md: missing title");
    expect(within(banner).getByText(/WARN/).closest("li")?.textContent).toContain("quizzes/q/quiz.md: no questions");

    act(() => {
      fireEvent.click(within(banner).getByRole("button", { name: "Dismiss" }));
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("banner is hidden when there are no issues", () => {
    const { container } = render(<ErrorBanner errors={[]} warnings={[]} />);
    expect(container.innerHTML).toBe("");
  });
});
