---
title: The update workflow
sources:
  - skill/teachme-authoring/SKILL.md
  - skill/teachme-authoring/reference/format.md
---
`teachme status` only says where to look. Fixing the content is the job of a coding agent
following the `teachme-authoring` skill, and the skill's rules decide whether the next
report can be trusted.

## Stamping

`syncedCommit` goes on `course.md` and `quiz.md` only; pages and questions inherit it from
their course or quiz. The skill sets it to `git rev-parse --short HEAD` at the code state
the content describes, and always quotes it:

```yaml
syncedCommit: "3f2a9c1"           # optional, commit the content was last synced to
```

Unquoted, YAML may read the sha as a number, and `String()` in the loader cannot undo that.

## The loop

The update workflow in `skill/teachme-authoring/SKILL.md`, for each item that is not `ok`:

1. Run `teachme status --json`.
2. For each stale entry, read what changed and why:
   `git log -p <syncedCommit>..HEAD -- <path> [<path> …]`, then open the current files.
3. Rewrite only what is now wrong: sentences, excerpts, paths, diagrams, and for questions
   which options are `[x]`. Replace `renamed` paths with `newPath`; find where `deleted`
   logic went.
4. For `uncovered` files with significant new behavior, propose new lessons to the user
   instead of silently adding them.
5. Re-stamp every course and quiz actually reviewed, then run `teachme validate` until it
   prints `0 errors, 0 warnings`.

`never-synced` and `unknown-commit` items have no usable baseline, so every claim in them is
checked against the current code before stamping.

Its quality rules add: **code is ground truth, docs are hints.** When a README or comment
disagrees with the code, the code wins, and `sources:` should list the implementing files,
not the docs about them. Status only watches the listed paths, so a doc-only entry would not
go stale when the behavior changes.

The skill's rule is to stamp only what was reviewed: bumping `syncedCommit` without reading
the diff would make the next `teachme status` report `ok` for content that is wrong.

## Key takeaways

- `syncedCommit` lives on `course.md` and `quiz.md`, quoted, and pages inherit it.
- Status output points at files; `git log -p` explains the change; the current code is the
  truth.
- Re-stamp only content you actually reviewed.
