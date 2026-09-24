import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadContent } from "./content.js";
import { headCommit } from "./git.js";
import { buildStatus, formatStatus } from "./status.js";
import { makeRepo } from "../test/gitRepo.js";

/**
 * @param {{ dir: string }} repo
 * @returns {{ content: import('../shared/types.js').Content; contentDir: string }}
 */
function load(repo) {
  const contentDir = path.join(repo.dir, ".teachme");
  const content = loadContent(contentDir, { repoRoot: repo.dir });
  return { content, contentDir };
}

/**
 * @param {import('../shared/types.js').StatusReport} report
 * @param {string} slug
 * @returns {import('../shared/types.js').StatusItem}
 */
function findItem(report, slug) {
  const item = report.items.find((i) => i.slug === slug);
  if (!item) throw new Error(`no status item for slug "${slug}"`);
  return item;
}

describe("buildStatus", () => {
  it("stale page after source edit", () => {
    const repo = makeRepo({ "src/util.js": "export const util = 1;\n" });
    const base = headCommit(repo.dir);
    repo.commit(
      {
        ".teachme/courses/arch/course.md": `---\ntitle: Architecture\nsyncedCommit: ${base}\n---\nIntro.\n`,
        ".teachme/courses/arch/01-setup.md":
          "---\ntitle: Setup\nsources:\n  - src/util.js\n---\nBody.\n",
      },
      "add course",
    );
    const editSha = repo.commit({ "src/util.js": "export const util = 2;\n" }, "edit util");

    const { content, contentDir } = load(repo);
    const report = buildStatus(content, { contentDir, repoRoot: repo.dir });

    const course = findItem(report, "arch");
    expect(course.state).toBe("stale");
    expect(course.stale).toEqual([
      {
        file: "courses/arch/01-setup.md",
        title: "Setup",
        sources: [{ path: "src/util.js", commits: [{ sha: editSha, subject: "edit util" }] }],
      },
    ]);
    expect(course.broken).toEqual([]);
    expect(course.uncovered).toEqual([]);
  });

  it("renamed source is broken with newPath", () => {
    const repo = makeRepo({ "src/util.js": "export const util = 1;\n" });
    const base = headCommit(repo.dir);
    repo.commit(
      {
        ".teachme/courses/arch/course.md": `---\ntitle: Architecture\nsyncedCommit: ${base}\n---\nIntro.\n`,
        ".teachme/courses/arch/01-setup.md":
          "---\ntitle: Setup\nsources:\n  - src/util.js\n---\nBody.\n",
      },
      "add course",
    );
    const renameSha = repo.commit(
      { "src/util.js": null, "src/helpers.js": "export const util = 1;\n" },
      "rename util to helpers",
    );

    const { content, contentDir } = load(repo);
    const report = buildStatus(content, { contentDir, repoRoot: repo.dir });

    const course = findItem(report, "arch");
    expect(course.broken).toEqual([
      {
        file: "courses/arch/01-setup.md",
        source: "src/util.js",
        status: "renamed",
        newPath: "src/helpers.js",
      },
    ]);
    expect(course.stale).toEqual([
      {
        file: "courses/arch/01-setup.md",
        title: "Setup",
        sources: [
          { path: "src/util.js", commits: [{ sha: renameSha, subject: "rename util to helpers" }] },
        ],
      },
    ]);
    expect(course.state).toBe("stale");
  });

  it("uncovered grouped by dir", () => {
    const repo = makeRepo({ "src/util.js": "u\n" });
    const base = headCommit(repo.dir);
    repo.commit(
      {
        ".teachme/courses/arch/course.md": `---\ntitle: Architecture\nsyncedCommit: ${base}\n---\nIntro.\n`,
        ".teachme/courses/arch/01-setup.md":
          "---\ntitle: Setup\nsources:\n  - src/util.js\n---\nBody.\n",
      },
      "add course",
    );
    repo.commit(
      {
        "src/b.js": "b\n",
        "src/a.js": "a\n",
        "lib/c.js": "c\n",
        "readme.md": "root file\n",
      },
      "add several files",
    );

    const { content, contentDir } = load(repo);
    const report = buildStatus(content, { contentDir, repoRoot: repo.dir });
    const course = findItem(report, "arch");

    expect(course.uncovered).toEqual([
      { dir: ".", files: ["readme.md"] },
      { dir: "lib", files: ["lib/c.js"] },
      { dir: "src", files: ["src/a.js", "src/b.js"] },
    ]);
    expect(course.state).toBe("stale");
  });

  it("changes inside .teachme ignored", () => {
    const repo = makeRepo({ "src/util.js": "export const util = 1;\n" });
    const base = headCommit(repo.dir);
    repo.commit(
      {
        ".teachme/courses/arch/course.md": `---\ntitle: Architecture\nsyncedCommit: ${base}\n---\nIntro.\n`,
        ".teachme/courses/arch/01-setup.md":
          "---\ntitle: Setup\nsources:\n  - src/util.js\n---\nBody.\n",
      },
      "add course",
    );
    repo.commit(
      {
        "src/new-thing.js": "export const thing = 1;\n",
        ".teachme/courses/arch/02-extra.md": "---\ntitle: Extra\n---\nMore body.\n",
      },
      "add uncovered source and extra lesson",
    );

    const { content, contentDir } = load(repo);
    const report = buildStatus(content, { contentDir, repoRoot: repo.dir });
    const course = findItem(report, "arch");

    expect(course.uncovered).toEqual([{ dir: "src", files: ["src/new-thing.js"] }]);
  });

  it("never synced", () => {
    const repo = makeRepo({
      ".teachme/courses/arch/course.md": "---\ntitle: Architecture\n---\nIntro.\n",
      ".teachme/courses/arch/01-setup.md": "---\ntitle: Setup\n---\nBody.\n",
    });

    const { content, contentDir } = load(repo);
    const report = buildStatus(content, { contentDir, repoRoot: repo.dir });
    const course = findItem(report, "arch");

    expect(course.syncedCommit).toBeNull();
    expect(course.state).toBe("never-synced");
    expect(course.stale).toEqual([]);
    expect(course.broken).toEqual([]);
    expect(course.uncovered).toEqual([]);
  });

  it("unknown commit", () => {
    const repo = makeRepo({
      ".teachme/courses/arch/course.md":
        "---\ntitle: Architecture\nsyncedCommit: deadbeef\n---\nIntro.\n",
      ".teachme/courses/arch/01-setup.md": "---\ntitle: Setup\n---\nBody.\n",
    });

    const { content, contentDir } = load(repo);
    const report = buildStatus(content, { contentDir, repoRoot: repo.dir });
    const course = findItem(report, "arch");

    expect(course.state).toBe("unknown-commit");
    expect(course.stale).toEqual([]);
    expect(course.broken).toEqual([]);
    expect(course.uncovered).toEqual([]);
  });

  it("quiz questions tracked", () => {
    const repo = makeRepo({ "src/util.js": "export const util = 1;\n" });
    const base = headCommit(repo.dir);
    repo.commit(
      {
        ".teachme/quizzes/basics/quiz.md": `---\ntitle: Basics\nsyncedCommit: ${base}\n---\nIntro.\n`,
        ".teachme/quizzes/basics/01-q.md":
          "---\ntitle: Question one\nsources:\n  - src/util.js\n---\nPrompt?\n\n## Options\n- [x] Yes\n- [ ] No\n",
      },
      "add quiz",
    );
    const editSha = repo.commit({ "src/util.js": "export const util = 2;\n" }, "edit util");

    const { content, contentDir } = load(repo);
    const report = buildStatus(content, { contentDir, repoRoot: repo.dir });

    const quiz = findItem(report, "basics");
    expect(quiz.kind).toBe("quiz");
    expect(quiz.state).toBe("stale");
    expect(quiz.stale).toEqual([
      {
        file: "quizzes/basics/01-q.md",
        title: "Question one",
        sources: [{ path: "src/util.js", commits: [{ sha: editSha, subject: "edit util" }] }],
      },
    ]);
    // quizzes never report uncovered
    expect(quiz.uncovered).toEqual([]);
  });

  it("head is HEAD's short sha", () => {
    const repo = makeRepo({ "a.md": "a\n" });
    const sha = repo.commit({ "a.md": "a\nb\n" }, "edit a");

    const { content, contentDir } = load(repo);
    const report = buildStatus(content, { contentDir, repoRoot: repo.dir });

    expect(report.head).toBe(sha);
  });
});

describe("formatStatus", () => {
  it("lists commit subjects", () => {
    const repo = makeRepo({ "src/util.js": "export const util = 1;\n" });
    const base = headCommit(repo.dir);
    repo.commit(
      {
        ".teachme/courses/arch/course.md": `---\ntitle: Architecture\nsyncedCommit: ${base}\n---\nIntro.\n`,
        ".teachme/courses/arch/01-setup.md":
          "---\ntitle: Setup\nsources:\n  - src/util.js\n---\nBody.\n",
      },
      "add course",
    );
    repo.commit({ "src/util.js": "export const util = 2;\n" }, "edit util for real reasons");

    const { content, contentDir } = load(repo);
    const report = buildStatus(content, { contentDir, repoRoot: repo.dir });

    const text = formatStatus(report);
    expect(text).toContain("edit util for real reasons");
    expect(text.split("\n")[0]).toBe(`HEAD ${report.head}`);
  });
});
