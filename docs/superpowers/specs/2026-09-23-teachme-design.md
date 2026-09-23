# TeachMe — Design Spec

Date: 2026-09-23
Status: Draft for review

## 1. Purpose

TeachMe helps engineers understand the software they work on. Coding agents generate
**courses** and **quizzes** about a codebase as Markdown files inside that codebase; engineers
run `teachme` locally to study them in a Cursor-Academy-like UI.

Deliverables:

1. **TeachMe app** — a React + Vite web UI served by a small local Node CLI.
2. **`teachme-authoring` skill** — instructions for coding agents to create and update
   TeachMe content, grounded in the code and kept in sync via git history.

Success: an agent uses the skill on a repo and produces a course + quizzes that pass
`teachme validate`; an engineer runs `teachme` in that repo and works through them, with
progress persisted; after further commits, `teachme status` + the skill bring content back in sync.

### Constraints and decisions

- Runs locally only; single user; no accounts; no database. All content is Markdown files.
- Content lives in the documented repo, default folder `.teachme/` (versioned with the code).
- Progress is stored in `~/.TeachMe/progress.json`.
- Distributed as a CLI (`teachme`), installed via `npm i -g` / `npm link` from this repo.
- Mermaid diagrams in Markdown must render.
- Quiz answers are shipped to the browser (learning tool, not an exam).

### Out of scope

Search, in-app editing, free-text quiz answers, section nesting deeper than one level,
multi-user / hosted deployment, inline quiz blocks inside lesson pages.

## 2. Content format

### 2.1 Folder layout

```
.teachme/
  courses/
    <course-slug>/
      course.md
      01-<page>.md
      02-<section>/            # optional: one level of sections
        _section.md            # optional
        01-<page>.md
      03-<page>.md
  quizzes/
    <quiz-slug>/
      quiz.md
      01-<question>.md         # one question per file
```

- **Ordering:** by numeric filename prefix (`NN-`). Files/folders without a prefix sort after
  prefixed ones, alphabetically.
- **Slugs:** folder name for courses/quizzes; filename without prefix and `.md` for pages
  and questions (e.g. `02-first-request.md` → `first-request`). Page URLs inside sections are
  `<section-slug>/<page-slug>`.
- Files starting with `_` (other than `_section.md`) and non-`.md` files are ignored for
  structure but may be referenced (e.g. images via relative links).
- All frontmatter is YAML.

### 2.2 `course.md`

```yaml
---
title: Architecture overview      # required
description: How requests flow…   # optional, shown on the home card
duration: 25 min                  # optional, free text
order: 1                          # optional, home-screen sort (then title)
quiz: architecture-final          # optional, final course quiz (quiz slug)
syncedCommit: 3f2a9c1             # optional, commit the content was last synced to
---
Markdown body shown on the course landing page.
```

### 2.3 `_section.md`

```yaml
---
title: Getting started            # optional, overrides humanized folder name
quiz: getting-started-check       # optional, quiz shown at the end of this section
---
```

Body is ignored. Without `_section.md`, the section title is the folder name without prefix,
hyphens replaced by spaces, first letter capitalized.

### 2.4 Page file

```yaml
---
title: First request                          # optional; fallback: first "# H1", then filename
sources:                                      # optional; repo-relative paths this page explains
  - src/server/router.ts
  - src/orders/service.ts
---
GitHub-flavored Markdown. ```mermaid blocks render as diagrams.
```

If the title is taken from the first `# H1`, that heading is not rendered twice.

### 2.5 `quiz.md`

```yaml
---
title: Architecture basics        # required
description: Check your…          # optional
passingScore: 70                  # optional, percent, default 70
course: architecture-overview     # optional, related course (linked from standalone results)
syncedCommit: 3f2a9c1             # optional
---
Markdown intro shown on the quiz start screen.
```

### 2.6 Question file

```md
---
title: Payment failure handling   # optional, label in results list
sources: [src/orders/service.ts]  # optional
---
What does `OrderService` do when a payment fails?

(optional context: code, mermaid)

## Options
- [ ] Retries the charge until it succeeds
- [x] Marks the order `PAYMENT_FAILED` and emits `order.failed`
- [ ] Deletes the order

## Explanation
Shown after answering. See `src/orders/service.ts` → `handlePaymentError()`.
```

Rules:

- Prompt = everything before the `## Options` heading.
- Options = the task-list items directly under `## Options`; each item is inline Markdown
  (single line). `[x]`/`[X]` = correct.
- Exactly one correct → single-choice (radio). More than one → multi-select (checkbox); the
  answer is correct only if the selected set equals the correct set.
- `## Explanation` is optional; its body is shown after the user checks the answer.
- Requirements: at least 2 options, at least 1 correct.

### 2.7 Quizzes inside courses

- `_section.md` `quiz:` → quiz appears as the last TOC item of that section.
- `course.md` `quiz:` → quiz appears as the last TOC item of the course ("Final quiz").
- A quiz is defined once under `quizzes/` and can be referenced from any number of places and
  also taken standalone.

### 2.8 Validation rules (`teachme validate`)

Errors (exit code 1):
- Missing/invalid YAML frontmatter; `course.md`/`quiz.md` missing or without `title`.
- Course with no pages; quiz with no questions.
- Question without `## Options`, with < 2 options, or with no correct option.
- `quiz:` reference to a non-existent quiz slug; `course:` reference to a non-existent course.
- Duplicate slugs within the same scope.
- `passingScore` not a number in 0–100.

Warnings (exit code 0):
- `sources:` path that does not exist in the repo.
- Empty ```mermaid block. (Mermaid syntax is not parsed in Node — it needs a DOM; syntax
  errors surface in the UI's inline error box, and the skill's `reference/mermaid.md` covers
  common pitfalls.)
- Relative image link to a missing file.

The server uses the same loader: errors don't crash it; broken items are omitted and all
errors/warnings are returned to the UI.

## 3. CLI

```
teachme [dir]            # serve; dir defaults to ./.teachme
  --port <n>             # default 4321, falls back to next free port
  --no-open              # don't open the browser
teachme validate [dir]   # validate content; prints errors/warnings; exit 1 on errors
teachme status [dir]     # git-based staleness report (see §6)
```

- **Repo root** = `git rev-parse --show-toplevel` from the content dir; if not a git repo,
  the content dir's parent. Used for resolving `sources:` and editor links.
- Server binds to `127.0.0.1` only.

## 4. Architecture

```
teachme/
  bin/teachme.js           CLI arg parsing, dispatch to serve/validate/status
  server/
    content.js             loadContent(dir) → { catalog, courses, quizzes, errors, warnings }
    quizParser.js          parseQuestion(md) → { prompt, options[{md, correct}], multi, explanation }
    progress.js            load/save ~/.TeachMe/progress.json (atomic: temp file + rename)
    git.js                 git helpers for status (changed files, renames since commit)
    status.js              staleness report built from content + git
    api.js                 createHandler({ contentDir, repoRoot }) → (req, res, next)
    serve.js               http server: api handler + static dist/ with SPA fallback
  src/                     React app (Vite, react-router, TypeScript)
    api.ts
    pages/Home.tsx, CourseView.tsx, QuizView.tsx
    components/Markdown.tsx, Mermaid.tsx, Toc.tsx, Pager.tsx, QuizRunner.tsx,
               QuizResults.tsx, ErrorBanner.tsx, ThemeToggle.tsx, SourcesFooter.tsx
  vite.config.ts           dev plugin mounting api.js as middleware (content dir from TEACHME_DIR)
  skill/teachme-authoring/ skill (see §7)
```

Server is plain Node (`node:http`), ESM JavaScript with JSDoc types; no framework.
Dependencies: `gray-matter` (frontmatter), `open` (browser). Frontend: `react`,
`react-router-dom`, `react-markdown`, `remark-gfm`, `shiki`, `mermaid`.

### 4.1 API

| Method | Path | Returns |
|---|---|---|
| GET | `/api/catalog` | project name, course summaries (slug, title, description, duration, page count), quiz summaries, errors, warnings |
| GET | `/api/courses/:slug` | course meta, intro body, TOC: ordered items `{type: 'page'\|'quiz', path, title, section?}` |
| GET | `/api/courses/:slug/pages/*` | page `{title, body, sources[], prev, next}` (prev/next include quiz items) |
| GET | `/api/quizzes/:slug` | quiz meta, intro, questions (parsed, with correct flags + explanations) |
| GET | `/api/progress` | progress for this content dir |
| PUT | `/api/progress` | replace progress for this content dir |
| GET | `/content/*` | static files from the content dir (images) |

- Content is re-read from disk on each request (fresh after regeneration; no watcher).
- All path parameters are resolved and checked to stay within the content dir (404 otherwise).
- Page bodies are sent as raw Markdown; rendering happens in the browser. Relative image URLs
  are rewritten client-side to `/content/<resolved path>`.

### 4.2 Progress file

`~/.TeachMe/progress.json`:

```json
{
  "version": 1,
  "projects": {
    "/abs/path/to/repo/.teachme": {
      "courses": {
        "architecture-overview": { "visited": ["introduction", "getting-started/setup"], "lastPage": "getting-started/setup" }
      },
      "quizzes": {
        "architecture-basics": {
          "attempts": [
            { "context": "standalone", "date": "2026-09-23T10:00:00Z", "score": 7, "total": 8, "answers": { "request-flow": [1] } }
          ]
        }
      }
    }
  }
}
```

- `context` is `"standalone"` or `"course:<slug>"`.
- Missing or corrupt file → treated as empty (corrupt file is backed up to `progress.json.bak`).
- Keyed by absolute content dir so multiple repos don't collide.

## 5. UI

Visual direction: Cursor Academy — dark by default, typographic, calm, narrow reading column
(~720px), minimal chrome, one accent color. Light theme via toggle; default follows OS.
Theme choice stored in localStorage.

### 5.1 Home (`/`)

Header: "TeachMe · <repo name>", theme toggle. Sections "Courses" (cards: title, description,
lesson count, duration, progress bar, Start/Continue → resumes `lastPage`) and "Quizzes"
(rows: title, question count, best score, pass mark).

### 5.2 Course (`/courses/:slug` and `/courses/:slug/*`)

- Left sidebar (TOC): "← All courses", course title, progress %; items grouped by section
  headers; states ✓ visited, ● current, ○ unvisited, ◇ quiz (shows score when attempted,
  subtle marker when failed). Collapsible; drawer on narrow screens.
- `/courses/:slug` shows the course landing (intro body + Start/Continue).
- Main: breadcrumb "Section · Lesson N of M", rendered page, Sources footer, pager.
- Pager: "← <prev title>" and "<next title> →"; ← / → keyboard shortcuts (ignored while
  focus is in an input).
- Visiting a page marks it visited. Progress % = (visited pages + attempted quizzes) / total items.
- Quiz items open the QuizRunner inline (TOC stays); results page offers **Continue** to the
  next TOC item.

### 5.3 Quiz (`/quizzes/:slug`, and inline in courses)

QuizRunner states:
1. **Start**: title, intro, question count, passing score, Start.
2. **Question**: "Question N of M" + thin progress bar; prompt; option cards (radio for
   single, checkbox + "Select all that apply" for multi); **Check answer** (disabled until a
   selection) → options marked correct/incorrect, explanation revealed → **Next** / **See results**.
3. **Results**: score and pass/fail vs `passingScore`; list of questions ✓/✗, expandable to
   show the user's answer, correct answer, explanation; **Retry**; **Continue** (in course) or
   **Back to home** + related-course link (standalone). Attempt saved on reaching results.

### 5.4 Rendering

- `react-markdown` + `remark-gfm`; code blocks highlighted with Shiki (theme follows app theme).
- ```mermaid blocks rendered by `Mermaid` component (lazy-loaded mermaid, theme follows app
  theme); render failure shows an inline error box with the source; rest of page unaffected.
- Sources footer: list of `sources:` paths as `vscode://file/<repoRoot>/<path>` links.
- ErrorBanner: dismissible; lists content errors/warnings (file + message) from the catalog.

## 6. Keeping content in sync (git-based)

`course.md` and `quiz.md` carry `syncedCommit`. `teachme status [dir]`:

1. For each course/quiz with `syncedCommit`, runs
   `git log --name-status --format=... <syncedCommit>..HEAD` (repo root) to collect changed
   files, including renames (`R`) and deletions (`D`). Items without `syncedCommit` are
   reported as "never synced". Unknown commit → reported as error for that item.
2. Reports:
   - **Stale pages/questions**: whose `sources:` include a modified file, listing the
     commits (short sha + subject) that touched it.
   - **Broken sources**: `sources:` entries deleted or renamed (with the new path for renames).
   - **Uncovered changes**: changed files not referenced by any `sources:` in that course
     (excluding the `.teachme/` folder itself), grouped by top-level directory.
3. Output: human-readable text by default; `--json` for agents. Exit code 0 always
   (it's a report, not a check).

Changes under `.teachme/` itself are ignored.

## 7. The `teachme-authoring` skill

```
skill/teachme-authoring/
  SKILL.md               triggers, create workflow, update workflow, quality rules
  reference/format.md    full content format (§2) — single source of truth for agents
  reference/mermaid.md   mermaid guidance: which diagram types, quoting labels, common parse errors
  examples/.teachme/     complete example: 1 course with a section, section quiz, final quiz
```

Install: copy or symlink into `~/.claude/skills/` or `<repo>/.claude/skills/`; README
documents this. Plain Markdown so other agents can be pointed at it.

**Triggers:** "create a course/quiz about X", "onboarding material for this repo", "explain
this module for new engineers", "update the TeachMe content", and after the agent completes
significant changes in a repo that has `.teachme/` (run the update workflow for affected content).

### 7.1 Create workflow

1. **Scope** — topic, audience (new hire vs. experienced engineer new to this area), size.
   Default: 5–12 lessons of 3–7 minutes, one quiz per section, one final quiz.
2. **Investigate** — read entry points, trace 1–2 real flows end-to-end, list key files.
   No writing before this.
3. **Outline** — sections, lessons, one learning goal per lesson; show it to the user for
   courses over ~8 lessons.
4. **Write lessons** — why it matters → how the code does it; real file paths and short real
   excerpts only; mermaid diagrams where a flow/sequence/relationship is involved; end with
   "Key takeaways"; fill `sources:`.
5. **Write quizzes** — test understanding ("what happens when…", "where would you change…"),
   plausible distractors, explanations cite file/function; 4–8 questions per section quiz,
   8–15 for the final quiz; link via `quiz:` frontmatter.
6. **Stamp and validate** — set `syncedCommit` to `git rev-parse --short HEAD`; run
   `teachme validate`; fix all errors; re-check every factual claim and path against the code.

### 7.2 Update workflow

1. Run `teachme status --json`.
2. For each stale item, read the relevant commits
   (`git log -p <syncedCommit>..HEAD -- <files>`) including commit messages, to understand
   what changed and why.
3. Rewrite affected lessons and quiz questions (including options and explanations that are
   now wrong); fix renamed/deleted `sources:`.
4. For uncovered changes that introduce significant new behavior, propose new lessons or
   questions to the user (don't silently add large content).
5. Bump `syncedCommit` on every course/quiz that was reviewed; run `teachme validate`.

## 8. Error handling summary

| Situation | Behavior |
|---|---|
| Content dir missing | CLI prints a message suggesting the skill / `--help`; exit 1 |
| Invalid content file | Item omitted, error listed in CLI output and UI banner |
| Mermaid render failure | Inline error box with source |
| Progress file corrupt | Backed up to `.bak`, start fresh |
| Progress write fails | UI shows a non-blocking toast; app keeps working |
| Port in use | Try next port |
| Not a git repo (status) | `status` exits 1 with a clear message; serve/validate unaffected |

## 9. Testing

- **Vitest (server):** content loader (ordering, slugs, sections, title fallbacks, quiz
  references, validation errors), quiz parser (single/multi, missing options, explanation),
  progress (atomic write, corrupt file), status (against a temp git repo with commits, renames,
  deletions), API path-traversal protection.
- **Vitest + Testing Library (UI):** TOC states, pager/keyboard navigation, QuizRunner
  (single/multi scoring, check/next/results flow), Mermaid error fallback.
- **Smoke:** run `teachme validate` on `skill/teachme-authoring/examples/.teachme`; start the
  server against it and fetch `/api/catalog`.
- **Dogfood:** use the skill to generate a course about TeachMe itself in this repo's `.teachme/`.
