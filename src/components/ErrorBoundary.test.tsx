// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ErrorBoundary from "./ErrorBoundary";

function Thrower({ fail }: { fail: boolean }) {
  if (fail) throw new Error("sources.map is not a function");
  return <p>All good</p>;
}

describe("ErrorBoundary", () => {
  beforeEach(() => {
    // React logs caught render errors; keep test output clean.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders fallback when a child throws", () => {
    render(
      <MemoryRouter>
        <ErrorBoundary resetKey="/a">
          <Thrower fail />
        </ErrorBoundary>
      </MemoryRouter>,
    );
    expect(screen.getByText("Something went wrong displaying this page.")).toBeTruthy();
    expect(screen.getByText("sources.map is not a function")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to home" }).getAttribute("href")).toBe("/");
  });

  it("resets when the reset key changes", () => {
    const { rerender } = render(
      <MemoryRouter>
        <ErrorBoundary resetKey="/a">
          <Thrower fail />
        </ErrorBoundary>
      </MemoryRouter>,
    );
    expect(screen.getByText("Something went wrong displaying this page.")).toBeTruthy();
    rerender(
      <MemoryRouter>
        <ErrorBoundary resetKey="/b">
          <Thrower fail={false} />
        </ErrorBoundary>
      </MemoryRouter>,
    );
    expect(screen.getByText("All good")).toBeTruthy();
    expect(screen.queryByText("Something went wrong displaying this page.")).toBeNull();
  });
});
