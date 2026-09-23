import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { ProjectProgress } from "../shared/types";
import { getProgress, putProgress } from "./api";

const EMPTY_PROGRESS: ProjectProgress = { courses: {}, quizzes: {} };

const LOAD_ERROR_MESSAGE = "Progress could not be loaded";
const SAVE_ERROR_MESSAGE = "Progress could not be saved";

type ProgressContextValue = {
  progress: ProjectProgress;
  update(fn: (p: ProjectProgress) => ProjectProgress): void;
  saveError: string | null;
};

const ProgressContext = createContext<ProgressContextValue | null>(null);

function Toast({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  return (
    <div role="status" className="toast">
      <span>{message}</span>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss">
          &times;
        </button>
      )}
    </div>
  );
}

export function ProgressProvider({ children }: { children: ReactNode }) {
  const [progress, setProgress] = useState<ProjectProgress | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Latest state, readable outside React's updater so saves never run inside it.
  const latestRef = useRef<ProjectProgress | null>(null);
  // Saving is off until the initial load succeeds, so a failed load never
  // overwrites stored progress with an empty-based object.
  const canSaveRef = useRef(false);
  const inFlightRef = useRef(false);
  const dirtyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    getProgress()
      .then((p) => {
        if (cancelled) return;
        latestRef.current = p;
        canSaveRef.current = true;
        setProgress(p);
      })
      .catch(() => {
        if (cancelled) return;
        latestRef.current = EMPTY_PROGRESS;
        setProgress(EMPTY_PROGRESS);
        setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Send the latest state, one PUT at a time; changes made meanwhile are sent after it. */
  const flush = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    while (dirtyRef.current) {
      dirtyRef.current = false;
      try {
        await putProgress(latestRef.current ?? EMPTY_PROGRESS);
        setSaveError(null);
      } catch {
        setSaveError(SAVE_ERROR_MESSAGE);
      }
    }
    inFlightRef.current = false;
  }, []);

  const update = useCallback(
    (fn: (p: ProjectProgress) => ProjectProgress) => {
      const next = fn(latestRef.current ?? EMPTY_PROGRESS);
      latestRef.current = next;
      setProgress(next);
      if (!canSaveRef.current) return;
      dirtyRef.current = true;
      void flush();
    },
    [flush],
  );

  if (progress === null) {
    return <div role="status">Loading…</div>;
  }

  return (
    <ProgressContext.Provider value={{ progress, update, saveError }}>
      {children}
      {loadError && <Toast message={LOAD_ERROR_MESSAGE} onDismiss={() => setLoadError(false)} />}
      {saveError && <Toast message={saveError} onDismiss={() => setSaveError(null)} />}
    </ProgressContext.Provider>
  );
}

export function useProgress(): ProgressContextValue {
  const ctx = useContext(ProgressContext);
  if (!ctx) {
    throw new Error("useProgress must be used within a ProgressProvider");
  }
  return ctx;
}
