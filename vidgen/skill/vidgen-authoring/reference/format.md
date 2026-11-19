# vidgen script format

A video is one `script.yaml`. It holds the narration, scene by scene, and the diagram steps
that are cued to words in that narration. Narration time is fixed: every animation is placed
on the spoken words, never the other way around.

In a TeachMe repo the script lives at `.teachme/videos/<slug>/script.yaml`, with the
`manifest.json` that `vidgen publish` writes next to it. vidgen accepts any path.

## A complete script

<!-- valid -->
```yaml
title: How a DNS lookup works
slug: dns-mini
seed: 7
syncedCommit: "3f2a9c1"
sources: [src/resolver.ts]
pronunciations: {DNS: "D N S"}
scenes:
  - id: intro
    narration: >-
      Before your browser can load a page, the name has to become an address.
      So the browser asks the {r}recursive resolver.
    diagram:
      nodes:
        browser: {label: Browser, sub: "own + OS cache", at: [300, 500], size: [260, 170]}
        resolver: {label: Recursive resolver, sub: "ISP / 8.8.8.8", at: [960, 500], size: [320, 170]}
    steps:
      - at: "@cue:browser"
        highlight: browser
      - at: "@cue:r+0.2"
        send: {from: browser, to: resolver, label: "example.com ?", kind: request}
        caption: "1  The browser asks the resolver"
  - id: answer
    narration: "The resolver answers with the address, and the browser connects."
    diagram:
      inherit: true
    steps:
      - at: "@cue:answers"
        send: {from: resolver, to: browser, label: "93.184.216.34", kind: answer}
      - at: "+0.2"
        badge: {text: "93.184.216.34", near: browser}
```

## Top-level fields

| Field | Type | Default | Meaning |
|---|---|---|---|
| `title` | string | required | Shown as the small persistent title, and in the manifest. |
| `slug` | string | folder name of `script.yaml`, else the file stem | Must match `^[a-z0-9][a-z0-9-]*$`. Names the build dir and the publish path. |
| `voice` | string | `default` | Passed to the TTS endpoint. |
| `language` | string | `en` | Passed to the TTS and alignment endpoints. |
| `style` | `sketch-dark` | `sketch-dark` | The only look in v1. |
| `seed` | int | `0` | Drives the TTS seed and the hand-drawn wobble. Editing one element never re-wobbles the others. |
| `syncedCommit` | quoted string | none | The commit the script was grounded in. Always quote it: `syncedCommit: "3f2a9c1"`. |
| `sources` | list of repo-relative paths | `[]` | The files the video explains. The update workflow diffs them from `syncedCommit`. |
| `pronunciations` | map word → spoken form | `{}` | Merged over the `[pronunciations]` table in `vidgen.toml`. See **Pronunciations**. |
| `scenes` | list | required, at least one | In playback order. |

Any field not listed in these tables is an error (`unknown field`), so typos fail loudly.

## Scene fields

| Field | Type | Default | Meaning |
|---|---|---|---|
| `id` | string | required | Unique in the script; must match `^[a-z0-9][a-z0-9-]*$`. Errors name it: `scenes[ask-root].steps[1].at`. |
| `narration` | string | required | What is spoken. May hold `{mark}` markers (see **Markers**). Use `>-` for multi-line text. |
| `diagram` | mapping | empty | `inherit`, `layout` and `nodes`. |
| `steps` | list | `[]` | Animations, each cued to the narration. |

A scene lasts `max(narration end, last animation end) + 0.4 s`, rounded up to a whole frame.

## Diagram fields

| Field | Type | Default | Meaning |
|---|---|---|---|
| `inherit` | bool | `false` | Start from the previous scene's diagram (see **inherit**). |
| `layout` | mapping | none | Auto-places nodes that have no `at`: exactly one of `row`, `column` or `grid`. |
| `nodes` | map id → node | `{}` | The boxes. A node id is what steps refer to. |

**Coordinates.** Every `at` and `size` is in a 1920×1080 design space, whatever the output
resolution (draft mode renders 1280×720 and scales them). A node's or block's `at` is the
**center** of its box, not its corner. Keep everything between y 70 (the title band) and
y 970 (the caption band), and inside the frame.

**Layouts.** `row: [a, b, c]` spreads the nodes evenly over x 160–1760 at y 470.
`column: [a, b]` spreads them over y 140–900 at x 960. `grid: {cols: 3, nodes: [...]}`
fills that same area row by row. A node's own `at` always wins over the layout.

<!-- valid -->
```yaml
title: Layouts
scenes:
  - id: grid
    narration: "Four services share one queue."
    diagram:
      layout: {grid: {cols: 2, nodes: [api, worker, queue, db]}}
      nodes:
        api: {label: API}
        worker: {label: Worker}
        queue: {label: Queue}
        db: {label: Postgres, at: [1400, 750]}
```

## Node fields

| Field | Type | Default | Meaning |
|---|---|---|---|
| `label` | string | required | The main text, centered in the box. |
| `sub` | string | none | A smaller second line under the label. |
| `at` | `[x, y]` | from `layout` | Box center in 1920×1080. A node needs `at` or a place in `layout`. |
| `size` | `[w, h]` | `[220, 140]` | Box size. Labels longer than about 12 characters (for example "Recursive resolver") need a wider box: see the `overflow` lint. |
| `hidden` | bool | `false` | Start invisible; reveal it later with a `show` step. |

## Steps

Every step has an `at`, exactly one action, and optionally `caption` and `duration`.

| Field | Meaning |
|---|---|
| `at` | When the step starts (see **The `at` grammar**). Always a quoted string. |
| `caption` | Sets the bottom caption line from this step on. Separate from the SRT subtitles, which follow the narration. |
| `duration` | Seconds the animation takes; must be greater than 0. Overrides the defaults below. |

### Actions

| Action | Shape | Draws |
|---|---|---|
| `send` | `{from, to, label, kind}` | An arrow drawn in progressively with a moving dot. `from`/`to` are node ids. `label` defaults to empty. `kind` is `request` (pink, the default), `reply` (gold) or `answer` (purple). A request and reply between the same pair get opposite offsets so they don't overlap. |
| `highlight` | `node` or `{node, color, pulse}` | A glow on a node, or on a `text`/`code` element. `color` is a theme name (`teal`, `request`, `reply`, `answer`, `text`, `muted`) or a CSS color; default gold. `pulse` defaults to `true`. |
| `show` | `[ids]` or a bare id | Fades nodes or `text`/`code` elements in. |
| `hide` | `[ids]` or a bare id | Fades them out. |
| `badge` | `{text, near}` | A result badge popped in just below node `near`. |
| `group` | `{nodes, label, style}` | A bracket around the listed nodes, labeled at its top-left. `style` is `dashed` (default) or `solid`. |
| `text` | `{id, text, at, size}` | A text box centered at `at`. Without `size` it fits its text. |
| `code` | `{id, lang, text, at, size, typing, highlight_lines}` | A code block. `lang: shell` gets a terminal title bar. `typing: true` types it out. `highlight_lines` are 1-based line numbers. |

`text` and `code` ids must be unique among the scene's nodes and earlier elements. Later
steps can `highlight`, `show` or `hide` them by id.

<!-- valid -->
```yaml
title: Code block
scenes:
  - id: handler
    narration: "The handler reads the cache first, and only then calls the database."
    diagram:
      nodes:
        db: {label: Postgres, at: [1500, 500]}
    steps:
      - at: scene_start
        code:
          id: get
          lang: ts
          text: |
            const hit = cache.get(key);
            if (hit) return hit;
            return db.query(sql);
          at: [700, 500]
          size: [760, 200]
          typing: true
          highlight_lines: [1, 2]
      - at: "@cue:database"
        highlight: {node: db, color: request}
      - at: "+0.3"
        group: {nodes: [db], label: storage, style: solid}
```

### Default durations

| Step | Duration when `duration` is not set |
|---|---|
| `send` | The time until the next step starts, clamped to 0.6–2.5 s. If the next step is relative (`+N`), 1.2 s. For the last step, the time until the narration ends, clamped the same way. (`arrow_min_s`, `arrow_max_s` and `arrow_default_s` in `vidgen.toml`.) |
| `highlight` | 1.0 s |
| `show`, `hide`, `text` | 0.4 s |
| `badge`, `group` | 0.6 s |
| `code` | 0.4 s; with `typing: true`, 25 characters per second, clamped to 0.4–6 s |

## The `at` grammar

| Form | Starts at |
|---|---|
| `scene_start` | Time 0 of the scene. |
| `"@cue:resolver"` | The first spoken word matching `resolver` **after the previous cue** in this scene. Matching ignores case and punctuation: `@cue:examplecom` matches `example.com?`. |
| `"@cue:resolver#2"` | The 2nd occurrence of `resolver`, counted from the scene start, ignoring the previous cue. |
| `"@cue:r"` | A `{r}` marker in the narration (a marker wins over a word with the same name). |
| `"+0.5"` | 0.5 s after the previous step's animation **ends**. Takes no offset. |
| `"@cue:resolver+0.3"`, `"@cue:resolver-0.2"`, `"scene_start+1"` | Any cue or `scene_start` form shifted by an offset in seconds. |

Quote every `at`: an unquoted `+0.5` is a YAML number and is rejected. Cues are matched
against the narration as written, before pronunciations: cue `TLD`, not `T`.

### Markers

Put `{name}` in the narration when the right moment is not a distinctive word. The marker
names the word that follows it, attached (`{r}the`) or separate (`{r} the`), and is stripped
before TTS. `@cue:name` then resolves to the start of that word. Each marker name is used
once per scene, and a marker must have a word after it.

<!-- valid -->
```yaml
title: Markers and occurrences
scenes:
  - id: retry
    narration: "It tries, waits, then tries again. {last}This time it works."
    diagram:
      layout: {row: [client, server]}
      nodes:
        client: {label: Client}
        server: {label: Server}
    steps:
      - at: "@cue:tries"
        send: {from: client, to: server, label: "GET /", kind: request}
      - at: "@cue:tries#2+0.1"
        highlight: client
      - at: "@cue:last"
        send: {from: server, to: client, label: "200", kind: reply}
```

## `inherit`

`diagram: {inherit: true}` starts the scene with the previous scene's nodes, at their
positions, and with the visibility they had at the end of that scene (a node shown there
stays shown). It also carries over the previous layout. Nodes listed in this scene replace
or add to the inherited ones, and a `layout` here replaces the inherited one. Arrows,
badges, groups, text and code are never carried over. The first scene can't inherit.

A scene with `inherit: true` and no `nodes` repeats the previous diagram as it ended, which
is the usual way to keep one diagram across a whole video.

## Pronunciations

`pronunciations` maps a whole word, matched case-sensitively without its surrounding
punctuation, to what the TTS should say: `{DNS: "D N S", TTL: "T T L", IPv6: "I P v6"}`.
Only the spoken copy changes; captions and cues use the narration as written. Add every
acronym, hostname and unusual name, then listen to it once. A multi-word replacement maps
all its spoken words back to the one written word, so cues and caption timing still work.

## Validation messages

`vidgen validate script.yaml` (and every other command) prints one line per issue, as
`<path>: <message>`, and exits 1. The path names the field, with scenes named by id:
`scenes[ask-root].steps[1].send.to`. Placeholders such as `{node}` are filled in.

### Loading

| Message | Fix |
|---|---|
| `{file}: {error}` | The file could not be read; check the path. |
| `{file}: invalid YAML: {error}` | Fix the YAML syntax at the line shown. Quote strings that hold `: ` or start with `@`, `{` or `[`. |
| `a script must be a YAML mapping with title and scenes` | The file is empty or is a list; start with `title:`. |
| `unknown field` | A typo or a field from another level. Check the tables above. |

### Fields

| Message | Fix |
|---|---|
| `at "{value}" must be scene_start, @cue:<word>[#n] or +<seconds>, with an optional +/- offset` | Use one of the `at` forms. |
| `at "{value}": a relative at (+N) can't have an offset` | `"+0.5-0.2"` is meaningless; write `"+0.3"`. |
| `at must be a quoted string, e.g. "+{value}"` | YAML read `+0.5` as a number; quote it. |
| `a step needs exactly one action ({actions}); found {found}` | Split a step with two actions into two steps, or add the missing action. |
| `layout needs exactly one of row, column or grid` | Pick one layout kind per diagram. |
| `syncedCommit must be a quoted string` | `syncedCommit: "1234567"`, not `syncedCommit: 1234567`. |

Type errors come from pydantic with its own wording, for example `Field required`,
`Input should be 'request', 'reply' or 'answer'`, or `Input should be greater than 0` for a
`duration`. The path tells you which field.

### References and cues

| Message | Fix |
|---|---|
| `unknown node "{node}"` | A `send`, `badge`, `group` or `layout` names a node that this scene (after `inherit`) doesn't have. Add it to `nodes` or fix the id. |
| `unknown node or element "{node}"` | A `highlight`, `show` or `hide` names neither a node nor a `text`/`code` element defined by an earlier step of this scene. |
| `duplicate element id "{id}"` | A `text` or `code` id repeats a node id or an earlier element id. |
| `duplicate scene id "{id}"` | Scene ids must be unique. |
| `scene id "{id}" must match ^[a-z0-9][a-z0-9-]*$` | Lowercase letters, digits and dashes, e.g. `ask-root`. |
| `slug "{slug}" must match ^[a-z0-9][a-z0-9-]*$` | Same rule for `slug`. |
| `cue "{name}" not found in the narration` | The word is not in this scene's narration (cues never look in other scenes). Pick a word that is, or add a `{marker}`. |
| `cue "{name}" not found in the narration after the previous cue` | The word appears, but only before the previous cue. Cues resolve in step order; reorder the steps or use `#n`. |
| `cue "{name}" has no occurrence #{n} in the narration` | The word appears fewer than `n` times. |
| `the first scene has no previous scene to inherit from` | Remove `inherit: true` from the first scene. |
| `node "{node}" has no at and is not in layout` | Give the node an `at` or list it in `layout`. |
| `line {line} is out of range (the code has {count} lines)` | `highlight_lines` are 1-based and must exist in `text`. |

### Narration

| Message | Fix |
|---|---|
| `duplicate marker "{<name>}"` | Each `{marker}` name appears once per scene. |
| `marker "{<name>}" has no word after it` | Move the marker before a word. |

## Lint

`vidgen lint script.yaml` (and `build` and `render`, before they draw anything) synthesizes the narration to
get real timings, then samples every scene every 0.25 s and at each step's settled moment.
Each issue prints the scene, the time and the elements involved, and the command exits 1.
Element ids look like `node:resolver:label`, `send:2:label` (the step index), `badge:4`,
`code:dig` or `caption`. Fix each issue at its time with `vidgen preview script.yaml --t <s>`.

| Kind | Example message | Fix |
|---|---|---|
| `label-overlap` | `"send:0:label" and "send:3:label" overlap by 812 px²` | Two labels share space. Move a node, shorten a label, or `hide` the earlier element first. Labels of arrows between nodes stacked close together collide most often. |
| `label-line` | `arrow "send:1" crosses label "send:0:label"` | An arrow passes through another label. Diagonal arrows are the usual cause: increase the horizontal gap between the two boxes or bring them closer to the same height, so the arrow is flatter, or shorten the label. |
| `overflow` | `"node:resolver:label" is 236 px wide; "node:resolver" fits 188 px` | Text doesn't fit its box, or leaves the frame. For a node, give it a larger `size` (the default `[220, 140]` fits about 12 characters of label; "Recursive resolver" needs about `[300, 170]`). For a sized `text`/`code` block, enlarge `size` or drop it to let the block fit its text. Otherwise move the element inside 1920×1080. |
| `zone` | `"badge:4" enters the caption band (y > 970 px)` | Only the title may sit above y 70, and only the caption below y 970. Move the element up or down; a `badge` sits below its node, so leave room under it. |
