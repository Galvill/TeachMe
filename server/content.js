import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { parseQuestion } from "./quizParser.js";

/** @typedef {import('../shared/types.js').Content} Content */
/** @typedef {import('../shared/types.js').Course} Course */
/** @typedef {import('../shared/types.js').Quiz} Quiz */
/** @typedef {import('../shared/types.js').Page} Page */
/** @typedef {import('../shared/types.js').Question} Question */
/** @typedef {import('../shared/types.js').TocItem} TocItem */

const PREFIX_RE = /^(\d+)-(.+)$/;
const NUMERIC_PREFIX_RE = /^(\d+)-/;

/**
 * Strip a leading `NN-` numeric prefix from a file or folder name.
 * @param {string} name
 * @returns {string}
 */
function stripPrefix(name) {
  const m = PREFIX_RE.exec(name);
  return m ? m[2] : name;
}

/**
 * Slug for a page/question file: prefix and `.md` extension removed.
 * @param {string} filename
 * @returns {string}
 */
function fileSlug(filename) {
  return stripPrefix(filename.replace(/\.md$/, ""));
}

/**
 * Humanize a (already prefix-stripped) slug: hyphens to spaces, first
 * letter capitalized.
 * @param {string} slug
 * @returns {string}
 */
function humanize(slug) {
  const withSpaces = slug.replace(/-/g, " ");
  if (withSpaces.length === 0) return withSpaces;
  return withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1);
}

/**
 * Order directory entry names: numeric-prefixed names first (by numeric
 * value, then full name), unprefixed names after, alphabetically.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function compareNames(a, b) {
  const ma = NUMERIC_PREFIX_RE.exec(a);
  const mb = NUMERIC_PREFIX_RE.exec(b);
  if (ma && mb) {
    const na = Number(ma[1]);
    const nb = Number(mb[1]);
    if (na !== nb) return na - nb;
    return a.localeCompare(b);
  }
  if (ma) return -1;
  if (mb) return 1;
  return a.localeCompare(b);
}

/**
 * @param {string} dir
 * @returns {fs.Dirent[]}
 */
function listEntries(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true });
}

/**
 * @param {string} absPath
 * @param {string} contentDir
 * @returns {string}
 */
function relPath(absPath, contentDir) {
  return path.relative(contentDir, absPath).split(path.sep).join("/");
}

/**
 * @param {string} absPath
 * @returns {{ data: Record<string, unknown>; content: string }}
 */
function readMarkdown(absPath) {
  const raw = fs.readFileSync(absPath, "utf8");
  // gray-matter caches parses by input string; pass {} as options to avoid
  // stale results across tests/files.
  const parsed = matter(raw, {});
  return { data: parsed.data, content: parsed.content };
}

/**
 * Resolve a page's title: frontmatter title, else a leading `# H1` (which
 * is then removed from the body), else the humanized fallback slug.
 * @param {unknown} frontTitle
 * @param {string} rawBody
 * @param {string} fallbackSlug
 * @returns {{ title: string; body: string }}
 */
function resolveTitle(frontTitle, rawBody, fallbackSlug) {
  if (frontTitle != null) {
    return { title: String(frontTitle), body: rawBody };
  }
  const lines = rawBody.split(/\r?\n/);
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i += 1;
  if (i < lines.length) {
    const m = /^#\s+(.+?)\s*$/.exec(lines[i]);
    if (m) {
      const rest = lines
        .slice(i + 1)
        .join("\n")
        .replace(/^\s+/, "");
      return { title: m[1].trim(), body: rest };
    }
  }
  return { title: humanize(fallbackSlug), body: rawBody };
}

/**
 * @param {string} absPath
 * @param {string} contentDir
 * @param {string} fallbackSlug
 * @returns {{ title: string; body: string; sources: string[]; file: string }}
 */
function buildPageFields(absPath, contentDir, fallbackSlug) {
  const { data, content } = readMarkdown(absPath);
  const { title, body } = resolveTitle(data.title, content, fallbackSlug);
  const sources = /** @type {string[]} */ (data.sources ?? []);
  const file = relPath(absPath, contentDir);
  return { title, body, sources, file };
}

/**
 * Build the TOC and pages map for a single course folder.
 * @param {string} courseDir
 * @param {string} contentDir
 * @param {Map<string, Quiz>} quizzesBySlug
 * @returns {{ toc: TocItem[]; pages: Record<string, Page> }}
 */
function loadCourseToc(courseDir, contentDir, quizzesBySlug) {
  /** @type {TocItem[]} */
  const toc = [];
  /** @type {Record<string, Page>} */
  const pages = {};

  const entries = listEntries(courseDir)
    .filter((d) => d.name !== "course.md" && !d.name.startsWith("_"))
    .filter((d) => d.isDirectory() || (d.isFile() && d.name.endsWith(".md")))
    .sort((a, b) => compareNames(a.name, b.name));

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const sectionDir = path.join(courseDir, entry.name);
      const sectionSlug = stripPrefix(entry.name);
      const sectionMdPath = path.join(sectionDir, "_section.md");

      let sectionTitle = humanize(sectionSlug);
      /** @type {string | null} */
      let sectionQuizRef = null;
      if (fs.existsSync(sectionMdPath)) {
        const { data } = readMarkdown(sectionMdPath);
        if (data.title != null) sectionTitle = String(data.title);
        sectionQuizRef = data.quiz != null ? String(data.quiz) : null;
      }

      const pageEntries = listEntries(sectionDir)
        .filter(
          (d) =>
            d.isFile() &&
            d.name.endsWith(".md") &&
            d.name !== "_section.md" &&
            !d.name.startsWith("_"),
        )
        .sort((a, b) => compareNames(a.name, b.name));

      for (const pageEntry of pageEntries) {
        const abs = path.join(sectionDir, pageEntry.name);
        const pageSlug = fileSlug(pageEntry.name);
        const pagePath = `${sectionSlug}/${pageSlug}`;
        const fields = buildPageFields(abs, contentDir, pageSlug);
        pages[pagePath] = { path: pagePath, ...fields };
        toc.push({
          type: "page",
          path: pagePath,
          title: fields.title,
          section: sectionTitle,
        });
      }

      if (sectionQuizRef && quizzesBySlug.has(sectionQuizRef)) {
        const quiz = /** @type {Quiz} */ (quizzesBySlug.get(sectionQuizRef));
        toc.push({
          type: "quiz",
          path: `_quiz/${sectionQuizRef}`,
          title: quiz.title,
          section: sectionTitle,
          quizSlug: sectionQuizRef,
        });
      }
    } else {
      const abs = path.join(courseDir, entry.name);
      const pageSlug = fileSlug(entry.name);
      const fields = buildPageFields(abs, contentDir, pageSlug);
      pages[pageSlug] = { path: pageSlug, ...fields };
      toc.push({
        type: "page",
        path: pageSlug,
        title: fields.title,
        section: null,
      });
    }
  }

  return { toc, pages };
}

/**
 * @param {string} courseDir
 * @param {string} contentDir
 * @param {string} courseSlug
 * @param {Map<string, Quiz>} quizzesBySlug
 * @returns {Course | null}
 */
function loadCourse(courseDir, contentDir, courseSlug, quizzesBySlug) {
  const courseMdPath = path.join(courseDir, "course.md");
  if (!fs.existsSync(courseMdPath)) return null;

  const { data, content } = readMarkdown(courseMdPath);
  const title = data.title != null ? String(data.title) : humanize(courseSlug);
  const description = /** @type {string} */ (data.description ?? "");
  const duration = data.duration != null ? String(data.duration) : null;
  const order = /** @type {number | null} */ (data.order ?? null);
  const quiz = data.quiz != null ? String(data.quiz) : null;
  const syncedCommit = data.syncedCommit != null ? String(data.syncedCommit) : null;
  const intro = content.trim();
  const file = relPath(courseMdPath, contentDir);

  const { toc, pages } = loadCourseToc(courseDir, contentDir, quizzesBySlug);

  if (quiz && quizzesBySlug.has(quiz)) {
    const courseQuiz = /** @type {Quiz} */ (quizzesBySlug.get(quiz));
    toc.push({
      type: "quiz",
      path: `_quiz/${quiz}`,
      title: courseQuiz.title,
      section: null,
      quizSlug: quiz,
    });
  }

  return {
    slug: courseSlug,
    title,
    description,
    duration,
    order,
    quiz,
    syncedCommit,
    intro,
    toc,
    pages,
    file,
  };
}

/**
 * @param {string} coursesDir
 * @param {string} contentDir
 * @param {Map<string, Quiz>} quizzesBySlug
 * @returns {Course[]}
 */
function loadCourses(coursesDir, contentDir, quizzesBySlug) {
  const entries = listEntries(coursesDir).filter((d) => d.isDirectory());

  /** @type {Course[]} */
  const courses = [];
  for (const entry of entries) {
    const courseDir = path.join(coursesDir, entry.name);
    const course = loadCourse(courseDir, contentDir, entry.name, quizzesBySlug);
    if (course) courses.push(course);
  }

  courses.sort((a, b) => {
    if (a.order == null && b.order == null) return a.title.localeCompare(b.title);
    if (a.order == null) return 1;
    if (b.order == null) return -1;
    if (a.order !== b.order) return a.order - b.order;
    return a.title.localeCompare(b.title);
  });

  return courses;
}

/**
 * @param {string} quizDir
 * @param {string} contentDir
 * @param {string} quizSlug
 * @returns {Quiz | null}
 */
function loadQuiz(quizDir, contentDir, quizSlug) {
  const quizMdPath = path.join(quizDir, "quiz.md");
  if (!fs.existsSync(quizMdPath)) return null;

  const { data, content } = readMarkdown(quizMdPath);
  const title = data.title != null ? String(data.title) : humanize(quizSlug);
  const description = /** @type {string} */ (data.description ?? "");
  const passingScore = /** @type {number} */ (data.passingScore ?? 70);
  const course = data.course != null ? String(data.course) : null;
  const syncedCommit = data.syncedCommit != null ? String(data.syncedCommit) : null;
  const intro = content.trim();
  const file = relPath(quizMdPath, contentDir);

  const questionEntries = listEntries(quizDir)
    .filter(
      (d) =>
        d.isFile() &&
        d.name.endsWith(".md") &&
        d.name !== "quiz.md" &&
        !d.name.startsWith("_"),
    )
    .sort((a, b) => compareNames(a.name, b.name));

  /** @type {Question[]} */
  const questions = questionEntries.map((entry) => {
    const abs = path.join(quizDir, entry.name);
    const { data: qData, content: qBody } = readMarkdown(abs);
    const slug = fileSlug(entry.name);
    const qTitle = qData.title != null ? String(qData.title) : humanize(slug);
    const sources = /** @type {string[]} */ (qData.sources ?? []);
    const parsed = parseQuestion(qBody);
    return {
      prompt: parsed.prompt,
      options: parsed.options,
      multi: parsed.multi,
      explanation: parsed.explanation,
      slug,
      title: qTitle,
      sources,
      file: relPath(abs, contentDir),
    };
  });

  return {
    slug: quizSlug,
    title,
    description,
    passingScore,
    course,
    syncedCommit,
    intro,
    questions,
    file,
  };
}

/**
 * @param {string} quizzesDir
 * @param {string} contentDir
 * @returns {Quiz[]}
 */
function loadQuizzes(quizzesDir, contentDir) {
  const entries = listEntries(quizzesDir).filter((d) => d.isDirectory());

  /** @type {Quiz[]} */
  const quizzes = [];
  for (const entry of entries) {
    const quizDir = path.join(quizzesDir, entry.name);
    const quiz = loadQuiz(quizDir, contentDir, entry.name);
    if (quiz) quizzes.push(quiz);
  }

  quizzes.sort((a, b) => a.title.localeCompare(b.title));
  return quizzes;
}

/**
 * Load a `.teachme/` content folder into the content model. Structural
 * only: no validation. `errors`/`warnings` are always empty; Task 4 fills
 * them in.
 * @param {string} contentDir
 * @param {{ repoRoot: string }} opts
 * @returns {Content}
 */
export function loadContent(contentDir, opts) {
  void opts; // unused until Task 4

  const quizzesDir = path.join(contentDir, "quizzes");
  const coursesDir = path.join(contentDir, "courses");

  const quizzes = fs.existsSync(quizzesDir) ? loadQuizzes(quizzesDir, contentDir) : [];
  const quizzesBySlug = new Map(quizzes.map((q) => [q.slug, q]));
  const courses = fs.existsSync(coursesDir)
    ? loadCourses(coursesDir, contentDir, quizzesBySlug)
    : [];

  return { courses, quizzes, errors: [], warnings: [] };
}
