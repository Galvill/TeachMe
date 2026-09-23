---
title: App shell, catalog and progress state
sources:
  - src/main.tsx
  - src/App.tsx
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

## Catalog

`CatalogProvider` in `src/catalog.tsx` calls `getCatalog()` once in a `useEffect` and keeps a
`loading` / `error` / `ready` state. Until it is ready, it renders `Loading…` or
`Could not load content: <message>` instead of its children, so any component below can call
`useCatalog()` and get a `Catalog`, never `null`. Because the catalog is fetched once, new
courses appear after a browser reload, not live.

## Progress

`ProgressProvider` in `src/ProgressProvider.tsx` loads progress with `getProgress()`. If
that fails it starts from an empty `{ courses: {}, quizzes: {} }` and shows the toast
`Progress could not be loaded`: losing history must not block studying.

Components change progress only through `update(fn)`:

```tsx
const update = useCallback((fn: (p: ProjectProgress) => ProjectProgress) => {
  setProgress((current) => {
    const next = fn(current ?? EMPTY_PROGRESS);
    putProgress(next)
      .then(() => setSaveError(null))
      .catch(() => setSaveError(SAVE_ERROR_MESSAGE));
    return next;
  });
}, []);
```

State updates first and the whole object is then sent with `PUT /api/progress`; a failed
save shows `Progress could not be saved` but keeps the in-memory state.

The functions passed to `update` live in `src/progress.ts` and are pure: `markVisited()`
and `addAttempt()` return a new object and never mutate their input. The same file computes
display values: `coursePercent()` counts visited pages plus quizzes with at least one
attempt, over all TOC items, and `bestAttempt()` picks the highest score ratio.

## Key takeaways

- `ProgressProvider` wraps `CatalogProvider`, which wraps the routes.
- The catalog is fetched once; a failed progress load falls back to empty progress.
- All progress changes go through `update()` with pure helpers from `src/progress.ts`.
