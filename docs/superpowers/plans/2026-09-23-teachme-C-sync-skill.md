# TeachMe C: Sync and Skill Implementation Plan

**Spec:** `docs/superpowers/specs/2026-09-23-teachme-design.md`, sections 6, 7, 9 (dogfood).
**Goal:** `teachme status` reports stale content from git history, the `teachme-authoring` skill is complete, and TeachMe ships a course about itself.
**Constraints:** the spec's `## Constraints` section applies. Additionally:
- Plans A and B are merged; the example content under `skill/teachme-authoring/examples/.teachme/` already exists (Plan A Task 4).
- git is invoked with `execFileSync('git', args, { cwd: repoRoot })`, never through a shell string.
**Verification:** `npm run typecheck && npm test && npm run build`.

## File structure

| File | Responsibility |
|---|---|
| `server/git.js` | add `isGitRepo`, `headCommit`, `changesSince` |
| `server/status.js` | `buildStatus`, `formatStatus` |
| `bin/teachme.js` | add `status` command |
| `shared/types.d.ts` | add status types |
| `test/gitRepo.js` | temp git repo helper for tests |
| `skill/teachme-authoring/SKILL.md` | triggers, create and update workflows, quality rules |
| `skill/teachme-authoring/reference/format.md` | full content format |
| `skill/teachme-authoring/reference/mermaid.md` | Mermaid guidance |
| `README.md` | install, usage, skill install, dev mode |
| `.teachme/**` | dogfood course and quizzes about TeachMe |
| `server/git.test.js`, `server/status.test.js`, `test/skill.test.js`, `test/dogfood.test.js` | tests |

### Task 1: Git history helpers

**Files:**
- Modify: `server/git.js` (append after `resolveRepoRoot`)
- Create: `test/gitRepo.js`
- Test: `server/git.test.js`

**Interfaces:**
- Consumes: `resolveRepoRoot(contentDir: string): string` in `server/git.js` (Plan A Task 6).
- Produces: `isGitRepo(dir: string): boolean`, `headCommit(repoRoot: string): string` (short sha), `changesSince(repoRoot: string, commit: string): FileChange[]`, `class UnknownCommitError extends Error { commit: string }`, test helper `makeRepo(files: Record<string,string>): { dir: string; commit(files: Record<string,string|null>, msg: string): string }` (`null` deletes).

```ts
export type Commit = { sha: string; subject: string };
export type FileChange = { path: string; status: 'modified' | 'added' | 'deleted' | 'renamed'; newPath: string | null; commits: Commit[] };
```

**Behavior:**
- Runs `git log -M --name-status --format=%x00%h%x09%s <commit>..HEAD`; one entry per original path, commits newest first.
- A rename followed by edits → one `renamed` entry keyed by the old path, `newPath` = final path, both commits listed.
- A file added then deleted in the range → omitted.
- Commit not resolvable by `git rev-parse --verify <commit>^{commit}` → `UnknownCommitError`.
- `commit` equal to HEAD → `[]`.

**Tests:**
- `modified file lists commits`, `rename then edit`, `deleted file`, `added then deleted omitted`, `unknown commit throws`, `head is empty`.

**Gotchas:**
- Test repos need `GIT_AUTHOR_NAME/EMAIL` and `GIT_COMMITTER_NAME/EMAIL` in `env`, and `commit.gpgsign=false`, or CI machines fail.

### Task 2: Status report and CLI command

**Files:**
- Create: `server/status.js`
- Modify: `bin/teachme.js` (add `status`), `shared/types.d.ts`
- Test: `server/status.test.js`

**Interfaces:**
- Consumes: `loadContent`, `changesSince`, `headCommit`, `isGitRepo`.
- Produces: `buildStatus(content: Content, opts: { contentDir: string; repoRoot: string }): StatusReport`, `formatStatus(r: StatusReport): string`.

```ts
export type StatusItem = {
  kind: 'course' | 'quiz'; slug: string; file: string; syncedCommit: string | null;
  state: 'ok' | 'stale' | 'never-synced' | 'unknown-commit';
  stale: { file: string; title: string; sources: { path: string; commits: Commit[] }[] }[];
  broken: { file: string; source: string; status: 'deleted' | 'renamed'; newPath: string | null }[];
  uncovered: { dir: string; files: string[] }[];
};
export type StatusReport = { head: string; items: StatusItem[] };
```

**Behavior:**
- Course sources = its pages' `sources:`; quiz sources = its questions' `sources:`.
- A modified or renamed source → `stale` entry for that page/question; deleted or renamed → `broken` entry.
- `uncovered` (courses only): changed files referenced by no source in that course, excluding the content dir, grouped by first path segment.
- `state`: no `syncedCommit` → `never-synced`; `UnknownCommitError` → `unknown-commit`; any stale, broken or uncovered → `stale`; else `ok`.
- `teachme status [dir] [--json]`: text or JSON on stdout, exit 0; not a git repo → stderr `teachme status needs a git repository`, exit 1.

**Tests:**
- `stale page after source edit`, `renamed source is broken with newPath`, `uncovered grouped by dir`, `changes inside .teachme ignored`, `never synced`, `unknown commit`, `quiz questions tracked`, `formatStatus lists commit subjects`.

### Task 3: The authoring skill

**Files:**
- Create: `skill/teachme-authoring/SKILL.md`, `skill/teachme-authoring/reference/format.md`, `skill/teachme-authoring/reference/mermaid.md`
- Test: `test/skill.test.js`

**Interfaces:**
- Consumes: `parseQuestion` (Plan A), example content from Plan A.

**Behavior:**
- `SKILL.md` frontmatter: `name: teachme-authoring`, a `description` naming the spec §7 triggers. The body holds the §7.1 create workflow, the §7.2 update workflow driven by `teachme status --json` and `git log -p <syncedCommit>..HEAD -- <files>`, quality rules (real paths and excerpts only, understanding-level questions, plausible distractors, explanations cite file/function) and pointers to `reference/` and `examples/`. Under 250 lines.
- `format.md` restates spec §2 as agent-facing reference, including `sources:` and `syncedCommit`.
- `mermaid.md`: preferred types (`flowchart`, `sequenceDiagram`, `classDiagram`, `stateDiagram-v2`, `erDiagram`); quote labels containing `()[]{}:;,`; no `end` as a bare node id; one diagram per concept, ≤ 15 nodes.

**Tests:**
- `skill frontmatter`: `SKILL.md` parses with `name` and `description`.
- `format examples parse`: every ```` ```md ```` block in `format.md` containing `## Options` passes `parseQuestion` with no errors.
- `referenced files exist`: every `reference/…` and `examples/…` path in `SKILL.md` exists.

### Task 4: README and dogfood course

**Files:**
- Create: `README.md`, `.teachme/**`
- Test: `test/dogfood.test.js`

**Behavior:**
- README: what TeachMe is; `npm install && npm run build && npm link`; `teachme`, `teachme validate`, `teachme status`; installing the skill by symlinking `skill/teachme-authoring` into `~/.claude/skills/`; dev mode `TEACHME_DIR=<dir> npm run dev`; progress file location.
- Follow `SKILL.md`'s create workflow against this repo to produce `.teachme/`: course `how-teachme-works` with sections on content format, server, UI and sync, each with a section quiz, plus a final quiz; `syncedCommit` = HEAD at authoring time.

**Tests:**
- `dogfood content is clean`: `loadContent('.teachme')` → 0 errors, 0 warnings.

**Gotchas:**
- Don't assert `teachme status` is `ok` in tests; every later commit to `server/` legitimately makes it stale.

## Coverage

Spec sections: 6, 7, 7.1, 7.2, 8 (status row), 9 (status tests, dogfood).
