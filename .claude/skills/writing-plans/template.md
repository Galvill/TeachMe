# <Feature> Implementation Plan

**Spec:** `docs/superpowers/specs/<date>-<name>-design.md`, sections <list>.
**Goal:** <one sentence: what exists when this plan is done>.
**Constraints:** the spec's `## Constraints` section applies. Additionally:
- <plan-specific constraint, one line, or delete this list>
**Verification:** the suite in `.claude/agents/coder.md`; per-task tests are listed under each task.

## File structure

| File | Responsibility |
|---|---|
| `server/<module>.js` | <one clause> |

### Task 1: <component name>

**Files:**
- Create: `server/<new>.js`
- Modify: `server/<existing>.js:120-140`
- Test: `server/<new>.test.js`

**Interfaces:**
- Consumes: `loadContent(dir: string, opts: { repoRoot: string }): Content` at `server/content.js:<line>`
- Produces: `buildThing(content: Content): Thing`; `Thing` added to `shared/types.d.ts`

```ts
// Only when a later task or the UI consumes it. At most 15 lines.
export type Thing = { slug: string; state: 'ok' | 'stale' };
```

**Behavior:**
- <input> → <output, HTTP status, validation message or state change>
- <input> → <output, HTTP status, validation message or state change>

**Tests:**
- `missing title`: a `course.md` without `title` reports the error `Missing required "title"`.
- `defaults`: a course with only `title` set yields the documented defaults.

**Gotchas:**
- <what the coder cannot infer, or delete this heading>

### Task 2: <component name>

...

## Coverage

Spec sections: <list of the headings this plan implements>.
