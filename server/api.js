import fs from "node:fs";
import path from "node:path";
import { loadContent } from "./content.js";
import { isProjectProgress } from "./progress.js";

/** @typedef {import('../shared/types.js').Course} Course */
/** @typedef {import('../shared/types.js').Quiz} Quiz */
/** @typedef {import('../shared/types.js').Question} Question */
/** @typedef {import('../shared/types.js').CourseSummary} CourseSummary */
/** @typedef {import('../shared/types.js').QuizSummary} QuizSummary */
/** @typedef {import('../shared/types.js').Catalog} Catalog */
/** @typedef {import('../shared/types.js').CourseDetail} CourseDetail */
/** @typedef {import('../shared/types.js').QuizDetail} QuizDetail */
/** @typedef {import('../shared/types.js').ProgressStore} ProgressStore */
/** @typedef {import('node:http').IncomingMessage} IncomingMessage */
/** @typedef {import('node:http').ServerResponse} ServerResponse */

const MAX_PROGRESS_BODY_BYTES = 1024 * 1024;

/** @type {Record<string, string>} */
const CONTENT_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".md": "text/markdown; charset=utf-8",
};

const COURSE_DETAIL_RE = /^\/api\/courses\/([^/]+)$/;
const PAGE_RE = /^\/api\/courses\/([^/]+)\/pages\/(.+)$/;
const QUIZ_DETAIL_RE = /^\/api\/quizzes\/([^/]+)$/;

/**
 * @param {ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 * @returns {void}
 */
function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

/**
 * @param {ServerResponse} res
 * @returns {void}
 */
function sendNotFound(res) {
  sendJson(res, 404, { error: "Not found" });
}

/**
 * @param {string} segment
 * @returns {string | null}
 */
function decodeSegment(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/**
 * Decode each `/`-separated segment of a raw path, rejoining with `/`.
 * Returns `null` if any segment fails to decode.
 * @param {string} raw
 * @returns {string | null}
 */
function decodePath(raw) {
  const parts = [];
  for (const segment of raw.split("/")) {
    const decoded = decodeSegment(segment);
    if (decoded === null) return null;
    parts.push(decoded);
  }
  return parts.join("/");
}

/**
 * @param {Course} course
 * @returns {CourseSummary}
 */
function toCourseSummary(course) {
  return {
    slug: course.slug,
    title: course.title,
    description: course.description,
    duration: course.duration,
    pageCount: Object.keys(course.pages).length,
    quizzes: course.toc
      .filter((item) => item.type === "quiz")
      .map((item) => /** @type {string} */ (item.quizSlug)),
  };
}

/**
 * @param {Quiz} quiz
 * @returns {QuizSummary}
 */
function toQuizSummary(quiz) {
  return {
    slug: quiz.slug,
    title: quiz.title,
    description: quiz.description,
    questionCount: quiz.questions.length,
    passingScore: quiz.passingScore,
  };
}

/**
 * @param {Course} course
 * @returns {CourseDetail}
 */
function toCourseDetail(course) {
  return {
    slug: course.slug,
    title: course.title,
    description: course.description,
    duration: course.duration,
    quiz: course.quiz,
    intro: course.intro,
    toc: course.toc,
  };
}

/**
 * @param {Question} question
 * @returns {Omit<Question, 'file' | 'sources'>}
 */
function toQuestionDetail(question) {
  return {
    prompt: question.prompt,
    options: question.options,
    multi: question.multi,
    explanation: question.explanation,
    slug: question.slug,
    title: question.title,
  };
}

/**
 * @param {Quiz} quiz
 * @returns {QuizDetail}
 */
function toQuizDetail(quiz) {
  return {
    slug: quiz.slug,
    title: quiz.title,
    description: quiz.description,
    passingScore: quiz.passingScore,
    course: quiz.course,
    intro: quiz.intro,
    questions: quiz.questions.map(toQuestionDetail),
  };
}

/**
 * Read a request body up to `maxBytes`. Once the body exceeds the limit,
 * stops buffering (dropping further chunks) but keeps draining the request
 * so the client's write completes normally instead of the socket being torn
 * down; resolves `null` once the request ends.
 * @param {IncomingMessage} req
 * @param {number} maxBytes
 * @returns {Promise<Buffer | null>}
 */
function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    let chunks = [];
    let total = 0;
    let exceeded = false;

    req.on("data", (/** @type {Buffer} */ chunk) => {
      if (exceeded) return;
      total += chunk.length;
      if (total > maxBytes) {
        exceeded = true;
        chunks = [];
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      resolve(exceeded ? null : Buffer.concat(chunks));
    });
    req.on("error", (err) => {
      reject(err);
    });
  });
}

/**
 * Create the request handler for `/api/*` and `/content/*`. Content is
 * (re)loaded from disk on every request; nothing is cached.
 * @param {{ contentDir: string; repoRoot: string; store: ProgressStore }} opts
 * @returns {(req: IncomingMessage, res: ServerResponse, next?: () => void) => void}
 */
export function createHandler(opts) {
  const contentDir = path.resolve(opts.contentDir);
  const { repoRoot, store } = opts;

  /** Real (symlink-resolved) content dir, computed once; used to reject
   * `/content/*` requests that escape it via a symlink.
   * @type {string} */
  let contentDirReal;
  try {
    contentDirReal = fs.realpathSync(contentDir);
  } catch {
    contentDirReal = contentDir;
  }

  /**
   * @param {IncomingMessage} req
   * @param {ServerResponse} res
   * @param {() => void} [next]
   */
  return function handler(req, res, next) {
    handleRequest(req, res, next).catch(() => {
      if (!res.headersSent) {
        sendJson(res, 500, { error: "Internal error" });
      } else {
        res.destroy();
      }
    });
  };

  /**
   * @param {IncomingMessage} req
   * @param {ServerResponse} res
   * @param {() => void} [next]
   * @returns {Promise<void>}
   */
  async function handleRequest(req, res, next) {
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", "http://localhost");
    const pathname = url.pathname;

    if (method === "GET" && pathname === "/api/catalog") {
      const content = loadContent(contentDir, { repoRoot });
      /** @type {Catalog} */
      const catalog = {
        project: path.basename(repoRoot),
        repoRoot,
        courses: content.courses.map(toCourseSummary),
        quizzes: content.quizzes.map(toQuizSummary),
        errors: content.errors,
        warnings: content.warnings,
      };
      sendJson(res, 200, catalog);
      return;
    }

    if (method === "GET" && pathname === "/api/progress") {
      sendJson(res, 200, store.get(contentDir));
      return;
    }

    if (method === "PUT" && pathname === "/api/progress") {
      await handlePutProgress(req, res);
      return;
    }

    const pageMatch = PAGE_RE.exec(pathname);
    if (method === "GET" && pageMatch) {
      handleGetPage(res, decodeSegment(pageMatch[1]), decodePath(pageMatch[2]));
      return;
    }

    const courseMatch = COURSE_DETAIL_RE.exec(pathname);
    if (method === "GET" && courseMatch) {
      handleGetCourse(res, decodeSegment(courseMatch[1]));
      return;
    }

    const quizMatch = QUIZ_DETAIL_RE.exec(pathname);
    if (method === "GET" && quizMatch) {
      handleGetQuiz(res, decodeSegment(quizMatch[1]));
      return;
    }

    if (pathname.startsWith("/api/")) {
      sendNotFound(res);
      return;
    }

    if (method === "GET" && (pathname === "/content" || pathname.startsWith("/content/"))) {
      handleGetContentFile(res, pathname.slice("/content".length).replace(/^\//, ""));
      return;
    }

    if (next) {
      next();
      return;
    }
    sendNotFound(res);
  }

  /**
   * @param {ServerResponse} res
   * @param {string | null} slug
   * @returns {void}
   */
  function handleGetCourse(res, slug) {
    if (slug === null) {
      sendNotFound(res);
      return;
    }
    const content = loadContent(contentDir, { repoRoot });
    const course = content.courses.find((c) => c.slug === slug);
    if (!course) {
      sendNotFound(res);
      return;
    }
    sendJson(res, 200, toCourseDetail(course));
  }

  /**
   * @param {ServerResponse} res
   * @param {string | null} slug
   * @param {string | null} pagePath
   * @returns {void}
   */
  function handleGetPage(res, slug, pagePath) {
    if (slug === null || pagePath === null) {
      sendNotFound(res);
      return;
    }
    const content = loadContent(contentDir, { repoRoot });
    const course = content.courses.find((c) => c.slug === slug);
    const page = course && Object.hasOwn(course.pages, pagePath) ? course.pages[pagePath] : undefined;
    if (!page) {
      sendNotFound(res);
      return;
    }
    sendJson(res, 200, { ...page });
  }

  /**
   * @param {ServerResponse} res
   * @param {string | null} slug
   * @returns {void}
   */
  function handleGetQuiz(res, slug) {
    if (slug === null) {
      sendNotFound(res);
      return;
    }
    const content = loadContent(contentDir, { repoRoot });
    const quiz = content.quizzes.find((q) => q.slug === slug);
    if (!quiz) {
      sendNotFound(res);
      return;
    }
    sendJson(res, 200, toQuizDetail(quiz));
  }

  /**
   * @param {IncomingMessage} req
   * @param {ServerResponse} res
   * @returns {Promise<void>}
   */
  async function handlePutProgress(req, res) {
    const declaredLength = Number(req.headers["content-length"]);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_PROGRESS_BODY_BYTES) {
      req.resume(); // drain so the client's write completes instead of an RST
      res.setHeader("Connection", "close");
      sendJson(res, 400, { error: "Invalid progress" });
      return;
    }

    let raw;
    try {
      raw = await readBody(req, MAX_PROGRESS_BODY_BYTES);
    } catch {
      sendJson(res, 400, { error: "Invalid progress" });
      return;
    }
    if (raw === null) {
      res.setHeader("Connection", "close");
      sendJson(res, 400, { error: "Invalid progress" });
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(raw.toString("utf8"));
    } catch {
      sendJson(res, 400, { error: "Invalid progress" });
      return;
    }

    if (!isProjectProgress(parsed)) {
      sendJson(res, 400, { error: "Invalid progress" });
      return;
    }

    try {
      store.put(contentDir, parsed);
    } catch {
      sendJson(res, 500, { error: "Progress could not be saved" });
      return;
    }

    res.statusCode = 204;
    res.end();
  }

  /**
   * @param {ServerResponse} res
   * @param {string} rawPath
   * @returns {void}
   */
  function handleGetContentFile(res, rawPath) {
    const decoded = decodePath(rawPath);
    if (decoded === null) {
      sendNotFound(res);
      return;
    }

    const resolved = path.resolve(contentDir, decoded);
    if (!resolved.startsWith(contentDir + path.sep)) {
      sendNotFound(res);
      return;
    }

    // Reject symlinks (or symlinked ancestor directories) that resolve
    // outside the content dir; text-only containment above can't catch this.
    let real;
    try {
      real = fs.realpathSync(resolved);
    } catch {
      sendNotFound(res);
      return;
    }
    if (!real.startsWith(contentDirReal + path.sep)) {
      sendNotFound(res);
      return;
    }

    let stat;
    try {
      stat = fs.statSync(real);
    } catch {
      sendNotFound(res);
      return;
    }
    if (!stat.isFile()) {
      sendNotFound(res);
      return;
    }

    const ext = path.extname(resolved).toLowerCase();
    const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";
    res.statusCode = 200;
    res.setHeader("Content-Type", contentType);
    const stream = fs.createReadStream(real);
    stream.on("error", () => {
      if (!res.headersSent) {
        sendNotFound(res);
      } else {
        res.destroy();
      }
    });
    stream.pipe(res);
  }
}
