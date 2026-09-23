import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createProgressStore, isProjectProgress } from "./progress.js";

/**
 * @returns {string}
 */
function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "teachme-progress-"));
}

describe("createProgressStore", () => {
  it("roundtrip", () => {
    const dir = tmpDir();
    const store = createProgressStore({ dir });

    expect(store.get("/repo/.teachme")).toEqual({ courses: {}, quizzes: {} });

    /** @type {import('../shared/types.js').ProjectProgress} */
    const progress = {
      courses: { arch: { visited: ["intro"], lastPage: "intro" } },
      quizzes: { basics: { attempts: [] } },
    };
    store.put("/repo/.teachme", progress);

    expect(store.get("/repo/.teachme")).toEqual(progress);

    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, "progress.json"), "utf8"));
    expect(onDisk).toEqual({ version: 1, projects: { "/repo/.teachme": progress } });
  });

  it("keeps other projects", () => {
    const dir = tmpDir();
    const store = createProgressStore({ dir });

    /** @type {import('../shared/types.js').ProjectProgress} */
    const progressA = { courses: { a: { visited: [], lastPage: null } }, quizzes: {} };
    /** @type {import('../shared/types.js').ProjectProgress} */
    const progressB = { courses: { b: { visited: [], lastPage: null } }, quizzes: {} };

    store.put("/repo-a/.teachme", progressA);
    store.put("/repo-b/.teachme", progressB);

    expect(store.get("/repo-a/.teachme")).toEqual(progressA);
    expect(store.get("/repo-b/.teachme")).toEqual(progressB);
  });

  it("corrupt file backed up", () => {
    const dir = tmpDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "progress.json"), "{not valid json");

    const store = createProgressStore({ dir });

    expect(store.get("/repo/.teachme")).toEqual({ courses: {}, quizzes: {} });
    expect(fs.readFileSync(path.join(dir, "progress.json.bak"), "utf8")).toBe("{not valid json");
    expect(fs.existsSync(path.join(dir, "progress.json"))).toBe(false);
  });
});

describe("isProjectProgress", () => {
  it("accepts a well-shaped ProjectProgress", () => {
    expect(isProjectProgress({ courses: {}, quizzes: {} })).toBe(true);
  });

  it("rejects missing courses", () => {
    expect(isProjectProgress({ quizzes: {} })).toBe(false);
  });

  it("rejects missing quizzes", () => {
    expect(isProjectProgress({ courses: {} })).toBe(false);
  });

  it("rejects null, arrays, and non-objects", () => {
    expect(isProjectProgress(null)).toBe(false);
    expect(isProjectProgress([])).toBe(false);
    expect(isProjectProgress("nope")).toBe(false);
    expect(isProjectProgress({ courses: [], quizzes: {} })).toBe(false);
    expect(isProjectProgress({ courses: {}, quizzes: [] })).toBe(false);
    expect(isProjectProgress({ courses: null, quizzes: {} })).toBe(false);
  });
});
