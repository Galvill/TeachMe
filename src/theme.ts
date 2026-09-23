import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "teachme-theme";

let current: Theme | null = null;
const listeners = new Set<() => void>();

function readStored(): Theme | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

function writeStored(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // storage unavailable (private mode, blocked): the choice lasts for this session only
  }
}

function osTheme(): Theme {
  if (typeof matchMedia !== "function") return "dark";
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function apply(theme: Theme): void {
  current = theme;
  document.documentElement.dataset.theme = theme;
  for (const l of listeners) l();
}

/**
 * Resolve the theme (stored choice, else OS preference, else dark) and apply
 * it to `<html data-theme>`. Call before the first render to avoid a flash.
 */
export function initTheme(): Theme {
  apply(readStored() ?? osTheme());
  return current as Theme;
}

export function getTheme(): Theme {
  return current ?? initTheme();
}

/** Flip the theme, apply it and remember the choice. */
export function toggleTheme(): Theme {
  const next: Theme = getTheme() === "dark" ? "light" : "dark";
  writeStored(next);
  apply(next);
  return next;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Current theme plus a toggle. Backed by a module-level store, so every
 * component using it (header toggle, Shiki, Mermaid) re-renders on change.
 */
export function useTheme(): { theme: Theme; toggle(): void } {
  const theme = useSyncExternalStore(subscribe, getTheme, getTheme);
  return { theme, toggle: toggleTheme };
}
