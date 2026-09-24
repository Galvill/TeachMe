---
name: writing-plans
description: Use when writing or revising an implementation plan in this repo from a design spec under docs/superpowers/specs, including when brainstorming or another skill hands off to writing-plans
---

# Writing Plans

## Overview

A plan is the contract a coder implements against, not the implementation. It states what each task must produce and how that is proven, in the fewest words that leave no decision open. In this repo it replaces superpowers:writing-plans.

Its readers already know the repo. The issue-filer distils tasks into issue bodies. The coder reads the issue, the plan and the spec, and its own brief in `.claude/agents/coder.md` carries the verification suite, git rules, the content-contract obligations and repo gotchas. The PR reviewer checks the diff against each task's Behavior and Tests lines. A plan carries only what they cannot get elsewhere: file layout, cross-task interfaces, per-task behavior contracts, test names, non-obvious gotchas.

The three plans under `docs/superpowers/plans/` (A core server, B UI, C sync and skill) are already in this form; read one before writing a new one.

## What a plan is

Copy `template.md` and fill every slot. In order:

1. **Header**: Spec path, Goal, Constraints line, Verification line.
2. **File structure**: one table, path and responsibility, one row per file created or modified.
3. **Tasks**.
4. **Coverage**: one line listing the spec sections implemented.

Name the file `docs/superpowers/plans/<date>-<feature>-<letter>-<name>.md`, matching the letter in the spec's `## Delivery plans`.

## What a task is

- **Files**: Create / Modify / Test, exact paths, line ranges or an anchor ("append after `resolveRepoRoot`") for Modify.
- **Interfaces**: Consumes with `file:line` for existing code, Produces with exact signatures. Server code is JSDoc-typed JavaScript, so write signatures TypeScript-style; a type the UI also reads belongs in `shared/types.d.ts` and the task says so. A later task's coder learns names and types only from here.
- **Behavior**: bullets. Each names a concrete input and the concrete output, error, HTTP status, validation message or state change, and is checkable by one test.
- **Tests**: the vitest `it(...)` names in backticks, with the assertion when the name alone doesn't carry it. No test bodies. Say which file when the task has several.
- **Gotchas**: only what the coder cannot infer: a helper to reuse (`test/helpers.js` `writeTree`, `test/gitRepo.js` `makeRepo`), a YAML trap, a fixture that must stay valid, a validation message the format reference must learn. Omit the heading when empty.

A code fence holds a declaration another task consumes: a type, a signature, a JSON shape, a route, a frontmatter block. At most 15 lines. Bodies are the coder's work.

## Budget

| Unit | Words |
|---|---|
| Task | ≤ 250 |
| Plan, excluding the file table | ≤ 3,000 |

Check with `wc -w`. Over budget means the plan holds implementation or restates the spec, or the arc needs one more plan letter. For scale: plans A, B and C run about 1,000–1,600 words each for 4–7 tasks.

## Constraints

The spec's `## Constraints` section applies to every plan by reference. A plan lists only constraints the spec lacks and this plan trips over, one line each — for example "git is invoked with `execFileSync`, never through a shell string". Repo-wide rules such as the verification suite, conventional commits, the `--no-open --port 0` rule and the content-contract obligations live in the coder brief and are not repeated.

## Concreteness

Every Behavior bullet names a value, a path, a status code or an error message. "TBD", "handle edge cases" and "similar to Task N" are plan failures. A later task that needs an earlier task's signature repeats the signature, not the body.

## Content-contract tasks

A task that adds or changes a content rule — a frontmatter field, a question rule, a validation message — must list `skill/teachme-authoring/reference/format.md` under Modify and, when an example changes shape, `skill/teachme-authoring/examples/.teachme/`. State in Behavior whether existing content stays valid; if it doesn't, the task needs an error or warning message a user can act on. A task that falsifies a dogfood lesson lists `.teachme/courses/how-teachme-works/...` under Modify, or the plan ends with a dogfood update task as Plan C did.

## Specs

- Every rule an implementer must obey sits under one `## Constraints` heading, so plans can reference it.
- A section that is a table has no prose restating the table.
- Decisions are one line each: the decision and its reason.
- `## Delivery plans` lists the plan split by letter, one sentence per plan.

## Common mistakes

- Pasting the test file into Tests. One line per test names what it proves.
- Copying the spec's constraints into the plan. Reference the section.
- A Produces line that names identifiers without signatures. The next coder needs types.
- Skipping Gotchas because the plan feels complete. Plan C's status task omitted "quote `syncedCommit` in test fixtures"; `server/status.test.js` wrote it unquoted, so whenever a random fixture SHA reads as a YAML number (`1234567`, `12e4567`) the course parses as `never-synced` and the suite fails intermittently. The loader already knew the trap (`server/content.js`, "syncedCommit must be a quoted string"); the plan didn't pass it on.

`example.md` shows one real task from Plan C in this form.
