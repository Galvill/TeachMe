import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadContent } from "./content.js";
import { writeTree } from "../test/helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const examplesContentDir = path.join(
  repoRoot,
  "skill/teachme-authoring/examples/.teachme",
);

describe("loadContent validation", () => {
  it("missing quiz reference", () => {
    const dir = writeTree({
      ".teachme/courses/arch/course.md":
        "---\ntitle: Architecture\nquiz: does-not-exist\n---\nIntro.\n",
      ".teachme/courses/arch/01-page.md": "---\ntitle: Page\n---\nBody.\n",
    });

    const content = loadContent(`${dir}/.teachme`, { repoRoot: dir });

    expect(content.errors).toContainEqual({
      file: "courses/arch/course.md",
      message: 'Unknown quiz "does-not-exist"',
    });
    expect(content.courses).toHaveLength(1);
    expect(content.courses[0].toc.some((t) => t.type === "quiz")).toBe(false);
  });

  it("missing course reference", () => {
    const dir = writeTree({
      ".teachme/quizzes/final/quiz.md":
        "---\ntitle: Final\ncourse: does-not-exist\n---\nIntro.\n",
      ".teachme/quizzes/final/01-q.md": "Prompt?\n\n## Options\n- [x] Yes\n- [ ] No\n",
    });

    const content = loadContent(`${dir}/.teachme`, { repoRoot: dir });

    expect(content.errors).toContainEqual({
      file: "quizzes/final/quiz.md",
      message: 'Unknown course "does-not-exist"',
    });
    expect(content.quizzes).toHaveLength(1);
    expect(content.quizzes[0].course).toBeNull();
  });

  it("bad frontmatter", () => {
    const dir = writeTree({
      ".teachme/courses/arch/course.md":
        "---\ntitle: [broken\n---\nIntro.\n",
      ".teachme/courses/arch/01-page.md": "---\ntitle: Page\n---\nBody.\n",
    });

    const content = loadContent(`${dir}/.teachme`, { repoRoot: dir });

    expect(content.errors).toHaveLength(1);
    expect(content.errors[0].file).toBe("courses/arch/course.md");
    expect(content.errors[0].message).toMatch(/^Invalid frontmatter: /);
    expect(content.courses).toEqual([]);
  });

  it("missing title", () => {
    const dir = writeTree({
      ".teachme/courses/arch/course.md": "---\ndescription: No title here\n---\nIntro.\n",
      ".teachme/courses/arch/01-page.md": "---\ntitle: Page\n---\nBody.\n",
      ".teachme/quizzes/final/quiz.md": "---\ndescription: No title\n---\nIntro.\n",
      ".teachme/quizzes/final/01-q.md": "Prompt?\n\n## Options\n- [x] Yes\n- [ ] No\n",
    });

    const content = loadContent(`${dir}/.teachme`, { repoRoot: dir });

    expect(content.errors).toContainEqual({
      file: "courses/arch/course.md",
      message: 'Missing required "title"',
    });
    expect(content.errors).toContainEqual({
      file: "quizzes/final/quiz.md",
      message: 'Missing required "title"',
    });
    expect(content.courses).toEqual([]);
    expect(content.quizzes).toEqual([]);
  });

  it("passingScore out of range", () => {
    const dir = writeTree({
      ".teachme/quizzes/final/quiz.md":
        "---\ntitle: Final\npassingScore: 150\n---\nIntro.\n",
      ".teachme/quizzes/final/01-q.md": "Prompt?\n\n## Options\n- [x] Yes\n- [ ] No\n",
    });

    const content = loadContent(`${dir}/.teachme`, { repoRoot: dir });

    expect(content.errors).toContainEqual({
      file: "quizzes/final/quiz.md",
      message: "passingScore must be a number between 0 and 100",
    });
    expect(content.quizzes).toEqual([]);
  });

  it("duplicate slug", () => {
    const dir = writeTree({
      ".teachme/courses/arch/course.md": "---\ntitle: Architecture\n---\nIntro.\n",
      ".teachme/courses/arch/01-setup.md": "---\ntitle: Setup one\n---\nBody.\n",
      ".teachme/courses/arch/02-setup.md": "---\ntitle: Setup two\n---\nBody.\n",
    });

    const content = loadContent(`${dir}/.teachme`, { repoRoot: dir });

    expect(content.errors).toContainEqual({
      file: "courses/arch/02-setup.md",
      message: 'Duplicate slug "setup"',
    });
    expect(content.courses[0].pages["setup"].title).toBe("Setup one");
    expect(Object.keys(content.courses[0].pages)).toEqual(["setup"]);
  });

  it("empty course omitted", () => {
    const dir = writeTree({
      ".teachme/courses/arch/course.md": "---\ntitle: Architecture\n---\nIntro.\n",
    });

    const content = loadContent(`${dir}/.teachme`, { repoRoot: dir });

    expect(content.errors).toContainEqual({
      file: "courses/arch/course.md",
      message: "Course has no pages",
    });
    expect(content.courses).toEqual([]);
  });

  it("invalid question omitted", () => {
    const dir = writeTree({
      ".teachme/quizzes/final/quiz.md": "---\ntitle: Final\n---\nIntro.\n",
      ".teachme/quizzes/final/01-bad.md": "Prompt with no options section.\n",
      ".teachme/quizzes/final/02-good.md": "Prompt?\n\n## Options\n- [x] Yes\n- [ ] No\n",
    });

    const content = loadContent(`${dir}/.teachme`, { repoRoot: dir });

    expect(content.errors).toContainEqual({
      file: "quizzes/final/01-bad.md",
      message: 'Missing "## Options" section',
    });
    expect(content.quizzes[0].questions).toHaveLength(1);
    expect(content.quizzes[0].questions[0].slug).toBe("good");
  });

  it("warnings", () => {
    const dir = writeTree({
      ".teachme/courses/arch/course.md": "---\ntitle: Architecture\n---\nIntro.\n",
      ".teachme/courses/arch/01-page.md":
        '---\ntitle: Page\nsources:\n  - does/not/exist.ts\n---\n' +
        "```mermaid\n   \n```\n\n" +
        "![broken](./missing.png)\n",
    });

    const content = loadContent(`${dir}/.teachme`, { repoRoot: dir });

    expect(content.errors).toEqual([]);
    expect(content.warnings).toContainEqual({
      file: "courses/arch/01-page.md",
      message: "Source not found: does/not/exist.ts",
    });
    expect(content.warnings).toContainEqual({
      file: "courses/arch/01-page.md",
      message: "Empty mermaid block",
    });
    expect(content.warnings).toContainEqual({
      file: "courses/arch/01-page.md",
      message: "Image not found: ./missing.png",
    });
    expect(content.courses).toHaveLength(1);
  });

  it("example content is clean", () => {
    const content = loadContent(examplesContentDir, { repoRoot });

    expect(content.errors).toEqual([]);
    expect(content.warnings).toEqual([]);
    expect(content.courses.length).toBeGreaterThan(0);
    expect(content.quizzes.length).toBeGreaterThan(0);
  });
});
