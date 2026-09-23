// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProgressProvider, useProgress } from "./ProgressProvider";

vi.mock("./api", () => ({
  getProgress: vi.fn(),
  putProgress: vi.fn(),
}));

import { getProgress, putProgress } from "./api";

function TestConsumer() {
  const { progress, update, saveError } = useProgress();
  return (
    <div>
      <button
        type="button"
        onClick={() =>
          update((p) => ({
            ...p,
            courses: { ...p.courses, intro: { visited: ["p1"], lastPage: "p1" } },
          }))
        }
      >
        visit
      </button>
      <span data-testid="visited-count">
        {Object.keys(progress.courses).length}
      </span>
      {saveError && <span data-testid="save-error">{saveError}</span>}
    </div>
  );
}

describe("ProgressProvider", () => {
  beforeEach(() => {
    vi.mocked(getProgress).mockReset();
    vi.mocked(putProgress).mockReset();
  });

  it("failed save shows toast", async () => {
    vi.mocked(getProgress).mockResolvedValue({ courses: {}, quizzes: {} });
    vi.mocked(putProgress).mockRejectedValue(new Error("network down"));

    render(
      <ProgressProvider>
        <TestConsumer />
      </ProgressProvider>,
    );

    const button = await screen.findByText("visit");
    await act(async () => {
      fireEvent.click(button);
      // let the rejected putProgress promise settle
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("save-error").textContent).toBe("Progress could not be saved");
  });

  it("applies the update locally even when the save fails", async () => {
    vi.mocked(getProgress).mockResolvedValue({ courses: {}, quizzes: {} });
    vi.mocked(putProgress).mockRejectedValue(new Error("network down"));

    render(
      <ProgressProvider>
        <TestConsumer />
      </ProgressProvider>,
    );

    const button = await screen.findByText("visit");
    await act(async () => {
      fireEvent.click(button);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("visited-count").textContent).toBe("1");
  });

  it("starts from an empty progress object and shows a toast when the initial load fails", async () => {
    vi.mocked(getProgress).mockRejectedValue(new Error("boom"));

    render(
      <ProgressProvider>
        <TestConsumer />
      </ProgressProvider>,
    );

    expect(await screen.findByText("Progress could not be loaded")).toBeTruthy();
    expect(screen.getByTestId("visited-count").textContent).toBe("0");
  });

  it("clears the save error after a later successful save", async () => {
    vi.mocked(getProgress).mockResolvedValue({ courses: {}, quizzes: {} });
    vi.mocked(putProgress).mockRejectedValueOnce(new Error("network down")).mockResolvedValueOnce(undefined);

    render(
      <ProgressProvider>
        <TestConsumer />
      </ProgressProvider>,
    );

    const button = await screen.findByText("visit");
    await act(async () => {
      fireEvent.click(button);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId("save-error").textContent).toBe("Progress could not be saved");

    await act(async () => {
      fireEvent.click(button);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByTestId("save-error")).toBeNull();
  });
});
