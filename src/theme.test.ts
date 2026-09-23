// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initTheme, toggleTheme } from "./theme";

function mockMatchMedia(prefersDark: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query === "(prefers-color-scheme: dark)" ? prefersDark : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

describe("theme", () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("theme falls back to OS preference", () => {
    mockMatchMedia(false);
    expect(initTheme()).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");

    mockMatchMedia(true);
    expect(initTheme()).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("a stored choice wins over the OS preference", () => {
    mockMatchMedia(true);
    localStorage.setItem("teachme-theme", "light");
    expect(initTheme()).toBe("light");
  });

  it("ignores an invalid stored value", () => {
    mockMatchMedia(false);
    localStorage.setItem("teachme-theme", "purple");
    expect(initTheme()).toBe("light");
  });

  it("defaults to dark when matchMedia is unavailable", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(initTheme()).toBe("dark");
  });

  it("toggle flips the theme, applies it and stores it", () => {
    mockMatchMedia(true);
    initTheme();
    expect(toggleTheme()).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("teachme-theme")).toBe("light");
  });

  it("survives storage that throws", () => {
    mockMatchMedia(false);
    const denied = () => {
      throw new Error("denied");
    };
    vi.stubGlobal("localStorage", { getItem: denied, setItem: denied });
    expect(initTheme()).toBe("light");
    expect(toggleTheme()).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
