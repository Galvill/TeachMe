# TeachMe A: Core Server Implementation Plan

**Spec:** `docs/superpowers/specs/2026-09-23-teachme-design.md`, sections 2, 3, 4, 8.
**Goal:** `teachme validate` checks a `.teachme/` folder and `teachme` serves the JSON API plus a placeholder React page.
**Constraints:** the spec's `## Constraints` section applies. Additionally:
- `.claude/agents/coder.md` does not exist yet; the verification suite is the line below.
**Verification:** `npm run typecheck && npm test && npm run build`.

## File structure

| File | Responsibility |
|---|---|
| `package.json` | name `teachme`, `"type": "module"`, `bin.teachme`, scripts `dev build test typecheck` |
| `vite.config.ts` | React plugin + dev middleware plugin mounting `createHandler` |
| `vitest.config.ts` | node environment default; UI tests opt into jsdom per file |
| `tsconfig.json`, `tsconfig.app.json`, `tsconfig.server.json` | app TS; server `allowJs`+`checkJs` over `server/`, `bin/`, `shared/` |
| `index.html`, `src/main.tsx`, `src/App.tsx` | placeholder app Plan B replaces |
| `shared/types.d.ts` | content, API and progress types |
| `server/quizParser.js` | question Markdown → parsed question |
| `server/content.js` | `loadContent`: folder → content model + issues |
| `server/progress.js` | progress file store |
| `server/git.js` | `resolveRepoRoot` (Plan C adds history helpers) |
| `server/api.js` | request handler for `/api/*` and `/content/*` |
| `server/serve.js` | HTTP server, static `dist/`, SPA fallback, port fallback |
| `bin/teachme.js` | CLI: serve, validate |
| `test/helpers.js` | `writeTree(files)` temp-dir builder |
| `skill/teachme-authoring/examples/.teachme/**` | example content, also the smoke fixture |
| `server/*.test.js`, `test/cli.test.js` | tests |

### Task 1: Scaffold

**Files:**
- Create: `package.json`, `vite.config.ts`, `vitest.config.ts`, `tsconfig*.json`, `index.html`, `src/main.tsx`, `src/App.tsx`, `.gitignore`
- Test: `src/App.test.tsx`

**Interfaces:**
- Produces: scripts `dev` (vite), `build` (vite build → `dist/`), `test` (vitest run), `typecheck` (tsc on both projects).

**Behavior:**
- `npm run build` emits `dist/index.html`.
- `App` renders the text `TeachMe`.
- Dependencies: `gray-matter`, `open` (runtime); `react`, `react-dom`, `react-router`, `react-markdown`, `remark-gfm`, `shiki`, `mermaid`, `vite`, `@vitejs/plugin-react`, `typescript`, `vitest`, `jsdom`, `@testing-library/react`, `@types/node` (dev).

**Tests:**
- `App renders title`: `render(<App/>)` contains `TeachMe`.

**Gotchas:**
- UI test files start with `// @vitest-environment jsdom`; `environmentMatchGlobs` is deprecated.
- Frontend libraries are devDependencies because they end up bundled into `dist/`; `files` in `package.json` includes `bin server shared dist skill`.

### Task 2: Quiz parser

**Files:**
- Create: `server/quizParser.js`, `shared/types.d.ts` (with `ParsedQuestion`)
- Test: `server/quizParser.test.js`

**Interfaces:**
- Produces: `parseQuestion(body: string): ParsedQuestion`

```ts
export type ParsedQuestion = {
  prompt: string; options: { md: string; correct: boolean }[];
  multi: boolean; explanation: string | null; errors: string[];
};
```

**Behavior:**
- Prompt = trimmed text before the first level-2 heading `Options` (case-insensitive).
- Options: lines `- [ ] text` / `- [x] text` / `- [X] text` until the next level-2 heading; blank lines skipped; any other line → error `Unexpected line in Options: "<line>"`.
- No Options heading → error `Missing "## Options" section`; < 2 options → `Needs at least 2 options`; 0 correct → `No correct option marked`.
- `multi` = correct count > 1.
- `## Explanation` body trimmed; absent → `null`.

**Tests:**
- `single choice`: spec §2.6 example → 3 options, 1 correct, `multi` false, explanation set.
- `multi select`: two `[x]` → `multi` true.
- `missing options`, `one option`, `no correct`, `stray line`: each yields its exact error.
- `headings in code fences ignored`: `## Options` inside a ``` fence in the prompt is not the section.

### Task 3: Content loader

**Files:**
- Create: `server/content.js`, `test/helpers.js`
- Modify: `shared/types.d.ts` (add the types below)
- Test: `server/content.test.js`

**Interfaces:**
- Consumes: `parseQuestion` (Task 2).
- Produces: `loadContent(contentDir: string, opts: { repoRoot: string }): Content`, `writeTree(files: Record<string,string>): string` (returns temp dir).

```ts
export type Issue = { file: string; message: string };   // file relative to contentDir, posix
export type TocItem = { type: 'page' | 'quiz'; path: string; title: string; section: string | null; quizSlug?: string };
export type Page = { path: string; title: string; body: string; sources: string[]; file: string };
export type Question = Omit<ParsedQuestion, 'errors'> & { slug: string; title: string; sources: string[]; file: string };
export type Course = { slug: string; title: string; description: string; duration: string | null; order: number | null;
  quiz: string | null; syncedCommit: string | null; intro: string; toc: TocItem[]; pages: Record<string, Page>; file: string };
export type Quiz = { slug: string; title: string; description: string; passingScore: number; course: string | null;
  syncedCommit: string | null; intro: string; questions: Question[]; file: string };
export type Content = { courses: Course[]; quizzes: Quiz[]; errors: Issue[]; warnings: Issue[] };
```

**Behavior:**
- Ordering and slugs per spec §2.1; page `path` inside a section is `<section-slug>/<page-slug>`.
- Page title: frontmatter → first `# H1` (removed from `body`) → humanized slug.
- Quiz TOC item: `path` `_quiz/<quizSlug>`, `title` = quiz title, `section` = section title or `null` for the course quiz, which is last.
- Courses sorted by `order` (missing last) then title.
- Missing `courses/` or `quizzes/` folder → empty lists.

**Tests:**
- `orders and slugs`, `sections and section titles`, `title fallbacks`, `section and final quiz in toc`, `course sort order`: each asserts the item shape.

**Gotchas:**
- gray-matter caches parses by input string; pass `{}` as options to avoid stale results across tests.

### Task 4: Validation and example content

**Files:**
- Modify: `server/content.js`
- Create: `skill/teachme-authoring/examples/.teachme/**`
- Test: `server/validation.test.js`

**Interfaces:**
- Consumes: `loadContent`, `writeTree` (Task 3).

**Behavior:**
- Every spec §2.8 error → `errors` as `{ file, message }`; offending page/question/TOC item omitted; course with 0 pages or quiz with 0 questions omitted; question parse errors carried over from `parseQuestion`.
- Warnings: `sources:` path missing under `repoRoot`, empty mermaid block, relative image not found.
- Example content: 1 course (a top-level page, a section with 2 pages incl. a mermaid block, `_section.md` with `quiz:`, course `quiz:`), the section quiz with a multi-select question, the final quiz; `sources:` point at real files in this repo.

**Tests:**
- `missing quiz reference`, `missing course reference`, `bad frontmatter`, `missing title`, `passingScore out of range`, `duplicate slug`, `empty course omitted`, `invalid question omitted`, `warnings`: each asserts the exact issue and the omission.
- `example content is clean`: example folder → 0 errors, 0 warnings.

### Task 5: Progress store

**Files:**
- Create: `server/progress.js`
- Test: `server/progress.test.js`

**Interfaces:**
- Produces: `createProgressStore(opts?: { dir?: string }): { get(key: string): ProjectProgress; put(key: string, p: ProjectProgress): void }`; `isProjectProgress(x: unknown): boolean`.

```ts
export type Attempt = { context: 'standalone' | `course:${string}`; date: string; score: number; total: number; answers: Record<string, number[]> };
export type ProjectProgress = {
  courses: Record<string, { visited: string[]; lastPage: string | null }>;
  quizzes: Record<string, { attempts: Attempt[] }>;
};
```

**Behavior:**
- `dir` defaults to `$TEACHME_HOME` or `~/.TeachMe`; created on first `put`.
- Unknown key → `{ courses: {}, quizzes: {} }`.
- `put` writes `progress.json.tmp` then renames; other projects' entries are kept.
- Corrupt JSON → renamed to `progress.json.bak`, treated as empty.

**Tests:**
- `roundtrip`, `keeps other projects`, `corrupt file backed up`, `isProjectProgress rejects missing courses`.

### Task 6: API handler

**Files:**
- Create: `server/api.js`, `server/git.js`
- Test: `server/api.test.js`

**Interfaces:**
- Consumes: `loadContent`, `createProgressStore`.
- Produces: `createHandler(opts: { contentDir: string; repoRoot: string; store: ProgressStore }): (req, res, next?: () => void) => void`; `resolveRepoRoot(contentDir: string): string`.

```ts
export type CourseSummary = { slug: string; title: string; description: string; duration: string | null; pageCount: number; quizzes: string[] };
export type QuizSummary = { slug: string; title: string; description: string; questionCount: number; passingScore: number };
export type Catalog = { project: string; repoRoot: string; courses: CourseSummary[]; quizzes: QuizSummary[]; errors: Issue[]; warnings: Issue[] };
export type CourseDetail = Omit<Course, 'pages' | 'file' | 'order' | 'syncedCommit'>;
export type PageDetail = Page;   // UI needs `file` to resolve relative images
export type QuizDetail = Omit<Quiz, 'file' | 'syncedCommit' | 'questions'> & { questions: Omit<Question, 'file' | 'sources'>[] };
```

**Behavior:**
- Spec §4.1 routes return the types above; `project` = basename of `repoRoot`.
- Unknown slug/page → 404 `{ error: "Not found" }`; PUT body failing `isProjectProgress` → 400; store write failure → 500.
- `/content/<p>` serves files with a content type by extension; `..` or encoded escapes → 404.
- Other paths → `next()` if given, else 404.
- Progress key = absolute `contentDir`.
- `resolveRepoRoot`: `git rev-parse --show-toplevel` in `contentDir`; failure → parent of `contentDir`.

**Tests:**
- `catalog`, `course detail`, `section page`, `quiz detail hides file`, `404s`, `progress put and get`, `put rejects bad body`, `content file served`, `traversal blocked` (`/content/..%2Fpackage.json` → 404).

**Gotchas:**
- Test via `node:http` on port 0 and `fetch`; no supertest.

### Task 7: Server and CLI

**Files:**
- Create: `server/serve.js`, `bin/teachme.js`
- Modify: `vite.config.ts` (dev plugin)
- Test: `test/cli.test.js`

**Interfaces:**
- Produces: `startServer(opts: { contentDir: string; repoRoot: string; port?: number; distDir: string }): Promise<{ url: string; close(): Promise<void> }>`; `formatIssues(content: Content): string`.

**Behavior:**
- Binds `127.0.0.1`; `EADDRINUSE` → next port, up to 20 tries; default 4321.
- Non-API GET: file from `distDir`, else `index.html`.
- `teachme [dir] [--port n] [--no-open]`: dir default `./.teachme`; missing dir → stderr `No TeachMe content at <dir>. Create it with the teachme-authoring skill.`, exit 1; prints URL; opens browser unless `--no-open`.
- `teachme validate [dir]`: lines `ERROR <file>: <msg>` / `WARN <file>: <msg>`, then `N errors, M warnings`; exit 1 iff errors.
- Dev plugin: `TEACHME_DIR` env, default example content.

**Tests:**
- `validate example exits 0`, `validate broken exits 1 and prints ERROR`, `missing dir exits 1`, `serve answers catalog` (`--no-open --port 0`, fetch `/api/catalog`), `spa fallback` (`/courses/x` → HTML).

**Gotchas:**
- Parse args with `node:util` `parseArgs`; `--no-open` needs `allowNegative: true` (Node ≥ 22.4) or define an `open` boolean defaulting to true and treat `--no-open` manually.

## Coverage

Spec sections: Constraints, 2.1–2.8, 3, 4, 4.1, 4.2, 8 (server rows), 9 (server tests, smoke).
