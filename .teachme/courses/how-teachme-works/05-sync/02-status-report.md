---
title: The status report
sources:
  - server/status.js
  - bin/teachme.js
  - shared/types.d.ts
---
`teachme status` turns raw file changes into a to-do list for whoever maintains the content:
which lessons and questions to re-read, which `sources:` entries point at files that moved or
vanished, and which changed code no lesson covers yet.

## Building one item

`buildStatus()` in `server/status.js` produces a `StatusReport`: HEAD's short sha plus one
`StatusItem` per course and per quiz. Both go through `buildItem()`, which decides the state:

- no `syncedCommit` → `never-synced`;
- `changesSince()` throws `UnknownCommitError` → `unknown-commit`;
- otherwise each page (courses) or question (quizzes) is checked by
  `collectEntityChanges()`, and the item is `stale` if anything was found, else `ok`.

`makeChangesLookup()` caches `changesSince()` per commit, so a course and five quizzes
stamped with the same sha run `git log` once.

## What makes something stale

For each normalized `sources:` entry, `collectEntityChanges()` looks up the change:

```js
if (change.status === "modified" || change.status === "renamed") {
  staleSources.push({ path: source, commits: change.commits });
}
if (change.status === "deleted") {
  broken.push({ file: entity.file, source, status: "deleted", newPath: null });
} else if (change.status === "renamed") {
  broken.push({ file: entity.file, source, status: "renamed", newPath: change.newPath });
}
```

So a renamed source shows up twice: as stale and as broken. A deleted source is only broken.
A page without `sources:` can never be stale.

## Uncovered changes

For courses only, `computeUncovered()` lists changed files that no page references,
excluding anything under the content dir itself, grouped by first path segment (`.` for
files at the repo root). This is how the report points at new code nobody has documented,
and why editing `.teachme/` never makes content stale.

## Output and exit codes

`runStatus()` in `bin/teachme.js` exits 1 with `teachme status needs a git repository`
outside git, and with `teachme status needs at least one commit` in a repo with no commits
(`hasCommits()`). Otherwise it prints `formatStatus(report)`, or the JSON report with `--json`,
and exits 0 even when content is stale: it is a report, not a check. Tests must not assert
`ok` for this repo's own course, because every later commit to the files it describes
legitimately makes it stale.

## Key takeaways

- States: `ok`, `stale`, `never-synced`, `unknown-commit`.
- Modified or renamed sources make a page stale; deleted or renamed ones are `broken`.
- `uncovered` (courses only) lists changed files no page lists in `sources:`.
