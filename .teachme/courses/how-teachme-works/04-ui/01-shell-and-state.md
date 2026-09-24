---
title: App shell, catalog and progress state
sources:
  - src/main.tsx
  - src/App.tsx
  - src/components/ErrorBoundary.tsx
  - src/catalog.tsx
  - src/ProgressProvider.tsx
  - src/progress.ts
  - src/api.ts
---
Every screen needs two pieces of shared data: the catalog (what courses and quizzes exist)
and the learner's progress. The app loads both once, at the top, so pages never fetch them
again and every progress change flows through one function.

## The shell

`src/main.tsx` wraps `<App />` in a `BrowserRouter`. `App` in `src/App.tsx` nests the two
providers around the routes:

```tsx
export default function App() {
  return (
    <ProgressProvider>
      <CatalogProvider>
        <Shell />
      </CatalogProvider>
    </ProgressProvider>
  );
}
```

`Shell` renders the header, the `ErrorBanner` with the catalog's errors and warnings, and
these routes: `/`, `/courses/:slug`, `/courses/:slug/*`, `/quizzes/:slug`, and a `*`
catch-all that shows "Page not found".

The routes sit inside `ErrorBoundary` (`src/components/ErrorBoundary.tsx`), keyed by the
current path. If a page throws while rendering, the header stays and the boundary shows
"Something went wrong displaying this page." with the error message and a **Back to home**
link; navigating to another path clears it.

## Catalog

`CatalogProvider` in `src/catalog.tsx` calls `getCatalog()` once in a `useEffect` and keeps a
`loading` / `error` / `ready` state. Until it is ready, it renders `Loading…` or
`Could not load content: <message>` instead of its children, so any component below can call
`useCatalog()` and get a `Catalog`, never `null`. Because the catalog is fetched once, new
courses appear after a browser reload, not live.

## Progress

`ProgressProvider` in `src/ProgressProvider.tsx` loads progress with `getProgress()`. If
that fails it starts from an empty `{ courses: {}, quizzes: {} }` and shows the toast
`Progress could not be loaded`: losing history must not block studying. Saving stays off
until the next reload, so the empty-based state never overwrites the stored progress.

Components change progress only through `update(fn)`:

```tsx
const next = fn(latestRef.current ?? EMPTY_PROGRESS);
latestRef.current = next;
setProgress(next);
if (!canSaveRef.current) return;
dirtyRef.current = true;
void flush();
```

State updates first. `flush()` then sends the latest whole object with `PUT /api/progress`,
one request at a time: changes made while a save is in flight are sent together after it,
so saves never land out of order and the last write wins. A failed save shows
`Progress could not be saved` but keeps the in-memory state.

The functions passed to `update` live in `src/progress.ts` and are pure: `markVisited()`,
`addAttempt()` and `resetCourse()` return a new object and never mutate their input.
`resetCourse()` drops a course's visited pages and only the attempts its quizzes got with
context `course:<slug>`: progress is keyed by quiz slug, so standalone attempts, or another
course's, at the same quiz are kept. The same file computes
display values: `coursePercent()` counts visited pages plus quizzes with at least one
attempt, over all TOC items, and `bestAttempt()` picks the highest score ratio.

## Key takeaways

- `ProgressProvider` wraps `CatalogProvider`, which wraps the routes.
- The catalog is fetched once; a failed progress load falls back to empty progress and
  disables saving.
- A render error in a page shows a fallback under the header instead of a blank app.
- All progress changes go through `update()` with pure helpers from `src/progress.ts`.
