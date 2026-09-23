import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
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

  useEffect(() => {
    let cancelled = false;
    getProgress()
      .then((p) => {
        if (cancelled) return;
        setProgress(p);
      })
      .catch(() => {
        if (cancelled) return;
        setProgress(EMPTY_PROGRESS);
        setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const update = useCallback((fn: (p: ProjectProgress) => ProjectProgress) => {
    setProgress((current) => {
      const next = fn(current ?? EMPTY_PROGRESS);
      putProgress(next)
        .then(() => setSaveError(null))
        .catch(() => setSaveError(SAVE_ERROR_MESSAGE));
      return next;
    });
  }, []);

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
