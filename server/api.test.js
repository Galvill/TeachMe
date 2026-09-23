import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHandler } from "./api.js";
import { createProgressStore } from "./progress.js";
import { writeTree } from "../test/helpers.js";

/**
 * @param {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void} handler
 * @returns {Promise<{ server: import('node:http').Server; baseUrl: string }>}
 */
function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const address = /** @type {import('node:net').AddressInfo} */ (server.address());
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

/**
 * @param {import('node:http').Server} server
 * @returns {Promise<void>}
 */
function stopServer(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("api handler", () => {
  /** @type {string} */
  let dir;
  /** @type {string} */
  let contentDir;
  /** @type {import('node:http').Server} */
  let server;
  /** @type {string} */
  let baseUrl;
  /** @type {string} */
  let progressDir;

  beforeAll(async () => {
    dir = writeTree({
      ".teachme/courses/arch/course.md":
        "---\ntitle: Architecture\nquiz: arch-quiz\n---\nIntro to architecture.\n",
      ".teachme/courses/arch/01-setup.md": "---\ntitle: Setup\n---\nSetup body.\n",
      ".teachme/courses/arch/02-getting-started/_section.md": "---\ntitle: Getting started\n---\n",
      ".teachme/courses/arch/02-getting-started/01-first-request.md":
        "---\ntitle: First request\n---\nFirst request body.\n",
      ".teachme/quizzes/arch-quiz/quiz.md":
        "---\ntitle: Architecture Quiz\ncourse: arch\npassingScore: 80\n---\nQuiz intro.\n",
      ".teachme/quizzes/arch-quiz/01-q1.md": `What does the service do?

## Options
- [ ] Nothing
- [x] Something
- [ ] Everything

## Explanation
It does something.
`,
    });
    contentDir = path.join(dir, ".teachme");
    fs.mkdirSync(path.join(contentDir, "images"), { recursive: true });
    fs.writeFileSync(path.join(contentDir, "images", "logo.png"), PNG_BYTES);

    progressDir = fs.mkdtempSync(path.join(os.tmpdir(), "teachme-progress-"));
    const store = createProgressStore({ dir: progressDir });
    const handler = createHandler({ contentDir, repoRoot: dir, store });

    ({ server, baseUrl } = await startServer(handler));
  });

  afterAll(async () => {
    await stopServer(server);
  });

  it("catalog", async () => {
    const res = await fetch(`${baseUrl}/api/catalog`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    const body = /** @type {any} */ (await res.json());

    expect(body.project).toBe(path.basename(dir));
    expect(body.repoRoot).toBe(dir);
    expect(body.errors).toEqual([]);
    expect(body.warnings).toEqual([]);
    expect(body.courses).toEqual([
      {
        slug: "arch",
        title: "Architecture",
        description: "",
        duration: null,
        pageCount: 2,
        quizzes: ["arch-quiz"],
      },
    ]);
    expect(body.quizzes).toEqual([
      {
        slug: "arch-quiz",
        title: "Architecture Quiz",
        description: "",
        questionCount: 1,
        passingScore: 80,
      },
    ]);
  });

  it("course detail", async () => {
    const res = await fetch(`${baseUrl}/api/courses/arch`);
    expect(res.status).toBe(200);
    const body = /** @type {any} */ (await res.json());

    expect(body).toEqual({
      slug: "arch",
      title: "Architecture",
      description: "",
      duration: null,
      quiz: "arch-quiz",
      intro: "Intro to architecture.",
      toc: [
        { type: "page", path: "setup", title: "Setup", section: null },
        {
          type: "page",
          path: "getting-started/first-request",
          title: "First request",
          section: "Getting started",
        },
        { type: "quiz", path: "_quiz/arch-quiz", title: "Architecture Quiz", section: null, quizSlug: "arch-quiz" },
      ],
    });
    expect(body.pages).toBeUndefined();
    expect(body.file).toBeUndefined();
    expect(body.order).toBeUndefined();
    expect(body.syncedCommit).toBeUndefined();
  });

  it("section page", async () => {
    const res = await fetch(`${baseUrl}/api/courses/arch/pages/getting-started/first-request`);
    expect(res.status).toBe(200);
    const body = /** @type {any} */ (await res.json());

    expect(body).toEqual({
      path: "getting-started/first-request",
      title: "First request",
      body: "First request body.\n",
      sources: [],
      file: "courses/arch/02-getting-started/01-first-request.md",
    });
  });

  it("quiz detail hides file", async () => {
    const res = await fetch(`${baseUrl}/api/quizzes/arch-quiz`);
    expect(res.status).toBe(200);
    const body = /** @type {any} */ (await res.json());

    expect(body).toEqual({
      slug: "arch-quiz",
      title: "Architecture Quiz",
      description: "",
      passingScore: 80,
      course: "arch",
      intro: "Quiz intro.",
      questions: [
        {
          prompt: "What does the service do?",
          options: [
            { md: "Nothing", correct: false },
            { md: "Something", correct: true },
            { md: "Everything", correct: false },
          ],
          multi: false,
          explanation: "It does something.",
          slug: "q1",
          title: "Q1",
        },
      ],
    });
    expect(body.file).toBeUndefined();
    expect(body.syncedCommit).toBeUndefined();
    expect(body.questions[0].file).toBeUndefined();
    expect(body.questions[0].sources).toBeUndefined();
  });

  it("404s for unknown course, page, quiz, and api route", async () => {
    const course = await fetch(`${baseUrl}/api/courses/nope`);
    expect(course.status).toBe(404);
    expect(await course.json()).toEqual({ error: "Not found" });

    const page = await fetch(`${baseUrl}/api/courses/arch/pages/nope`);
    expect(page.status).toBe(404);
    expect(await page.json()).toEqual({ error: "Not found" });

    const quiz = await fetch(`${baseUrl}/api/quizzes/nope`);
    expect(quiz.status).toBe(404);
    expect(await quiz.json()).toEqual({ error: "Not found" });

    const other = await fetch(`${baseUrl}/api/nope`);
    expect(other.status).toBe(404);
    expect(await other.json()).toEqual({ error: "Not found" });

    const wrongMethod = await fetch(`${baseUrl}/api/catalog`, { method: "POST" });
    expect(wrongMethod.status).toBe(404);
    expect(await wrongMethod.json()).toEqual({ error: "Not found" });
  });

  it("progress put and get", async () => {
    const empty = await fetch(`${baseUrl}/api/progress`);
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ courses: {}, quizzes: {} });

    const progress = {
      courses: { arch: { visited: ["setup"], lastPage: "setup" } },
      quizzes: {},
    };
    const put = await fetch(`${baseUrl}/api/progress`, {
      method: "PUT",
      body: JSON.stringify(progress),
    });
    expect(put.status).toBe(204);

    const get = await fetch(`${baseUrl}/api/progress`);
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual(progress);
  });

  it("put rejects bad body", async () => {
    const invalidJson = await fetch(`${baseUrl}/api/progress`, {
      method: "PUT",
      body: "{not json",
    });
    expect(invalidJson.status).toBe(400);
    expect(await invalidJson.json()).toEqual({ error: "Invalid progress" });

    const wrongShape = await fetch(`${baseUrl}/api/progress`, {
      method: "PUT",
      body: JSON.stringify({ nope: true }),
    });
    expect(wrongShape.status).toBe(400);
    expect(await wrongShape.json()).toEqual({ error: "Invalid progress" });
  });

  it("content file served", async () => {
    const res = await fetch(`${baseUrl}/content/images/logo.png`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.equals(PNG_BYTES)).toBe(true);
  });

  it("traversal blocked", async () => {
    const encoded = await rawGet(baseUrl, "/content/..%2Fpackage.json");
    expect(encoded.status).toBe(404);

    const literal = await rawGet(baseUrl, "/content/../package.json");
    expect(literal.status).toBe(404);
  });

  it("symlink escape blocked", async () => {
    const secretPath = path.join(dir, "secret.txt");
    fs.writeFileSync(secretPath, "shh");
    fs.symlinkSync(secretPath, path.join(contentDir, "escape.txt"));

    const res = await fetch(`${baseUrl}/content/escape.txt`);
    expect(res.status).toBe(404);
  });

  it("unreadable content file returns 404 without crashing the server", async () => {
    const filePath = path.join(contentDir, "images", "secret.png");
    fs.writeFileSync(filePath, PNG_BYTES);
    fs.chmodSync(filePath, 0o000);

    try {
      const res = await fetch(`${baseUrl}/content/images/secret.png`);
      expect(res.status).toBe(404);
    } finally {
      fs.chmodSync(filePath, 0o644);
    }

    // The server must still be responsive after a stream error.
    const followUp = await fetch(`${baseUrl}/api/catalog`);
    expect(followUp.status).toBe(200);
  });

  it("put rejects oversized body with a normal 400, not a connection reset", async () => {
    const bigBody = JSON.stringify({
      courses: {},
      quizzes: {},
      padding: "x".repeat(2 * 1024 * 1024),
    });
    expect(bigBody.length).toBeGreaterThan(1024 * 1024);

    const res = await fetch(`${baseUrl}/api/progress`, { method: "PUT", body: bigBody });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid progress" });

    // The server must still be responsive afterwards.
    const followUp = await fetch(`${baseUrl}/api/catalog`);
    expect(followUp.status).toBe(200);
  });

  it("store.get throwing returns 500 instead of crashing", async () => {
    /** @type {import('../shared/types.js').ProgressStore} */
    const throwingStore = {
      get() {
        throw new Error("boom");
      },
      put() {},
    };
    const { server: s, baseUrl: url } = await startServer(
      createHandler({ contentDir, repoRoot: dir, store: throwingStore }),
    );
    try {
      const res = await fetch(`${url}/api/progress`);
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "Internal error" });
    } finally {
      await stopServer(s);
    }
  });

  it("store put failure returns 500 without crashing", async () => {
    /** @type {import('../shared/types.js').ProgressStore} */
    const throwingStore = {
      get() {
        return { courses: {}, quizzes: {} };
      },
      put() {
        throw new Error("boom");
      },
    };
    const { server: s, baseUrl: url } = await startServer(
      createHandler({ contentDir, repoRoot: dir, store: throwingStore }),
    );
    try {
      const res = await fetch(`${url}/api/progress`, {
        method: "PUT",
        body: JSON.stringify({ courses: {}, quizzes: {} }),
      });
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "Progress could not be saved" });
    } finally {
      await stopServer(s);
    }
  });
});

/**
 * Issue a GET with a raw, unnormalized request path (`fetch`/`URL` collapse
 * `..` segments before the request is even sent).
 * @param {string} baseUrl
 * @param {string} rawPath
 * @returns {Promise<{ status: number }>}
 */
function rawGet(baseUrl, rawPath) {
  const { hostname, port } = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname, port, path: rawPath, method: "GET" },
      (res) => {
        res.resume();
        res.on("end", () => resolve({ status: /** @type {number} */ (res.statusCode) }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}
