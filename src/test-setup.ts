import { afterEach } from "vitest";

// jsdom-only setup. Node >= 22 ships its own `localStorage` global, which
// shadows jsdom's and warns when touched without `--localstorage-file`, so
// jsdom tests get a fresh in-memory Storage instead.
if (typeof document !== "undefined") {
  const { cleanup } = await import("@testing-library/react");

  class MemoryStorage implements Storage {
    private items = new Map<string, string>();
    get length() {
      return this.items.size;
    }
    clear() {
      this.items.clear();
    }
    getItem(key: string) {
      return this.items.get(key) ?? null;
    }
    key(index: number) {
      return [...this.items.keys()][index] ?? null;
    }
    removeItem(key: string) {
      this.items.delete(key);
    }
    setItem(key: string, value: string) {
      this.items.set(key, String(value));
    }
  }

  Object.defineProperty(globalThis, "localStorage", { value: new MemoryStorage(), configurable: true, writable: true });

  afterEach(() => {
    cleanup();
  });
}
