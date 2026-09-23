---
name: teachme-authoring
description: Use when asked to create a course, lesson or quiz about a codebase, to write onboarding material for a repo, to explain a module or flow for new engineers, or to update TeachMe content; also use after finishing significant code changes in a repo that has a .teachme/ folder.
---

# TeachMe authoring

TeachMe turns Markdown under `.teachme/` in a repo into courses and quizzes that engineers
study in a local app. You write that Markdown. Every claim must be true of the code at a
recorded commit, so that `teachme status` can later tell which lessons went stale.

**Core rule: read the code first, write second, and verify every path and claim before you
finish.** A course with one invented path or wrong quiz answer teaches the wrong thing.

## When to use

- "Create a course / quiz about X", "onboarding material for this repo", "explain this
  module for new engineers" → **Create workflow**.
- "Update the TeachMe content", or `teachme status` reports stale items → **Update workflow**.
- You just finished significant code changes (new behavior, renamed or deleted files,
  changed flows) in a repo that has `.teachme/` → **Update workflow** for the affected
  content. Skip it for formatting-only or test-only changes.

## Files in this skill

| Path | Read it |
|---|---|
| `reference/format.md` | Before writing any file: layout, slugs, every frontmatter field, question rules, every validation message. |
| `reference/mermaid.md` | Before writing any diagram. |
| `examples/.teachme/` | For a complete, valid example: a course with a section, a section quiz and a final quiz. Copy its shape. |

## Prerequisite: the `teachme` CLI

Run commands from the documented repo's root; `[dir]` defaults to `./.teachme`.

```bash
teachme --help                  # check the CLI is on PATH
teachme validate [dir]          # errors/warnings; exit 1 on errors
teachme status [dir] --json     # staleness report from git history; always exit 0
teachme [dir]                   # serve the UI (http://127.0.0.1:4321) to view the result
```

If `teachme` is not found: run `npm install && npm link` in the TeachMe repo (add
`npm run build` to serve the UI), or call the script directly:
`node <teachme-repo>/bin/teachme.js validate .teachme`. If you cannot locate the TeachMe
repo, ask the user for its path. Never skip validation because the CLI is missing.

## Create workflow

1. **Scope.** Settle topic, audience (new hire, or experienced engineer new to this area)
   and size. Default: 5–12 lessons of 3–7 minutes each, grouped in sections, one quiz per
   section, one final quiz. Ask the user only if the topic itself is unclear.
2. **Investigate. Write nothing before this step is done.**
   - Read the entry points (`main`, server bootstrap, router, CLI, `package.json` scripts).
   - Trace 1–2 real flows end to end (e.g. one request from route to database and back),
     noting each file and function on the path.
   - Write down the list of key files: these become `sources:`.
   - Read existing `.teachme/` content (if any) so you extend it instead of duplicating it.
3. **Outline.** Sections → lessons, with exactly one learning goal per lesson, and the quiz
   slugs. For courses over ~8 lessons, show the outline to the user and wait for approval.
4. **Write lessons.** Create `.teachme/courses/<course-slug>/course.md`, then pages
   `NN-<slug>.md` and section folders `NN-<section>/` with `_section.md`. Each lesson:
   - opens with why this matters (1–3 sentences), then how the code does it;
   - uses real file paths (`src/orders/service.ts`) and short real excerpts (≤ 15 lines,
     copied from the file, not paraphrased into fake code);
   - adds a mermaid diagram when a flow, sequence, relationship or lifecycle is involved
     (follow `reference/mermaid.md`);
   - ends with a `## Key takeaways` list of 2–4 bullets;
   - lists every file it makes claims about in `sources:` (repo-relative paths).
5. **Write quizzes.** Create `.teachme/quizzes/<slug>/quiz.md` plus one file per question.
   - 4–8 questions per section quiz, 8–15 for the final quiz.
   - Attach them: `quiz: <slug>` in each `_section.md` and in `course.md` for the final quiz;
     `course: <course-slug>` in each `quiz.md`.
   - Give each question `sources:` for the files its answer depends on.
   - Apply the question rules under **Quality rules**.
6. **Stamp and validate.**
   - Run `git rev-parse --short HEAD` and set `syncedCommit: "<sha>"` (quoted) in
     `course.md` and every new `quiz.md`.
   - Run `teachme validate`; fix every error and warning; re-run until
     `0 errors, 0 warnings`.
   - Run the **Final checklist**.

Stamp the commit whose code your content describes. If the content documents uncommitted
code, stamp after that code is committed. Changes under `.teachme/` never make content stale,
so committing the content afterwards is fine.

## Update workflow

1. Run `teachme status --json`. Output shape:

   ```jsonc
   {
     "head": "9f8e7d6",
     "items": [{
       "kind": "course",                 // or "quiz"
       "slug": "architecture",
       "file": "courses/architecture/course.md",   // relative to the content dir
       "syncedCommit": "3f2a9c1",        // null if never synced
       "state": "stale",                 // "ok" | "stale" | "never-synced" | "unknown-commit"
       "stale": [{ "file": "courses/architecture/01-flow.md", "title": "Request flow",
                   "sources": [{ "path": "src/router.ts",
                                 "commits": [{ "sha": "a1b2c3d", "subject": "feat: add auth" }] }] }],
       "broken": [{ "file": "courses/architecture/02-db.md", "source": "src/db.ts",
                    "status": "renamed", "newPath": "src/db/index.ts" }],
       "uncovered": [{ "dir": "src", "files": ["src/auth/middleware.ts"] }]
     }]
   }
   ```

   `stale[].file` and `broken[].file` are relative to the content dir; `sources[].path`,
   `broken[].source`, `newPath` and `uncovered[].files` are relative to the repo root.

2. Handle each item by `state`:

   | `state` | Meaning | Action |
   |---|---|---|
   | `ok` | No sourced file changed since `syncedCommit`. | Nothing, unless your own uncommitted changes touch its `sources:` (see below). |
   | `stale` | See `stale`, `broken`, `uncovered` below. | Steps 3–5. |
   | `never-synced` | No `syncedCommit`. | Check every claim against the current code (Final checklist), fix what is wrong, then stamp it. |
   | `unknown-commit` | `syncedCommit` is not in this repo's history (rebase, squash, typo). | Check every claim against the current code (Final checklist), fix what is wrong, then re-stamp. |

   - `stale`: pages/questions whose `sources:` were modified or renamed since
     `syncedCommit`, with the commits that touched each source.
   - `broken`: `sources:` entries that were `deleted`, or `renamed` (to `newPath`). A renamed
     source also appears in `stale`.
   - `uncovered` (courses only): changed files that no page of that course lists in
     `sources:`, grouped by top-level directory (`.` = repo root). Includes added files,
     and a renamed source's `newPath` until you update `sources:`.

3. **Read what changed and why**, from the repo root, for each stale entry:

   ```bash
   git log -p <syncedCommit>..HEAD -- <path> [<path> …]
   ```

   Pass every `sources[].path` of the entry; for renames pass both `source` and `newPath`.
   Read the commit messages as well as the diffs. Then open the current files: the diff
   tells you where to look, the current code is the truth.
4. **Rewrite affected content.**
   - Lessons: fix every sentence, excerpt, path and diagram that is now wrong. Keep lessons
     that are still correct unchanged; do not rewrite for style.
   - Questions: re-check prompt, every option, which options are `[x]`, and the explanation.
     A behavior change often turns a distractor into the right answer, or the reverse.
   - `broken`: `renamed` → replace the path with `newPath` in `sources:` and in the text.
     `deleted` → find where the logic went (`git log --diff-filter=D -- <path>` and the
     commit diff); update the text and `sources:`, or remove the lesson/question if the
     feature is gone.
   - Check quizzes that reference changed behavior even if they have no `sources:`: grep
     `.teachme/quizzes/` for the changed function and file names.
5. **Uncovered changes.** If they introduce significant new behavior, propose new lessons
   or questions to the user with a short outline. Do not silently add large content. Small
   additions to an existing lesson (a sentence, a `sources:` entry) are fine.
6. **Re-stamp and validate.** Set `syncedCommit` to `git rev-parse --short HEAD` on every
   course and quiz you reviewed, including ones you reviewed and found still correct. Leave
   items you did not review untouched. Run `teachme validate` and the **Final checklist**.

**After your own code changes:** `teachme status` only sees commits. If your changes are
not committed yet, list them with `git diff --name-only HEAD`, grep `.teachme/` for those
paths (`grep -rn "<path>" .teachme`), and update matching content the same way. Re-stamp
only after the code is committed.

## Quality rules

- **Real paths only.** Every path, function, type, config key, command and excerpt exists at
  the stamped commit. Open the file to confirm; never write from memory or assumption.
- **Excerpts are copied, short and attributed:** a code fence of ≤ 15 lines, preceded by the
  path (and function) it comes from. Use `…` to mark omitted lines.
- **One learning goal per lesson.** 3–7 minutes of reading. Split anything longer.
- **Explain why before how.** Name the problem the code solves, then show how it solves it.
- **Questions test understanding, not recall.** Ask "what happens when…", "where would you
  change…", "why does X…", "which component handles…". Do not ask for line numbers, exact
  file names learners could only memorize, or trivia.
- **Distractors are plausible:** each wrong option is a mistake a real engineer could make
  (a neighboring module, a behavior from a similar system, an outdated behavior). No joke
  options, no "all of the above", no options that differ only by wording.
- **Correct option is not guessable by form:** vary its position; keep options similar in
  length and style.
- **Every explanation cites the code:** file path and function, e.g.
  `` See `src/orders/service.ts` → `handlePaymentError()`. `` and says why wrong options are
  wrong when that teaches something.
- **Multi-select** (more than one `[x]`) only when the prompt says "Select all that apply."
- **No duplicated content:** link to an existing lesson instead of re-explaining it.
- **Diagrams follow `reference/mermaid.md`:** one per concept, ≤ 15 nodes, quoted labels.

## Common mistakes

| Mistake | Fix |
|---|---|
| Unquoted `syncedCommit: 1234567` becomes a number | Always `syncedCommit: "1234567"` |
| `sources:` relative to the Markdown file | Paths are relative to the repo root |
| Option text wrapped onto a second line | One option per line; move detail to `## Explanation` |
| `NN-` prefix on a course or quiz folder | Only pages, sections and questions get prefixes |
| `quiz:` in `quiz.md` / `course:` in `course.md` | `course.md`/`_section.md` take `quiz:`; `quiz.md` takes `course:` |
| Writing lessons before tracing a real flow | Investigate first (Create step 2) |
| Bumping `syncedCommit` without reviewing | Only stamp what you actually checked against the code |

## Final checklist

Run through every item before you report the work as done:

- [ ] `teachme validate` prints `0 errors, 0 warnings`.
- [ ] `syncedCommit` on every created or reviewed `course.md`/`quiz.md` equals the output of
      `git rev-parse --short HEAD` at the code state described, and is quoted.
- [ ] Every path in `sources:`, in lesson text, in excerpts and in explanations exists:
      check each with `ls` or `git ls-files <path>`.
- [ ] Every function, type and command named in the content exists: `grep -rn "<name>"`.
- [ ] Every excerpt matches the current file text.
- [ ] Every question has exactly the right options marked `[x]`, re-derived from the code.
- [ ] Every diagram follows `reference/mermaid.md` (open `teachme` and view the page if you
      can run a browser).
- [ ] Every page and question that makes claims about code has `sources:`.
- [ ] Report to the user: what you created/changed, the stamped commit, and any proposed
      new content awaiting their decision.
