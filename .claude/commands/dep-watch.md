---
description: Dependency watch — collect an npm/Node inventory, decide which upstream changes deserve work, and file or refresh dep-watch issues via the issue-filer agent
---

# /dep-watch

You are ORCHESTRATING the dependency watch for TeachMe. You collect a small inventory of the repo's one npm tree and its Node baseline, then turn the relevant deltas into GitHub issues. Filing happens in the `issue-filer` subagent — you decide *what* is worth an issue, it writes the body in house style. You never edit code, never open PRs, never bump anything.

TeachMe has no Go modules, no container images and no hold ledger, so MCPGW's collectors for those have no counterpart here. What exists: the GitHub Actions in `.github/workflows/`, pinned by commit SHA with a trailing `# vX.Y.Z` comment; `package.json` + `package-lock.json` (caret ranges, lockfile-pinned), the `engines.node` floor, and the split between runtime `dependencies` (`gray-matter`, `open` — shipped to every user who installs the CLI) and `devDependencies` (build and test tools, plus the React/Markdown/Mermaid/Shiki stack that Vite bundles into `dist/`).

## Arguments

Run directory: `$ARGUMENTS`

If empty, use `$HOME/.local/state/teachme-dep-watch/runs/manual-$(date +%Y-%m-%d_%H%M%S)`. Create it and a `raw/` subfolder.

## Phase 0 — collect and load state

Run each as its own Bash call from the repo root, saving output under `<run-dir>/raw/`. `npm outdated` and `npm audit` exit 1 when they find something — that is data, not failure.

1. `npm ci --no-audit --no-fund` if `node_modules/` is missing, so `npm outdated` reads the installed tree.
2. `npm outdated --json > <run-dir>/raw/outdated.json` — `current` (installed, i.e. lockfile), `wanted` (newest inside the caret range) and `latest` per direct dependency.
3. `npm audit --json > <run-dir>/raw/audit.json` and `npm audit --omit=dev --json > <run-dir>/raw/audit-runtime.json` — the second isolates what ships in the installed CLI.
4. `curl -s https://nodejs.org/dist/index.json > <run-dir>/raw/node-releases.json` — the current Active LTS line and whether the `engines.node` floor in `package.json` (today `>=20`) is past end-of-life.
5. For each `uses: <owner>/<repo>@<sha> # <tag>` line in `.github/workflows/*.yml` (`grep -n 'uses:' .github/workflows/*.yml`): `gh api repos/<owner>/<repo>/releases/latest --jq .tag_name` for the latest tag, and `gh api repos/<owner>/<repo>/commits/<tag> --jq .sha` for the SHA the pinned comment's tag resolves to. A mismatch between that SHA and the pinned one is **COMMENT DRIFT**: the comment lies about what runs.
6. `git rev-parse --short HEAD` for the summary.

Write `<run-dir>/inventory.md` with one table: `name | dep type | current | wanted | latest | bump_kind` where `dep type` is `runtime` or `dev`, and `bump_kind` is `major`, `minor`, `patch` or `none`, computed from `current` → `latest`. Add an Actions table (`action | pinned sha | comment tag | latest tag | bump_kind | comment vs SHA`), an Audit section and a Node section. A collector that failed (no network, npm error) is written as `lookup failed` — treat those as unknown, never as "no change".

Then:

1. Ensure the labels exist: `gh label list --json name --jq '.[].name'`; create any missing:
   - `gh label create dep-watch --color 0e8a16 --description "Filed by the dependency watch: upstream change needing a bump or adaptation"`
   - `gh label create human-needed --color d93f0b --description "Agent loop paused: needs a human decision"`
   - `gh label create security --color b60205 --description "Security advisory"`
2. Load the existing watch issues:
   ```
   gh issue list --label dep-watch --state open --limit 200 --json number,title,body,labels
   gh issue list --label dep-watch --state closed --limit 200 --json number,title,labels,closedAt
   ```
   A closed dep-watch issue carrying `wontfix` means "do not refile for this dependency at this major" — skip it silently. A closed one without `wontfix` was done; refile only if a *newer* version than the one it named has since appeared.

## Phase 1 — classify deltas

| bucket | what lands here | issue shape | labels |
|---|---|---|---|
| **toolchain** | `engines.node` floor past end-of-life, or a new Node LTS line the repo has not been checked against; a `typescript` major (it changes what `npm run typecheck` accepts in both configs) | one issue per tool | `dep-watch,human-needed` |
| **major** | any direct dependency whose `latest` is a new major | one issue per dependency, except the groups below | `dep-watch,human-needed` |
| **major-group** | `react` + `react-dom` + `@types/react` + `@types/react-dom` majors → one `ui:` issue; `vite` + `@vitejs/plugin-react` + `vitest` majors → one `deps:` build-toolchain issue | one issue per group | `dep-watch,human-needed` |
| **security** | `npm audit` high/critical. From `audit-runtime.json` → reaches every installed CLI; dev-only → reaches `dist/` if the package is bundled into the UI, otherwise only contributors | one issue per advisory group | `dep-watch,security,bug` |
| **batch** | all npm minor/patch bumps | one rolling issue | `dep-watch,enhancement` |
| **actions** | any action with a newer release, majors included; any COMMENT DRIFT, or a `uses:` pinned by tag instead of SHA | one rolling `ci:` issue | `dep-watch,enhancement` |
| **ignore** | `bump_kind` `none`; `lookup failed`; npm audit low/moderate in dev-only tools that are not bundled; anything a closed `wontfix` issue already declined | nothing, but list it in the run summary | — |

Judgment rules:

- `human-needed` marks bumps a person should green-light before `/process-issues` picks them up: majors and toolchain changes change behavior. Minor/patch batches and security fixes are drainable as filed.
- The two runtime dependencies deserve extra care even at minor level: a `gray-matter` change can alter how every user's frontmatter parses (the unquoted-SHA rule in `server/content.js` depends on its YAML behavior), and `open` launches the browser on every platform. Call either out on its own line inside the batch issue.
- Rolling batch issue titles, stable so they are refreshed instead of duplicated: `deps: npm minor and patch bumps` and `ci: bump pinned GitHub Actions`. An action bump must keep SHA pinning and update the trailing comment. For `googleapis/release-please-action` majors, quote the release notes: a change in how it reads `release-please-config.json` changes every future release.
- For **major** bumps of anything the product is built on — `react`, `react-router`, `react-markdown`, `remark-gfm`, `mermaid`, `shiki`, `vite`, `vitest`, `typescript`, `jsdom`, `gray-matter`, `open` — the issue must say which changes in the release notes matter to this repo. Pull them with `gh api repos/<owner>/<repo>/releases` (find the repo with `npm view <pkg> repository.url`) and quote the load-bearing lines. For `mermaid` and `shiki` also check whether the dogfood course's diagrams and code blocks still render — that is what Phase 7's browser smoke in `/process-issues` checks. For everything else a link to the release page is enough.
- Cap new individual issues at 8 per run, toolchain and security first, then majors ordered by how central the dependency is. Anything past the cap goes to the run summary as deferred.

## Phase 2 — dedupe

For every candidate individual issue, compare against the open dep-watch issues by dependency name in the title:

- Same dependency, open issue names the same or a newer target version → skip (report as `already tracked #N`).
- Same dependency, open issue names an older target → `gh issue comment` on it with the new version and the release link; do not file a second one.
- No match → file.

For each rolling bucket: if an open issue with the stable title exists, rewrite its body with the fresh table via `gh issue edit <n> --body-file <file>` and add a one-line comment `refreshed by dep-watch run <run-dir basename>`; else file it.

## Phase 3 — file via the issue-filer agent

Write one findings file per issue to `<run-dir>/findings/<slug>.md` holding: the title (house style `<subsystem>: <imperative>`, e.g. `deps: bump vite 8 to 9 with plugin-react and vitest`, `ui: adopt react-router 9`), every place the version appears as `file:line` from a `grep -n` you ran yourself (`package.json`, plus any config that names it such as `vite.config.ts`, `vitest.config.ts`, `tsconfig*.json`), current and target versions, runtime or dev, the release-notes URL and the quoted lines that matter, the verification commands — the suite from `.claude/agents/coder.md` and, for anything bundled into `dist/` or shipped at runtime, the integration gate `.claude/scripts/integration-gate.sh` plus the browser smoke in `.claude/commands/process-issues.md` Phase 7 — and the labels from the table above.

Then dispatch **one** `issue-filer` agent (Agent tool, `subagent_type: "issue-filer"`) per batch of up to 6 findings files with a prompt of this shape:

> File one GitHub issue per findings file listed below, from the repo root. Treat each file as prepared findings: verify every `file:line` it cites by opening the file, fix wrong refs, and follow your house style. Title and labels are given in the file; use them verbatim. Body sections: Today's behavior (the version, with the load-bearing line), The gap (what upstream changed, quoted), Proposed (bump plus what to watch for), Implementation sketch (every location), Test coverage, Out of scope, Refs. Do not check for duplicates — the caller did. Return the contract line per issue.
>
> Findings files: <absolute paths>

Verify each filed issue exists with `gh issue view <n> --json labels,title` and that the labels stuck; add missing ones with `gh issue edit --add-label`.

## Phase 4 — report

Write `<run-dir>/summary.md` and print the same text as your final message:

```
dep-watch <date> — checkout <sha>
Filed: #N title, ...
Refreshed: #N title, ...
Commented: #N title, ...
Already tracked: ...
Deferred past cap: ...
Ignored: <one line per ignored row, terse>
Lookups failed: <collectors that failed>
```

## Rules

- Filing ends at the URL. Never start /process-issues, never edit code, never bump anything, never open PRs. `npm ci` in Phase 0 is the only command that writes, and it only restores `node_modules/` from the lockfile.
- Only cite refs you verified this run; the inventory is a hint, the `grep -n` is the evidence.
- Read `raw/audit.json` directly when an advisory row looks truncated; the inventory is a summary, the raw files are the record.
- If `gh` is unauthenticated or every collector failed, stop and print `failed: <why>` instead of filing partial work.
