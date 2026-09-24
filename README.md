# TeachMe

TeachMe helps engineers understand the codebase they work on. Coding agents write
**courses** and **quizzes** about a repo as Markdown files under `.teachme/`, versioned with
the code. The `teachme` CLI serves them in a local React app, keeps your progress, and reports
which lessons went stale after later commits.

Everything runs locally: no accounts, no database, the server binds to `127.0.0.1` only.

## Requirements

- Node.js ≥ 20
- git (for `teachme status` and for locating the repo root)

## Install

From this repo:

```bash
npm install && npm run build && npm link
```

`npm run build` builds the UI into `dist/`; `npm link` puts `teachme` on your `PATH`.

## Usage

Run from the root of the repo you want to study. `[dir]` defaults to `./.teachme`.

```bash
teachme [dir]                  # serve the UI at http://127.0.0.1:4321 and open the browser
  --port <n>                   #   port to listen on (default 4321; tries the next ports if busy, 0 = any free port)
  --no-open                    #   don't open the browser
teachme validate [dir]         # print content errors/warnings; exit 1 on errors
teachme status [dir] [--json]  # report content that went stale since its syncedCommit
teachme --help
```

This repo ships a course about TeachMe itself: `teachme .teachme` from the repo root.

## Writing content with a coding agent

The `teachme-authoring` skill tells a coding agent how to create and update TeachMe content
from the real code. Install it for Claude Code by symlinking it into your skills folder,
either for all projects or for one repo:

```bash
ln -s "$(pwd)/skill/teachme-authoring" ~/.claude/skills/teachme-authoring
# or, per repo:
ln -s "$(pwd)/skill/teachme-authoring" <repo>/.claude/skills/teachme-authoring
```

Other agents: point them at `skill/teachme-authoring/SKILL.md` and ask them to follow it.

## Content layout

```
.teachme/
  courses/<course-slug>/
    course.md                  # title (required), description, quiz, syncedCommit, ...
    01-<page>.md               # lessons; frontmatter title and sources
    02-<section>/              # one level of sections
      _section.md              # title, quiz
      01-<page>.md
  quizzes/<quiz-slug>/
    quiz.md                    # title (required), passingScore, course, syncedCommit
    01-<question>.md           # prompt, "## Options" (- [ ] / - [x]), "## Explanation"
```

The full format, including every validation message, is in
[`skill/teachme-authoring/reference/format.md`](skill/teachme-authoring/reference/format.md).
A complete example lives in `skill/teachme-authoring/examples/.teachme/`.

## Progress

Progress (visited pages, quiz attempts) is stored in `~/.TeachMe/progress.json`, keyed by the
absolute content dir. Set `TEACHME_HOME` to use another directory.

## Development

```bash
npm run dev                            # Vite dev server with the API mounted as middleware
TEACHME_DIR=<dir> npm run dev          # serve another content dir (default: the skill's example content)
npm test                               # vitest
npm run typecheck                      # tsc for the UI and the JSDoc-typed server
npm run build                          # build the UI into dist/
```

CI (`.github/workflows/ci.yml`) runs the tests, typecheck, build and content validation on
every PR, and the packaged-product gate (`.claude/scripts/integration-gate.sh`) on PRs into
`master`. PR titles must be [Conventional Commits](https://www.conventionalcommits.org/):
PRs into `master` are merged with a merge commit (branch protection allows only that merge
method), and [release-please](https://github.com/googleapis/release-please) turns the
`feat:`/`fix:` subjects reachable on `master` into a release PR that bumps the version and
writes `CHANGELOG.md`. Merging that PR tags the release. See
[`CONTRIBUTING.md`](CONTRIBUTING.md) for the full contributor workflow.

## License

[MIT](LICENSE)
