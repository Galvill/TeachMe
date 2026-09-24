import { describe, expect, it } from "vitest";
import {
  changesSince,
  headCommit,
  isGitRepo,
  UnknownCommitError,
} from "./git.js";
import { makeRepo } from "../test/gitRepo.js";
import { writeTree } from "../test/helpers.js";

describe("isGitRepo", () => {
  it("true for a git repo", () => {
    const repo = makeRepo({ "a.md": "a\n" });
    expect(isGitRepo(repo.dir)).toBe(true);
  });

  it("false for a non-git directory", () => {
    const dir = writeTree({ "a.md": "a\n" });
    expect(isGitRepo(dir)).toBe(false);
  });
});

describe("headCommit", () => {
  it("returns the short sha of HEAD", () => {
    const repo = makeRepo({ "a.md": "a\n" });
    const sha = repo.commit({ "a.md": "a\nb\n" }, "edit a");
    expect(headCommit(repo.dir)).toBe(sha);
  });
});

describe("changesSince", () => {
  it("modified file lists commits", () => {
    const repo = makeRepo({ "a.md": "a\n" });
    const base = headCommit(repo.dir);
    const c1 = repo.commit({ "a.md": "a\nb\n" }, "edit a once");
    const c2 = repo.commit({ "a.md": "a\nb\nc\n" }, "edit a twice");

    const changes = changesSince(repo.dir, base);

    expect(changes).toEqual([
      {
        path: "a.md",
        status: "modified",
        newPath: null,
        commits: [
          { sha: c2, subject: "edit a twice" },
          { sha: c1, subject: "edit a once" },
        ],
      },
    ]);
  });

  it("rename then edit", () => {
    const repo = makeRepo({ "a.md": "a\n" });
    const base = headCommit(repo.dir);
    const c1 = repo.commit({ "a.md": null, "b.md": "a\n" }, "rename a to b");
    const c2 = repo.commit({ "b.md": "a\nmore\n" }, "edit b");

    const changes = changesSince(repo.dir, base);

    expect(changes).toEqual([
      {
        path: "a.md",
        status: "renamed",
        newPath: "b.md",
        commits: [
          { sha: c2, subject: "edit b" },
          { sha: c1, subject: "rename a to b" },
        ],
      },
    ]);
  });

  it("deleted file", () => {
    const repo = makeRepo({ "a.md": "a\n" });
    const base = headCommit(repo.dir);
    const c1 = repo.commit({ "a.md": null }, "delete a");

    const changes = changesSince(repo.dir, base);

    expect(changes).toEqual([
      {
        path: "a.md",
        status: "deleted",
        newPath: null,
        commits: [{ sha: c1, subject: "delete a" }],
      },
    ]);
  });

  it("delete then re-add is modified", () => {
    const repo = makeRepo({ "a.md": "a\n" });
    const base = headCommit(repo.dir);
    const c1 = repo.commit({ "a.md": null }, "delete a");
    const c2 = repo.commit({ "a.md": "a\nagain\n" }, "re-add a");

    const changes = changesSince(repo.dir, base);

    expect(changes).toEqual([
      {
        path: "a.md",
        status: "modified",
        newPath: null,
        commits: [
          { sha: c2, subject: "re-add a" },
          { sha: c1, subject: "delete a" },
        ],
      },
    ]);
  });

  it("added then deleted omitted", () => {
    const repo = makeRepo({ "keep.md": "keep\n" });
    const base = headCommit(repo.dir);
    repo.commit({ "new.md": "new\n" }, "add new");
    repo.commit({ "new.md": null }, "delete new");

    const changes = changesSince(repo.dir, base);

    expect(changes).toEqual([]);
  });

  it("unknown commit throws", () => {
    const repo = makeRepo({ "a.md": "a\n" });

    expect(() => changesSince(repo.dir, "deadbeef")).toThrow(
      UnknownCommitError,
    );
    try {
      changesSince(repo.dir, "deadbeef");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(UnknownCommitError);
      expect(/** @type {UnknownCommitError} */ (err).commit).toBe("deadbeef");
      expect(/** @type {Error} */ (err).message).toBe("Unknown commit deadbeef");
    }
  });

  it("head is empty", () => {
    const repo = makeRepo({ "a.md": "a\n" });
    repo.commit({ "a.md": "a\nb\n" }, "edit a");

    expect(changesSince(repo.dir, headCommit(repo.dir))).toEqual([]);
  });
});
