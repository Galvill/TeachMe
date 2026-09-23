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

let nextId = 0;

function SeqConsumer() {
  const { update } = useProgress();
  return (
    <button
      type="button"
      onClick={() => {
        nextId += 1;
        const id = `c${nextId}`;
        update((p) => ({ ...p, courses: { ...p.courses, [id]: { visited: [], lastPage: null } } }));
      }}
    >
      add
    </button>
  );
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
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

  it("serializes saves so only one is in flight and the last write wins", async () => {
    nextId = 0;
    vi.mocked(getProgress).mockResolvedValue({ courses: {}, quizzes: {} });
    const first = deferred();
    const second = deferred();
    vi.mocked(putProgress).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    render(
      <ProgressProvider>
        <SeqConsumer />
      </ProgressProvider>,
    );

    const button = await screen.findByText("add");
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
      fireEvent.click(button);
    });

    expect(putProgress).toHaveBeenCalledTimes(1);
    expect(Object.keys(vi.mocked(putProgress).mock.calls[0][0].courses)).toEqual(["c1"]);

    await act(async () => {
      first.resolve();
    });

    expect(putProgress).toHaveBeenCalledTimes(2);
    expect(Object.keys(vi.mocked(putProgress).mock.calls[1][0].courses)).toEqual(["c1", "c2", "c3"]);

    await act(async () => {
      second.resolve();
    });
    expect(putProgress).toHaveBeenCalledTimes(2);
  });

  it("does not save after the initial load fails", async () => {
    vi.mocked(getProgress).mockRejectedValue(new Error("boom"));
    vi.mocked(putProgress).mockResolvedValue(undefined);

    render(
      <ProgressProvider>
        <TestConsumer />
      </ProgressProvider>,
    );

    const button = await screen.findByText("visit");
    await act(async () => {
      fireEvent.click(button);
      await Promise.resolve();
    });

    expect(putProgress).not.toHaveBeenCalled();
    expect(screen.getByTestId("visited-count").textContent).toBe("1");
    expect(screen.getByText("Progress could not be loaded")).toBeTruthy();
  });
});
