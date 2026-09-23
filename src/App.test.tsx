// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

vi.mock("./api", () => ({
  getCatalog: vi.fn(),
  getProgress: vi.fn(),
  putProgress: vi.fn(),
}));

import { getCatalog, getProgress } from "./api";

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
  });

  it("renders title", async () => {
    renderAt("/");
    const brand = await screen.findByRole("link", { name: /TeachMe/ });
    expect(brand.textContent).toBe("TeachMe · acme");
  });

  it("routes course URLs", async () => {
    renderAt("/courses/basics/01-welcome");
    expect(await screen.findByRole("heading", { name: "basics" })).toBeTruthy();
  });

  it("shows page not found for unknown routes", async () => {
    renderAt("/nope");
    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to home" }).getAttribute("href")).toBe("/");
  });
});
