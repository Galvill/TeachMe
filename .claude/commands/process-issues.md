---
description: Drain the open GitHub issue queue via parallel worktree subagents into an integration branch, gate it on the packaged-product integration gate and a browser smoke, then open one integration→master PR for human review
---

# /process-issues

You are the **main orchestrator** for an issue-driven development loop on TeachMe. The repo's open GitHub issues are the work backlog. Your job is to drain that backlog using parallel coder subagents in isolated worktrees, an independent re-verification and a code review per PR.

All per-issue PRs merge into a shared **integration branch** — never directly into `master`. When the queue is drained, you run the **integration gate** against the integration branch (Phase 7), and only once it is green do you open a **single integration→master PR** and stop: merging that PR is the human's job. You never merge anything into `master` yourself, and you never use `--admin` to bypass branch protection. The human merges the integration PR with a **merge commit, never squash**: release-please builds the version bump and changelog from every conventional commit reachable on `master`, so the merge commit carries each unit's squash onto `master` as its own changelog line, while a squash of the integration PR collapses the whole run into one entry.

You do NOT write code yourself. You dispatch subagents and track state.

## Testing model

TeachMe has no service stack and no fixed-port test environment: everything runs locally in seconds, and every test uses temp dirs and port 0. `.github/workflows/ci.yml` runs on every PR: the `verify` job (the suite below, on Node 20 and the current LTS) and the `pr-title` job (conventional-commit title, which becomes the squash subject release-please reads). PRs into `master` additionally get the `gate` job, which runs `.claude/scripts/integration-gate.sh`. So:

- **Per unit — the verification suite, run twice.** The coder runs it and writes a receipt; CI's `verify` job re-runs it independently on the PR head (Phase 3 step 1). CI is the evidence; the receipt is only the first filter.
- **Once, at Phase 7 — the integration gate.** It covers what the per-unit suite structurally cannot: the product as a user installs it (packed tarball, `files` field, built `dist/`), the CLI and live HTTP server end to end, rendering in a real browser, cross-unit interactions, and whether the dogfood course still tells the truth about the code. Parts of it run again in CI's `gate` job on the integration PR; the browser smoke and the dogfood decision only run here.

### The verification suite (paste into every coder/remediation prompt)

No subagent may open a PR or push to an existing PR without ALL of the following green from its own worktree:

1. `npm ci` — once per fresh worktree, or after `package.json`/`package-lock.json` changes.
2. `npm test`.
3. `npm run typecheck` — strict tsc over the app and the `checkJs` server config.
4. `npm run build`.
5. `node bin/teachme.js validate .teachme` and `node bin/teachme.js validate skill/teachme-authoring/examples/.teachme` — both `0 errors, 0 warnings`.
6. **Verification receipt**: append one line per command above to `/tmp/teachme-verify/<branch-with-slashes-as-dashes>.log` (`mkdir -p /tmp/teachme-verify` first; truncate the file at the start of each verification pass) in the form `<unix-epoch-start> <duration-seconds> <exit-code> <command>`; end with `RESULT PASS` once everything exited 0, or `RESULT FAIL` if not done.

Every command runs in the FOREGROUND with a 600000ms timeout. Never start the server without `--no-open --port 0`.

## State you maintain in memory

- `integration`: the integration branch name for this run (resolved in Phase 0).
- `slots`: a list of up to **6** in-flight work units. Each slot owns one branch/PR from coder spawn through merge or escalation, and tracks the id/name of whichever agent currently holds that branch's worktree — Phase 3 addresses it directly via `SendMessage` while it is still alive, rather than spawning a fresh worktree agent that cannot check the branch out. Each slot also records the unit's **model tier** from Phase 1 and how many remediation rounds it has consumed. Six, not eight: this repo is small and most units touch `server/` or `src/`, so more parallelism mostly buys merge conflicts.
- `merged`: PRs merged into the integration branch this run.
- `escalated`: issues moved to `human-needed` this run.
- `filed`: new issues filed mid-flight this run.

Print these counters in the final summary.

## Phase 0 — Snapshot + integration branch

**0a. Resolve the integration branch.** Reuse before create, so an interrupted run resumes instead of forking:

1. `gh pr list --state open --base master --json number,headRefName --jq '.[] | select(.headRefName | startswith("integration/"))'` — if an open integration→master PR exists, its head branch is `integration`, and it is **frozen**: it passed the Phase 7 gate and the human is testing exactly that branch. Stack onto it only a unit the user has named explicitly; otherwise stop and tell the user the queue is waiting on their merge — do NOT stack the rest of the backlog onto it, and do NOT fork a second integration branch. This check runs ONLY on the first Phase 0 pass of a run; a Phase 6 re-entry reuses the bound `integration` unconditionally.
2. Else, `git ls-remote --heads origin 'integration/*'` — if exactly one exists, reuse it. If several exist, surface them to the user and stop (don't guess which is live).
3. Else create it from master and push:
   ```
   git fetch origin master
   git push origin origin/master:refs/heads/integration/issues-<YYYY-MM-DD>
   ```
   (append `-2`, `-3`, … if the name is taken).

If reusing an existing branch, merge `origin/master` into it first if master has advanced (`git merge-base --is-ancestor origin/master origin/<integration>` fails) — dispatch that as a trivial worktree subagent task if conflicts arise; do not resolve conflicts yourself.

Ensure the loop's labels exist (the repo starts with GitHub's defaults only); create any that are missing:

```
gh label create agent-wip --color fbca04 --description "Claimed by the /process-issues loop"
gh label create human-needed --color d93f0b --description "Agent loop paused: needs a human decision"
gh label create design-needed --color 5319e7 --description "Parked until a design session settles it"
gh label create blocked-upstream --color c5def5 --description "Waiting on an upstream release"
```

**0b. Snapshot the queue.** Run:

```
gh issue list --state open --json number,title,body,labels,createdAt --limit 100
```

Filter out any issue with label `human-needed`, `agent-wip`, `design-needed`, `blocked-upstream` or `wontfix`. If the filtered list is empty AND no slots are in flight, go to **Phase 7 — Finalize**.

## Phase 1 — Cluster (autonomous pooling)

Group the filtered issues into **work units**. Pool two or more issues into a single unit when ANY of:

- Titles share a subsystem prefix and touch the same area (e.g. two `status:` issues).
- Issue bodies name overlapping files. Treat these as always-overlapping, because nearly every change to them collides: `shared/types.d.ts`, `server/content.js`, `skill/teachme-authoring/reference/format.md`, `package.json`.
- One issue is a strict subset / follow-up of another.

Otherwise, each issue is its own unit.

Print the pooling map to the user **before** dispatching anything (no approval gate — just visibility), sorted by **smallest issue number first**:

```
Units this pass:
  unit-A: #12 + #19 (status staleness) — large
  unit-B: #15 (quiz results copy) — small
```

### Tier each unit by difficulty

Every unit gets a model tier before dispatch. The tier picks the `model` passed on the coder, remediator and reviewer `Agent` calls; the agent files carry the strong default, and the tier is the only thing that lowers it.

A unit is **small** (`model: sonnet`) only when ALL of these hold, read from the issue bodies:

- One issue, or a pool whose issues all sit in one area: `server/`, `src/`, `bin/`, `skill/`, or `.teachme/`.
- The body carries verified `file:line` references and a sketch of the change, so the coder follows rather than designs.
- It touches none of the **Tier 1 areas**: request-path resolution and static serving in `server/api.js` / `server/serve.js`; the progress file format or its write path in `server/progress.js`; git shell-outs in `server/git.js` / `server/status.js`; the content format or any validation message; `shared/types.d.ts`; `package.json` `files`, `bin` or `dependencies`.
- The expected diff is under roughly 300 lines, or is docs, tests, copy, styling or dogfood content only.

Everything else is **large** (`model: opus`). When in doubt it is large: a sonnet unit that needs two remediation rounds costs more than opus would have.

Review follows the unit tier, except that a small unit whose PR diff turns out to touch a Tier 1 area is reviewed on opus.

## Phase 2 — Dispatch (≤6 parallel slots)

While there are unworked units AND a free slot:

1. Take the next unit. Apply WIP labels:
   ```
   gh issue edit <n1> <n2> ... --add-label agent-wip
   ```
2. Spawn a **coder subagent** in parallel (do not wait):
   - Tool: `Agent`
   - `subagent_type: "coder"` — its brief carries the suite, the invariants and the content-contract rules.
   - `isolation: "worktree"`
   - `model`: the unit's tier, `sonnet` for small and `opus` for large. Record it in the slot.
   - `description`: `"code #<lowest>: <short slug>"`
   - `prompt`: include all of the following:
     - Issue numbers + full bodies (paste from Phase 0 JSON).
     - Branch name to create: `issues/<lowest-number>-<short-slug>`, branched **from `origin/<integration>`** (NOT from master).
     - PR must target the integration branch: `gh pr create --base <integration> ...`, body referencing issues as `Refs #<n>` (NOT `Closes #<n>` — closing keywords only fire on merges to the default branch, so `Closes` belongs in the final integration→master PR).
     - The **verification suite** above, verbatim, plus: "Before running `gh pr create`, every point must be green from your worktree. If your change only shows in a real browser or only through the installed tarball, say so in the PR body under `Gate notes`."
     - Final instruction: "Before returning, make sure the receipt at /tmp/teachme-verify/<branch-slug>.log ends `RESULT PASS`. When that's true and the PR is opened, return exactly: `PR=<number> BRANCH=<name>`. Do not return prose."
3. Mark the slot as **owned by this coder** until it returns. Record the coder's agent id/name — Phase 3 routes remediation back to this same agent while it is still resumable.

When a coder returns:

- If the return text starts with `HUMAN-NEEDED:` → go to Phase 4 for this slot's issues.
- If the return text matches `PR=<n> BRANCH=<b>` → proceed to Phase 3 in the same slot. CI finishes in a few minutes; if it is still pending when you get there, call `ScheduleWakeup` with `delaySeconds: 180`, `reason: "checking CI on PR #<N>"`, and prompt `"/process-issues"`.

## Phase 3 — Verify, review, remediate (sequential within the slot)

**Every remediation prompt below must include the verification suite**: reproduce, fix, get the suite green from the worktree, THEN push.

**0. Check the receipt** at `/tmp/teachme-verify/<branch-slug>.log` (slug = branch name with `/` replaced by `-`).
   - Missing, or no final `RESULT PASS` → route to remediation (below) asking the agent to actually run the suite and write the receipt.
   - Present and `RESULT PASS` → proceed to (1). For calibration: on this repo `npm ci` takes a few seconds, `npm test` 1–3 s, `npm run typecheck` about 1 s and `npm run build` 1–2 s, so short durations are normal here; what is not normal is a missing command, a `0` exit on a command whose output the PR diff would obviously break, or a receipt older than the PR head commit.

**1. Poll CI** — the independent re-run: `gh pr checks <n>`. Pending → wait for the scheduled wakeup. `gh pr checks` exits non-zero with "no checks reported" for the first seconds after a push; treat that as pending.
   - A `verify` failure → `gh run view <run-id> --log-failed > /tmp/pr-<n>-failed.log` and route per **Remediation routing** with "CI failed on PR #<n>; failed log at /tmp/pr-<n>-failed.log. Fix the cause, re-run the suite, push, return `PR=<n> BRANCH=<b>`." Loop back to (0) when it returns.
   - A `pr-title` failure → fix the title yourself with `gh pr edit <n> --title "<type>: <subject>"`; it needs no worktree. The title becomes the squash subject, so pick the type release-please should see: `feat` for new user-visible behavior, `fix` for a bug, `docs` for skill or dogfood content, `chore`/`test`/`refactor` for invisible work.
   - A failing test that passes on re-run (`gh run rerun <run-id> --failed`) in a file the PR does not touch → a flake, not a blocker for this PR; file it via `gh issue create` (label `bug`) once per run, append to `filed`, and proceed.
   - If CI never reports checks for the PR (Actions disabled or down), fall back to a `test-runner` agent (`model: sonnet`): "`git -C <repo> fetch origin <branch>`, `git -C <repo> worktree add --detach /tmp/pr<n>-verify origin/<branch>`, from there run `npm ci`, `npm test`, `npm run typecheck`, `npm run build`, `node bin/teachme.js validate .teachme`, `node bin/teachme.js validate skill/teachme-authoring/examples/.teachme`, then `git -C <repo> worktree remove --force /tmp/pr<n>-verify`." Say in the final output that CI was unavailable.

**2. Review.** Spawn a code-review subagent:
   - `subagent_type: "pr-reviewer"` — read-only, it pulls the diff itself with `gh pr diff`.
   - `model`: the slot's current tier. First run `gh pr diff <n> --name-only`; if a small unit's diff touches a Tier 1 area, review on `opus` and mark the slot large.
   - Prompt: "Review PR #<n> in /home/gv/Code/TeachMe. Return JSON per your contract."

**3.** If `verdict == needs_changes`: route per **Remediation routing** with the findings JSON — "Apply these review findings, verify with the verification suite, push, return `PR=<n> BRANCH=<b>`." Loop back to (0).

**4.** If `verdict == clean` AND CI is green:
   - `gh pr merge <n> --squash --delete-branch` — this merges into the **integration branch**. Plain merge only: if it is blocked by policy, STOP and surface the blocker; do NOT retry with `--admin`. If it fails for conflicts, treat it like a verification failure: remediation rebases onto the integration branch, re-verifies, pushes, and the slot goes back through (0)–(2).
   - Comment on each referenced issue: `gh issue comment <issue> --body "Implemented in PR #<n>; staged on <integration>. Closes via the integration PR to master."`
   - Leave `agent-wip` ON — the issues stay open until the human merges the integration PR, and the label stops the next Phase 0 pass from re-dispatching them.
   - Append the PR to `merged`. **Free the slot.**

**Remediation routing**: route a fix to the **agent currently holding the branch's worktree** — the slot's tracked coder, or the most recent remediator — via `SendMessage`, while it is still resumable. A coder's worktree locks its branch, so a new worktree agent pointed at the same branch returns `BLOCKED: branch ... already checked out`. Only spawn a fresh `remediator` (`subagent_type: "remediator"`, `isolation: "worktree"`) when `SendMessage` errors or reports the owner is no longer running. Update the slot's tracked agent whenever a fresh one takes over.

**Tier escalation.** `SendMessage` keeps the owner's model, so a small unit gets exactly one remediation round on sonnet. On a second round — a second red re-run, a second `needs_changes`, or a receipt rejected twice — `TaskStop` the owner so its worktree lock releases, spawn a fresh `remediator` with `model: opus`, and mark the slot large. A large unit never moves down.

A fresh remediator gets a lean prompt: PR number, branch, integration branch, issue numbers, the failed-report path or findings JSON, and the suite. Do not paste a summary of the previous agent's reasoning.

## Phase 4 — Escalate to `human-needed`

When a coder returns `HUMAN-NEEDED: <question>`:

1. For each issue in the slot's unit:
   ```
   gh issue edit <n> --remove-label agent-wip --add-label human-needed
   gh issue comment <n> --body "Agent loop paused: <question>"
   ```
2. Append the issue numbers to `escalated`. Free the slot. Do NOT open a PR.

## Phase 5 — New issues discovered mid-flight

If a subagent's return text references a newly filed issue (e.g. "filed #25"), append it to `filed`. These issues join the **next** Phase 0 snapshot — not this iteration.

## Phase 6 — Iterate

After any slot frees (via merge or escalation), go back to Phase 0. When Phase 0 finds nothing actionable and no slot is in flight, go to Phase 7.

## Phase 7 — Finalize: integration gate, then one integration→master PR

- If `merged` is empty this run AND the integration branch has no commits ahead of master (`git rev-list --count origin/master..origin/<integration>` is 0), there is nothing to hand off. Delete the integration branch if this run created it, then print the final output with `Integration PR: none`.
- Otherwise:
  1. **Integration gate — all four parts, on the integration branch, BEFORE creating or updating the integration→master PR.** This is the first time the units run together, and the first time anything exercises the installed product or a real browser. Check the landed PRs' `Gate notes` sections before starting — they are the pre-declared triage hints. None of the parts may be skipped without the user saying so.
     - Materialize the branch: `git fetch origin` then `git worktree add --detach /tmp/teachme-gate-<integration-slug> origin/<integration>` (remove a stale worktree at that path first). Run everything below from that worktree. No lock is needed: nothing here binds a fixed port or touches `~/.TeachMe`.

     **(a) Packaged-product gate.** Run `.claude/scripts/integration-gate.sh` from the gate worktree (foreground, 600000ms timeout), or dispatch a `test-runner` to run it and return its output. It runs `npm ci`, the full suite, `npm pack` and installs the tarball into a temp prefix, then drives the INSTALLED binary: `--help`, `validate` on the shipped example and the dogfood content, `status --json`, and a live server on port 0 probed for the UI shell, `/api/catalog`, `/api/courses/:slug`, `/content/*`, a 404 for an unknown API path, four `/content` traversal variants that must not leak `package.json`, and a progress PUT/GET round-trip that must land in its temp `TEACHME_HOME`. It prints a receipt and ends `RESULT PASS` or `RESULT FAIL`.

     **(b) Cross-unit re-run.** Part (a) already ran `npm test` once on the combined branch. Run `npx vitest run` two more times in the gate worktree: the combined branch is the first place units' tests meet, and a failure that shows up once in three runs is a flake to file, not noise to ignore.

     **(c) Browser smoke.** The unit tests render components in jsdom, which cannot show Mermaid SVG output, Shiki highlighting or real layout. Start the gate worktree's server: `TEACHME_HOME=$(mktemp -d) node bin/teachme.js .teachme --no-open --port 0`, run in the background — this is the one background command in the loop — and read the URL from its first line of output. Then use the Playwright MCP tools (`mcp__plugin_playwright_playwright__browser_*`; load them with ToolSearch) to:
       - open the home page and see the `how-teachme-works` course and the quizzes listed;
       - open the course, visit the pages that contain Mermaid diagrams (`01-overview`, `02-content-format/01-folders-to-toc`, `03-server/02-api`, `04-ui/03-quiz-runner`, `05-sync/01-git-history`) and confirm each diagram rendered as an `svg`, not an error box;
       - confirm a code block is syntax-highlighted;
       - take one quiz start to finish, including one wrong answer, and confirm the results screen shows a score and navigation still works;
       - toggle the theme and reload — it must persist;
       - read `browser_console_messages` and treat any error as a failure.
       Screenshot any failure to the scratchpad. Kill the server when done. If the Playwright MCP is not available in this session, do NOT mark this part passed: report `browser smoke: NOT RUN` in the gate result and ask the user to run the checklist by hand before merging.

     **(d) Dogfood freshness.** Run `node bin/teachme.js status .teachme --json` in the gate worktree. For every `stale` or `broken` item, decide whether the run changed the behavior the lesson or question describes (read the listed commits against the lesson text, or dispatch a `researcher` when more than a few are stale):
       - Claims no longer true, or a `broken` source → dispatch one `coder` unit on the integration branch, titled `docs: update dogfood course for <integration>`, to follow the Update workflow in `skill/teachme-authoring/SKILL.md` and re-stamp `syncedCommit`. It goes through Phase 3 like any other unit.
       - Claims still true → the same kind of unit, but only to re-stamp `syncedCommit`, matching the repo's existing `chore: re-stamp dogfood content to <sha>` commits. The usual case: every release-please release bumps `version` in `package.json`, which `01-overview.md` lists as a source, so that lesson goes stale after each release with nothing untrue in it.
       - The gate passes (d) when `status` reports every item `ok`.
     - **On any failure in (a)–(c)**: save the failing output to `/tmp/teachme-gate-<integration-slug>-failed.log`, then run the Phase 3 remediation loop against the integration branch itself (a `remediator` worktree agent on `<integration>`, fix, verification suite, push). After the fix lands, re-run the gate from the top of step 1 (fresh `git fetch`, fresh worktree). Loop until green, but if the SAME failure survives two remediation attempts, STOP and surface it to the user.
     - When green, remove the gate worktree (`git worktree remove --force /tmp/teachme-gate-<integration-slug>`).
  2. **Testing focus summary.** Distill the landed PRs into a concise, tester-oriented change list — the human uses it to decide what to try by hand, so it describes observable behavior, not implementation. Build it from each landed PR's body (`gh pr view <n> --json body`) plus anything the reviews or the gate surfaced; dispatch the `researcher` agent to draft it when more than a handful of PRs landed. Format:
     - Grouped by surface, highest-risk first: content serving and path handling, then content format and validation (anything that could invalidate users' existing `.teachme/` content), then progress data, then `teachme status`, then CLI flags and output, then UI, then skill and docs last.
     - One line per behavior change, fragment style: what changed, who notices, what a tester does to see it, PR number. Changed validation messages, new errors, changed defaults and changed API shapes MUST appear.
     - Invisible changes — refactors, test-only, dep bumps with no behavior change — collapse into one "no runtime change" line.
     - End with a `Suggested focus order:` line.
     - Plain markdown bullets under a `## Testing focus` heading, 15–30 lines total.
     Save it to the scratchpad; it goes verbatim into the integration PR body AND into the final output.
  3. Check for an existing open integration→master PR (same query as Phase 0a). If one exists, update its body with `gh pr edit <n> --body-file <file>` to include this run's PRs and issues instead of opening a duplicate.
  4. Else open one:
     ```
     gh pr create --base master --head <integration> --title "chore: drain issue backlog — <K> reviewed and gated PRs" --body-file <file>
     ```
     The title type is `chore` on purpose: `chore` is a hidden changelog section in `release-please-config.json`, and the changelog entries come from the unit commits the merge commit carries, so a `fix:` or `feat:` umbrella title would add a bogus line and a spurious version bump on top of them.
     Body must contain: one line per landed PR — `- #<pr>: <title> — Refs #<issue>`; the `## Testing focus` section, verbatim, directly after that list; a `Closes #<n>` line for every resolved issue so they auto-close on merge; a `## Gate` section listing parts (a)–(d) with their result, the gate receipt from (a), and the browser-smoke checklist as run; and a closing line `Merge with a merge commit, not squash — release-please reads the unit commits.`
  5. Wait for CI on the integration PR (`ScheduleWakeup`, 300s). Its `gate` job re-runs part (a) on GitHub's runner, so it should pass on the strength of step 1; a failure there is usually an environment difference (Node version, a missing system tool). Run the Phase 3 remediation loop against the integration branch until green, and if that pushes new commits, re-run the step-1 gate before considering Phase 7 done.
  6. **Do NOT merge it. Do NOT approve it. Do NOT use `--admin`.** Gated + open = done; the merge decision belongs to the human.
  7. After the human merges, release-please opens or updates its `chore(master): release <version>` PR on its own. That PR is the human's too: never merge, edit or close it, and never push to a `release-please--*` branch.

## Final output

Print exactly:

```
Run complete.
Merged into <integration>: <comma list of PR numbers, or "none">
Integration gate: pass after <k> attempt(s), or "not reached", or "BLOCKED: <failure>"
Browser smoke: pass, or "NOT RUN — manual check required", or "not reached"
Integration PR: #<n> — <url> — awaiting human review, or "none"
Escalated to human-needed: <comma list of issue numbers, or "none">
New issues filed: <comma list, or "none">
```

If the integration PR is not `none`, append: `Merge #<n> with a merge commit, not squash — squash would collapse <K> changelog entries into one.`

If `escalated` is non-empty, append: `Review these with: gh issue list --label human-needed`.

Then print the `## Testing focus` section verbatim, so the human can plan manual testing without opening the PR. If Phase 7 was not reached, print `Testing focus: not reached` instead.

## Troubleshooting (operator notes — not part of the loop)

- If `pr-reviewer` returns malformed JSON twice, fall back to invoking the `/code-review high` skill against the PR and parse its output.
- If two or more slots conflict, the later PRs become unmergeable at `gh pr merge` time; the Phase 3 remediation loop rebases onto the integration branch. If conflicts repeat, pool more aggressively in Phase 1 — `shared/types.d.ts`, `server/content.js` and `format.md` are the usual collision points.
- Never `cd` out of the repo root in an orchestrator Bash call: once the session's cwd sits outside the repo, every `isolation: "worktree"` dispatch fails with `Cannot create agent worktree: not in a git repository`. Use absolute paths and `git -C`; if you see that message, `cd` back to the repo root and re-dispatch.
- A fresh worktree agent returning `BLOCKED: branch ... already checked out in worktree ...` means Remediation routing was skipped: `SendMessage` the owning agent instead.
- Issues intentionally stay open with `agent-wip` after their PR lands on the integration branch; they close when the human merges the integration PR.
- If a run crashes mid-flight, leftover `agent-wip` labels on issues whose PRs never landed are stale — check whether each issue's PR is on the integration branch, then clear with `gh issue edit <n> --remove-label agent-wip`.
- A stale integration branch from an abandoned run (no open PR, master has moved on): delete it manually (`git push origin --delete integration/...`) — Phase 0a stops rather than guessing when several exist.
- Release PRs opened by release-please use `GITHUB_TOKEN`, and GitHub does not start workflows for PRs a workflow token opens, so the release PR shows no CI checks. That is expected; its diff is only `package.json`, `package-lock.json`, `CHANGELOG.md` and `.release-please-manifest.json`.
- Leftover `/tmp/pr<n>-verify` or `/tmp/teachme-gate-*` worktrees from a crashed run: `git worktree remove --force <path>` then `git worktree prune`; the `branch-janitor` agent also sweeps them.
- Gate failures come in three flavors: packaging (a module or asset missing from the tarball — the tests passed from the source tree but the installed binary fails), rendering (visible only in the browser smoke), and cross-unit (two units each green alone: a `shared/types.d.ts` shape one side changed, a validation message one side reworded that the other's test asserts). Point the remediator at the specific part's output, not just "gate failed".
