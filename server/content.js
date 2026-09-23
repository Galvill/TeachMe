import fs from "node:fs";
import path from "node:path";
import { parseQuestion } from "./quizParser.js";
import { tryReadMarkdown, checkSources, checkMarkdownContent } from "./validate.js";

/** @typedef {import('../shared/types.js').Content} Content */
/** @typedef {import('../shared/types.js').Course} Course */
/** @typedef {import('../shared/types.js').Quiz} Quiz */
/** @typedef {import('../shared/types.js').Page} Page */
/** @typedef {import('../shared/types.js').Question} Question */
/** @typedef {import('../shared/types.js').TocItem} TocItem */
/** @typedef {import('../shared/types.js').Issue} Issue */
/** @typedef {{ errors: Issue[]; warnings: Issue[] }} Issues */

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
 * @param {string} repoRoot
 * @param {Issues} issues
 * @returns {{ title: string; body: string; sources: string[]; file: string } | null}
 */
function buildPageFields(absPath, contentDir, fallbackSlug, repoRoot, issues) {
  const read = tryReadMarkdown(absPath, (p) => relPath(p, contentDir), issues);
  if (!read.ok) return null;

  const { title, body } = resolveTitle(read.data.title, read.content, fallbackSlug);
  const sources = /** @type {string[]} */ (read.data.sources ?? []);
  const file = relPath(absPath, contentDir);

  checkSources(sources, file, repoRoot, issues);
  checkMarkdownContent(body, path.dirname(absPath), file, issues);

  return { title, body, sources, file };
}

/**
 * Build the TOC and pages map for a single course folder.
 * @param {string} courseDir
 * @param {string} contentDir
 * @param {Map<string, Quiz>} quizzesBySlug
 * @param {string} repoRoot
 * @param {Issues} issues
 * @returns {{ toc: TocItem[]; pages: Record<string, Page> }}
 */
function loadCourseToc(courseDir, contentDir, quizzesBySlug, repoRoot, issues) {
  /** @type {TocItem[]} */
  const toc = [];
  /** @type {Record<string, Page>} */
  const pages = {};

  const entries = listEntries(courseDir)
    .filter((d) => d.name !== "course.md" && !d.name.startsWith("_"))
    .filter((d) => d.isDirectory() || (d.isFile() && d.name.endsWith(".md")))
    .sort((a, b) => compareNames(a.name, b.name));

  /** @type {Set<string>} */
  const topSlugs = new Set();

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const sectionSlug = stripPrefix(entry.name);
      const sectionDir = path.join(courseDir, entry.name);
      const sectionMdPath = path.join(sectionDir, "_section.md");

      if (topSlugs.has(sectionSlug)) {
        const dupFile = fs.existsSync(sectionMdPath)
          ? relPath(sectionMdPath, contentDir)
          : relPath(sectionDir, contentDir);
        issues.errors.push({ file: dupFile, message: `Duplicate slug "${sectionSlug}"` });
        continue;
      }
      topSlugs.add(sectionSlug);

      let sectionTitle = humanize(sectionSlug);
      /** @type {string | null} */
      let sectionQuizRef = null;
      if (fs.existsSync(sectionMdPath)) {
        const read = tryReadMarkdown(sectionMdPath, (p) => relPath(p, contentDir), issues);
        if (read.ok) {
          if (read.data.title != null) sectionTitle = String(read.data.title);
          sectionQuizRef = read.data.quiz != null ? String(read.data.quiz) : null;
        }
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

      /** @type {Set<string>} */
      const sectionSlugs = new Set();
      for (const pageEntry of pageEntries) {
        const pageSlug = fileSlug(pageEntry.name);
        const abs = path.join(sectionDir, pageEntry.name);
        if (sectionSlugs.has(pageSlug)) {
          issues.errors.push({
            file: relPath(abs, contentDir),
            message: `Duplicate slug "${pageSlug}"`,
          });
          continue;
        }
        sectionSlugs.add(pageSlug);

        const fields = buildPageFields(abs, contentDir, pageSlug, repoRoot, issues);
        if (!fields) continue;

        const pagePath = `${sectionSlug}/${pageSlug}`;
        pages[pagePath] = { path: pagePath, ...fields };
        toc.push({
          type: "page",
          path: pagePath,
          title: fields.title,
          section: sectionTitle,
        });
      }

      if (sectionQuizRef) {
        if (quizzesBySlug.has(sectionQuizRef)) {
          const quiz = /** @type {Quiz} */ (quizzesBySlug.get(sectionQuizRef));
          toc.push({
            type: "quiz",
            path: `_quiz/${sectionQuizRef}`,
            title: quiz.title,
            section: sectionTitle,
            quizSlug: sectionQuizRef,
          });
        } else {
          issues.errors.push({
            file: relPath(sectionMdPath, contentDir),
            message: `Unknown quiz "${sectionQuizRef}"`,
          });
        }
      }
    } else {
      const pageSlug = fileSlug(entry.name);
      const abs = path.join(courseDir, entry.name);

      if (topSlugs.has(pageSlug)) {
        issues.errors.push({
          file: relPath(abs, contentDir),
          message: `Duplicate slug "${pageSlug}"`,
        });
        continue;
      }
      topSlugs.add(pageSlug);

      const fields = buildPageFields(abs, contentDir, pageSlug, repoRoot, issues);
      if (!fields) continue;

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
 * @param {string} repoRoot
 * @param {Issues} issues
 * @returns {Course | null}
 */
function loadCourse(courseDir, contentDir, courseSlug, quizzesBySlug, repoRoot, issues) {
  const courseMdPath = path.join(courseDir, "course.md");
  const file = relPath(courseMdPath, contentDir);

  if (!fs.existsSync(courseMdPath)) {
    issues.errors.push({ file, message: "Missing course.md" });
    return null;
  }

  const read = tryReadMarkdown(courseMdPath, (p) => relPath(p, contentDir), issues);
  if (!read.ok) return null;

  if (typeof read.data.title !== "string") {
    issues.errors.push({ file, message: 'Missing required "title"' });
    return null;
  }

  const title = read.data.title;
  const description = /** @type {string} */ (read.data.description ?? "");
  const duration = read.data.duration != null ? String(read.data.duration) : null;
  const order = /** @type {number | null} */ (read.data.order ?? null);
  const quiz = read.data.quiz != null ? String(read.data.quiz) : null;
  const syncedCommit = read.data.syncedCommit != null ? String(read.data.syncedCommit) : null;
  const intro = read.content.trim();

  checkMarkdownContent(intro, courseDir, file, issues);

  const { toc, pages } = loadCourseToc(courseDir, contentDir, quizzesBySlug, repoRoot, issues);

  if (Object.keys(pages).length === 0) {
    issues.errors.push({ file, message: "Course has no pages" });
    return null;
  }

  if (quiz) {
    if (quizzesBySlug.has(quiz)) {
      const courseQuiz = /** @type {Quiz} */ (quizzesBySlug.get(quiz));
      toc.push({
        type: "quiz",
        path: `_quiz/${quiz}`,
        title: courseQuiz.title,
        section: null,
        quizSlug: quiz,
      });
    } else {
      issues.errors.push({ file, message: `Unknown quiz "${quiz}"` });
    }
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
 * @param {string} repoRoot
 * @param {Issues} issues
 * @returns {Course[]}
 */
function loadCourses(coursesDir, contentDir, quizzesBySlug, repoRoot, issues) {
  const entries = listEntries(coursesDir).filter((d) => d.isDirectory());

  /** @type {Course[]} */
  const courses = [];
  for (const entry of entries) {
    const courseDir = path.join(coursesDir, entry.name);
    const course = loadCourse(courseDir, contentDir, entry.name, quizzesBySlug, repoRoot, issues);
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
 * @param {string} repoRoot
 * @param {Issues} issues
 * @returns {Quiz | null}
 */
function loadQuiz(quizDir, contentDir, quizSlug, repoRoot, issues) {
  const quizMdPath = path.join(quizDir, "quiz.md");
  const file = relPath(quizMdPath, contentDir);

  if (!fs.existsSync(quizMdPath)) {
    issues.errors.push({ file, message: "Missing quiz.md" });
    return null;
  }

  const read = tryReadMarkdown(quizMdPath, (p) => relPath(p, contentDir), issues);
  if (!read.ok) return null;

  if (typeof read.data.title !== "string") {
    issues.errors.push({ file, message: 'Missing required "title"' });
    return null;
  }

  const title = read.data.title;

  let passingScore = 70;
  if (Object.prototype.hasOwnProperty.call(read.data, "passingScore")) {
    const value = read.data.passingScore;
    if (typeof value !== "number" || Number.isNaN(value) || value < 0 || value > 100) {
      issues.errors.push({
        file,
        message: "passingScore must be a number between 0 and 100",
      });
      return null;
    }
    passingScore = value;
  }

  const description = /** @type {string} */ (read.data.description ?? "");
  const course = read.data.course != null ? String(read.data.course) : null;
  const syncedCommit = read.data.syncedCommit != null ? String(read.data.syncedCommit) : null;
  const intro = read.content.trim();

  checkMarkdownContent(intro, quizDir, file, issues);

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
  const questions = [];
  /** @type {Set<string>} */
  const seenSlugs = new Set();

  for (const entry of questionEntries) {
    const slug = fileSlug(entry.name);
    const abs = path.join(quizDir, entry.name);
    const qFile = relPath(abs, contentDir);

    if (seenSlugs.has(slug)) {
      issues.errors.push({ file: qFile, message: `Duplicate slug "${slug}"` });
      continue;
    }
    seenSlugs.add(slug);

    const qRead = tryReadMarkdown(abs, (p) => relPath(p, contentDir), issues);
    if (!qRead.ok) continue;

    const parsed = parseQuestion(qRead.content);
    if (parsed.errors.length > 0) {
      for (const message of parsed.errors) {
        issues.errors.push({ file: qFile, message });
      }
      continue;
    }

    const qTitle = qRead.data.title != null ? String(qRead.data.title) : humanize(slug);
    const sources = /** @type {string[]} */ (qRead.data.sources ?? []);

    checkSources(sources, qFile, repoRoot, issues);
    checkMarkdownContent(parsed.prompt, quizDir, qFile, issues);
    if (parsed.explanation) checkMarkdownContent(parsed.explanation, quizDir, qFile, issues);

    questions.push({
      prompt: parsed.prompt,
      options: parsed.options,
      multi: parsed.multi,
      explanation: parsed.explanation,
      slug,
      title: qTitle,
      sources,
      file: qFile,
    });
  }

  if (questions.length === 0) {
    issues.errors.push({ file, message: "Quiz has no questions" });
    return null;
  }

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
 * @param {string} repoRoot
 * @param {Issues} issues
 * @returns {Quiz[]}
 */
function loadQuizzes(quizzesDir, contentDir, repoRoot, issues) {
  const entries = listEntries(quizzesDir).filter((d) => d.isDirectory());

  /** @type {Quiz[]} */
  const quizzes = [];
  for (const entry of entries) {
    const quizDir = path.join(quizzesDir, entry.name);
    const quiz = loadQuiz(quizDir, contentDir, entry.name, repoRoot, issues);
    if (quiz) quizzes.push(quiz);
  }

  quizzes.sort((a, b) => a.title.localeCompare(b.title));
  return quizzes;
}

/**
 * Load a `.teachme/` content folder into the content model, validating
 * against spec §2.8. Broken items are omitted; every violation is reported
 * as an error or warning rather than thrown.
 * @param {string} contentDir
 * @param {{ repoRoot: string }} opts
 * @returns {Content}
 */
export function loadContent(contentDir, opts) {
  const { repoRoot } = opts;
  /** @type {Issues} */
  const issues = { errors: [], warnings: [] };

  const quizzesDir = path.join(contentDir, "quizzes");
  const coursesDir = path.join(contentDir, "courses");

  const quizzes = fs.existsSync(quizzesDir)
    ? loadQuizzes(quizzesDir, contentDir, repoRoot, issues)
    : [];
  const quizzesBySlug = new Map(quizzes.map((q) => [q.slug, q]));
  const courses = fs.existsSync(coursesDir)
    ? loadCourses(coursesDir, contentDir, quizzesBySlug, repoRoot, issues)
    : [];

  const courseSlugs = new Set(courses.map((c) => c.slug));
  for (const quiz of quizzes) {
    if (quiz.course != null && !courseSlugs.has(quiz.course)) {
      issues.errors.push({ file: quiz.file, message: `Unknown course "${quiz.course}"` });
      quiz.course = null;
    }
  }

  return { courses, quizzes, errors: issues.errors, warnings: issues.warnings };
}
