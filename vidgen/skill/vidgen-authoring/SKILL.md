---
name: vidgen-authoring
description: Use when asked to make a video or animated explainer of a flow, request path or interaction in a codebase ("make a video of how X works", "animated explainer of the login flow"), or to update one; also use while writing a TeachMe course where three or more components interact in an order that is hard to follow in prose.
---

# vidgen authoring

vidgen turns a short `script.yaml` into a narrated explainer video with hand-drawn
box-and-arrow diagrams. You write the script: narration split into scenes, and diagram
steps cued to words in that narration. vidgen synthesizes the speech, times every arrow to
the word that names it, lints the layout, renders and publishes the MP4.

**Core rule: read the code first.** Every node, arrow and label must match what the code
does at `syncedCommit`, and `sources` lists the files the video relies on. A video with one
invented hop teaches the wrong thing more convincingly than prose would.

## When to use

- "Make a video / animated explainer of <flow>" → **Create workflow**.
- Writing a TeachMe course and a flow has three or more parts that interact in order (a
  request through services, a cache miss falling through layers, a retry path) and the
  prose is hard to follow → offer a video, then **Create workflow**.
- An existing script's `sources` changed since its `syncedCommit` → **Update workflow**.

**When not to make a video.** If a static picture says it, a Mermaid diagram in the lesson
is enough and costs nothing to keep current: a structure, a dependency graph, a state list,
or a flow with only two parts. Make a video only when the *order and timing* of the
interaction is the point.

## Files in this skill

| Path | Read it |
|---|---|
| `reference/format.md` | Before writing any script: every field, the `at` grammar, default durations, `inherit`, every validation message and every lint kind with its fix. |
| `examples/dns-lookup/script.yaml` | A complete six-scene video: one diagram kept across scenes with `inherit`, request/reply pairs, a final badge, pronunciations. Copy its shape. |
| `examples/code-flow/script.yaml` | Two scenes: a `code` block that types in with highlighted lines, then the flow it drives. |

## Prerequisite: the `vidgen` CLI

```bash
vidgen doctor                          # toolchain and endpoints; run once first
vidgen validate script.yaml            # schema, references, cues; no endpoints needed
vidgen lint script.yaml                # overlap/overflow on every scene (synthesizes speech)
vidgen preview script.yaml             # PNGs at the 3 densest moments; or --t 12.5 --t 30
vidgen render script.yaml --scene 3    # one scene only
vidgen build script.yaml [--draft]     # the full video, into ~/.cache/vidgen/builds/<slug>/
vidgen publish script.yaml [--target NAME]   # upload; writes manifest.json next to the script
vidgen validate --strict script.yaml   # also fail when the manifest is out of date
```

Exit codes: 0 ok, 1 validation or lint failure, 2 an endpoint, alignment, ffmpeg or
renderer failure. If `vidgen` is not on `PATH`, run `make setup` in the TeachMe repo's
`vidgen/` folder (it installs the CLI). If `vidgen doctor` reports an endpoint down, tell the
user; you can still write and `validate` the script without one.

## Narration rules

- Short sentences, one idea per scene. About 150 words per minute: a 25-word scene is
  about 10 seconds. A whole video is usually 45–90 seconds (115–220 words).
- Name each component out loud at the moment its arrow should start: the cue words are the
  timeline. "The resolver asks a **root** server" lets `@cue:root` start the arrow.
- Spell acronyms, hostnames and odd names through `pronunciations`
  (`{DNS: "D N S", TTL: "T T L"}`), and listen to the TTS of every new term once.
- Say what happens, not what the viewer sees ("the resolver asks", not "an arrow goes").

## Create workflow

1. **Pick the flow.** One flow, from a trigger to a result, with 3–8 components. Settle the
   audience and where the video goes. In a TeachMe repo the script lives at
   `.teachme/videos/<slug>/script.yaml`.
2. **Investigate. Write nothing before this step is done.** Trace the flow in the code end
   to end: every hop, its function and file, what each call sends and returns. Treat
   READMEs and comments as leads to check, not facts. The files you relied on become
   `sources`.
3. **Draft the narration**, scene by scene, following the narration rules. Show it to the
   user if the flow is long or the framing is not obvious.
4. **Diagram and steps.** Read `reference/format.md`. Declare all nodes in the first scene
   (`hidden: true` for those that appear later), then `inherit: true` in later scenes. Give
   every node with a long label an explicit `size`. Cue each step to a word its scene
   speaks. Use `request` for calls, `reply` for returns and `answer` for the final result.
5. **Stamp.** `syncedCommit: "<git rev-parse --short HEAD>"` (quoted), at the commit whose
   code the script describes.
6. **Validate** with `vidgen validate script.yaml`; fix every issue (the messages and fixes
   are in `reference/format.md`) and re-run until it prints `ok`.
7. **Lint** with `vidgen lint script.yaml`; fix every issue (each lint kind has a fix in
   `reference/format.md`) and re-run until it prints no issues.
8. **Preview and look.** `vidgen preview script.yaml` writes PNGs of the densest moments.
   Open every PNG and look at it: lint catches overlaps, not a diagram that reads wrong, an
   arrow pointing the wrong way or a label that says something the code doesn't do. Add
   `--t <seconds>` for any moment you're unsure of.
9. **Build** with `vidgen build script.yaml`. Use `--draft` while iterating; the final
   build is not a draft. Aim for one full build per change: after the first, only changed
   scenes re-synthesize and re-render.
10. **Spot-check** the video: watch it once, and check the arrows start as their words are
    spoken.
11. **Publish** with `vidgen publish script.yaml`. It writes `manifest.json` next to the
    script.
12. **Commit the script and `manifest.json`. Never commit the MP4** or anything from the
    build dir.

## Update workflow

1. Find what changed since the script was grounded:

   ```bash
   git log -p <syncedCommit>.. -- <sources...>
   ```

   No output means the video is still true; stop. `vidgen validate --strict` separately
   tells you when the script changed after the last publish.
2. Re-read the current code for each change: the diff shows where to look, the code is the
   truth.
3. Edit only the affected scenes: narration, nodes, labels, steps and `sources`. Leave
   correct scenes byte-for-byte alone, so they come from the cache. In the same edit, bump
   `syncedCommit` to the commit you checked against. The script hash covers `syncedCommit`,
   so a bump after the build would make the new manifest stale at once.
4. Run Create steps 6–11: validate, lint, preview the changed scenes, rebuild (only the
   changed scenes re-render), spot-check, republish.
5. Commit the script and the new manifest.

## Common mistakes

| Mistake | Fix |
|---|---|
| A node or hop the code doesn't have | Trace the flow first (Create step 2); every arrow is a real call. |
| Unquoted `at: +0.5` or `syncedCommit: 1234567` | Quote them: `at: "+0.5"`, `syncedCommit: "1234567"`. |
| A cue word that's only in the next scene's narration | Cues only see their own scene. Move the word or the step. |
| "Recursive resolver" overflowing a default box | Give long-labeled nodes a `size`, e.g. `[300, 170]`. |
| Steep diagonal arrows crossing each other's labels | Widen the horizontal gap or level the boxes. |
| Skipping the preview because lint passed | Lint checks geometry, not meaning. Look at the PNGs. |
| Committing `video.mp4` | Commit only `script.yaml` and `manifest.json`. |

## Final checklist

- [ ] Every node, arrow and label matches the code at `syncedCommit`; `sources` lists the
      files, and each path exists (`git ls-files <path>`).
- [ ] `syncedCommit` is quoted and is the commit the script describes.
- [ ] `vidgen validate` prints `ok`, and `vidgen lint` reports no issues.
- [ ] You opened and looked at the preview PNGs.
- [ ] Every acronym and hostname in the narration has a `pronunciations` entry.
- [ ] The video is published, and only the script and manifest are committed.
- [ ] Report to the user: the flow covered, the stamped commit, the published URL or
      location from the manifest.
