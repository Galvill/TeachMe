import { describe, expect, it } from "vitest";
import { loadContent } from "./content.js";
import { writeTree } from "../test/helpers.js";

describe("loadContent", () => {
  it("orders and slugs", () => {
    const dir = writeTree({
      ".teachme/courses/arch/course.md": "---\ntitle: Architecture\n---\nIntro.\n",
      ".teachme/courses/arch/02-first-request.md":
        "---\ntitle: First request\n---\nBody one.\n",
      ".teachme/courses/arch/01-setup.md": "---\ntitle: Setup\n---\nBody two.\n",
      ".teachme/courses/arch/z-appendix.md": "---\ntitle: Appendix\n---\nBody three.\n",
      ".teachme/courses/arch/a-notes.md": "---\ntitle: Notes\n---\nBody four.\n",
    });

    const content = loadContent(`${dir}/.teachme`, { repoRoot: dir });

    expect(content.errors).toEqual([]);
    expect(content.warnings).toEqual([]);
    const course = content.courses[0];
    expect(course.slug).toBe("arch");
    expect(course.toc.map((t) => t.path)).toEqual([
      "setup",
      "first-request",
      "a-notes",
      "z-appendix",
    ]);
    expect(Object.keys(course.pages)).toEqual([
      "setup",
      "first-request",
      "a-notes",
      "z-appendix",
    ]);
    expect(course.pages["setup"].file).toBe("courses/arch/01-setup.md");
  });

  it("sections and section titles", () => {
    const dir = writeTree({
      ".teachme/courses/arch/course.md": "---\ntitle: Architecture\n---\nIntro.\n",
      ".teachme/courses/arch/02-getting-started/_section.md":
        "---\ntitle: Getting going\n---\n",
      ".teachme/courses/arch/02-getting-started/01-setup.md":
        "---\ntitle: Setup\n---\nBody.\n",
      ".teachme/courses/arch/03-no-override/01-page.md":
        "---\ntitle: Page\n---\nBody.\n",
    });

    const content = loadContent(`${dir}/.teachme`, { repoRoot: dir });
    const course = content.courses[0];

    const withOverride = course.toc.find((t) => t.path === "getting-started/setup");
    expect(withOverride).toEqual({
      type: "page",
      path: "getting-started/setup",
      title: "Setup",
      section: "Getting going",
    });

    const withoutOverride = course.toc.find((t) => t.path === "no-override/page");
    expect(withoutOverride?.section).toBe("No override");
    expect(course.pages["getting-started/setup"].path).toBe("getting-started/setup");
  });

  it("title fallbacks", () => {
    const dir = writeTree({
      ".teachme/courses/arch/course.md": "---\ntitle: Architecture\n---\nIntro.\n",
      ".teachme/courses/arch/01-front.md": "---\ntitle: From frontmatter\n---\nBody.\n",
      ".teachme/courses/arch/02-heading.md": "# From heading\n\nBody text.\n",
      ".teachme/courses/arch/03-plain-file.md": "Just a body, no title anywhere.\n",
    });

    const content = loadContent(`${dir}/.teachme`, { repoRoot: dir });
    const course = content.courses[0];

    expect(course.pages["front"].title).toBe("From frontmatter");

    expect(course.pages["heading"].title).toBe("From heading");
    expect(course.pages["heading"].body).toBe("Body text.\n");

    expect(course.pages["plain-file"].title).toBe("Plain file");
  });

  it("section and final quiz in toc", () => {
    const dir = writeTree({
      ".teachme/quizzes/getting-started-check/quiz.md":
        "---\ntitle: Getting started check\n---\nIntro.\n",
      ".teachme/quizzes/getting-started-check/01-q.md":
        "Prompt?\n\n## Options\n- [x] Yes\n- [ ] No\n",
      ".teachme/quizzes/architecture-final/quiz.md":
        "---\ntitle: Architecture final\n---\nIntro.\n",
      ".teachme/quizzes/architecture-final/01-q.md":
        "Prompt?\n\n## Options\n- [x] Yes\n- [ ] No\n",
      ".teachme/courses/arch/course.md":
        "---\ntitle: Architecture\nquiz: architecture-final\n---\nIntro.\n",
      ".teachme/courses/arch/01-getting-started/_section.md":
        "---\ntitle: Getting started\nquiz: getting-started-check\n---\n",
      ".teachme/courses/arch/01-getting-started/01-setup.md":
        "---\ntitle: Setup\n---\nBody.\n",
      ".teachme/courses/arch/02-missing-quiz/_section.md":
        "---\ntitle: Missing quiz section\nquiz: does-not-exist\n---\n",
      ".teachme/courses/arch/02-missing-quiz/01-page.md":
        "---\ntitle: Page\n---\nBody.\n",
    });

    const content = loadContent(`${dir}/.teachme`, { repoRoot: dir });
    const course = content.courses[0];

    const sectionQuizItem = course.toc.find(
      (t) => t.path === "_quiz/getting-started-check",
    );
    expect(sectionQuizItem).toEqual({
      type: "quiz",
      path: "_quiz/getting-started-check",
      title: "Getting started check",
      section: "Getting started",
      quizSlug: "getting-started-check",
    });

    const courseQuizItem = course.toc[course.toc.length - 1];
    expect(courseQuizItem).toEqual({
      type: "quiz",
      path: "_quiz/architecture-final",
      title: "Architecture final",
      section: null,
      quizSlug: "architecture-final",
    });

    const missingQuizItem = course.toc.find(
      (t) => t.path === "_quiz/does-not-exist",
    );
    expect(missingQuizItem).toBeUndefined();
  });

  it("course sort order", () => {
    const dir = writeTree({
      ".teachme/courses/beta/course.md":
        "---\ntitle: Beta course\norder: 2\n---\nIntro.\n",
      ".teachme/courses/alpha/course.md":
        "---\ntitle: Alpha course\norder: 1\n---\nIntro.\n",
      ".teachme/courses/zeta/course.md": "---\ntitle: Zeta course\n---\nIntro.\n",
      ".teachme/courses/mu/course.md": "---\ntitle: Mu course\n---\nIntro.\n",
    });

    const content = loadContent(`${dir}/.teachme`, { repoRoot: dir });

    expect(content.courses.map((c) => c.slug)).toEqual([
      "alpha",
      "beta",
      "mu",
      "zeta",
    ]);
  });
});
