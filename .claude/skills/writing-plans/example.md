# Example: one task in the lean form

Task 1 of `docs/superpowers/plans/2026-09-23-teachme-C-sync-skill.md`, reproduced as written, at about 230 words. It is the contract `server/git.js` and `server/git.test.js` were built against: the coder wrote the bodies, and nothing the coder or reviewer needed is missing.

---

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

---

What makes it work:

- The `FileChange` fence is there because Task 2 (`buildStatus`) and the UI's staleness types consume it; `changesSince`'s body is not.
- Every Behavior bullet is one test: the rename bullet is `rename then edit`, the unknown-commit bullet is `unknown commit throws`.
- The Gotcha is something no coder would guess from the repo: a machine's global git config leaking into test repos.
- What it should also have carried, for Task 2 which consumes `makeRepo`: fixtures that write `syncedCommit: <sha>` into frontmatter must quote it, or a numeric-looking SHA parses as a YAML number. See Common mistakes in `SKILL.md`.
