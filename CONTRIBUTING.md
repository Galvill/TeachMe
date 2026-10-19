# Contributing to TeachMe

Thanks for looking at TeachMe. This document describes how a change actually gets from your
machine to `main`: how to verify it locally, how CI and branch protection check it, and how
it gets merged.

## Setup

```bash
npm ci
npm run build   # builds the UI into dist/, which the CLI serves
```

See the [README](README.md) for CLI usage and the content layout under `.teachme/`.

## Before opening a PR

Run the same checks CI runs (`.github/workflows/ci.yml`, `verify` job) and fix anything that
fails:

```bash
npm ci
npm test
npm run typecheck
npm run build
node bin/teachme.js validate .teachme
node bin/teachme.js validate skill/teachme-authoring/examples/.teachme
```

The last two must each print `0 errors, 0 warnings`. There is no linter in this repo — don't
add one as a drive-by change.

If your change touches code that a dogfood lesson describes (anything under
`.teachme/courses/how-teachme-works/`), run `node bin/teachme.js status .teachme` too. Each
course and quiz has a `syncedCommit` in its front matter, and `teachme status` reports a
lesson as `stale` once a file in its `sources:` list has changed since that commit — CI's
`gate` job (see below) fails on stale dogfood content. If your change makes a lesson stale,
follow the **Update workflow** in
[`skill/teachme-authoring/SKILL.md`](skill/teachme-authoring/SKILL.md): check the lesson's
claims against the current code, fix anything that's now wrong, and re-stamp
`syncedCommit` to your merge commit. The content format itself — every frontmatter field,
slug rule and validation message — is documented in
[`skill/teachme-authoring/reference/format.md`](skill/teachme-authoring/reference/format.md).

## Commit and PR title

Your PR title must be a [Conventional Commit](https://www.conventionalcommits.org/) subject,
e.g. `feat: add dark mode toggle` or `fix: resolve stale quiz progress`. This is enforced by
the `pr-title` check (`.github/workflows/pr-title.yml`, via
[`amannn/action-semantic-pull-request`](https://github.com/amannn/action-semantic-pull-request))
on every PR, and re-checked on every title or body edit.

The subject matters beyond style: [release-please](https://github.com/googleapis/release-please)
(`release-please-config.json`) reads every conventional-commit subject that lands on `main`
to compute the next version and write the changelog. `feat` and `fix` commits produce a
visible changelog entry and a version bump; `chore`, `refactor`, `test`, `build`, `ci` and
`style` are accepted but hidden from the changelog (see `changelog-sections` in
`release-please-config.json`). Never hand-edit `CHANGELOG.md`, `.release-please-manifest.json`,
or the `version` field in `package.json` — release-please owns all three and opens its own
release PR to update them.

## Checks and review required to merge

`main` is protected by a ruleset that requires, on a branch that is up to date with
`main`:

- `verify (20)` and `verify (lts/*)` — the check above, run on Node 20 and the current LTS.
- `gate` — `.claude/scripts/integration-gate.sh`, an end-to-end check that installs the
  packed tarball into a clean prefix and exercises the CLI and a live server over HTTP. It
  only runs on PRs whose base is `main`.
- `pr-title` — the Conventional Commit title check above.
- One approving review. Pushing new commits dismisses a prior approval.

Merges into `main` use a **merge commit**, not squash or rebase — the branch ruleset only
allows the "merge" method. (You may also see PRs merge into short-lived `integration/*`
branches with squash instead; those are internal to this repo's own issue-batching workflow
and are not part of the path a regular contributor needs to follow — just open your PR
against `main`.)

## License

By contributing, you agree your contribution is licensed under the [MIT License](LICENSE)
that covers this repository.
