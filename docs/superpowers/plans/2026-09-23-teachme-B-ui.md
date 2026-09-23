# TeachMe B: UI Implementation Plan

**Spec:** `docs/superpowers/specs/2026-09-23-teachme-design.md`, sections 5, 8 (UI rows).
**Goal:** the React app delivers home, course and quiz experiences against Plan A's API, with progress saved.
**Constraints:** the spec's `## Constraints` section applies. Additionally:
- Plan A is merged; API types come from `shared/types.d.ts`, never redeclared in `src/`.
**Verification:** `npm run typecheck && npm test && npm run build`.

## File structure

| File | Responsibility |
|---|---|
| `src/api.ts` | fetch wrappers, `ApiError` |
| `src/progress.ts` | pure progress/scoring helpers |
| `src/ProgressProvider.tsx` | progress context, optimistic save, save-error toast |
| `src/theme.ts`, `src/components/ThemeToggle.tsx` | theme resolution, toggle |
| `src/styles.css` | tokens (dark default + light), layout, components |
| `src/App.tsx` | routes, header |
| `src/components/ErrorBanner.tsx` | content errors/warnings banner |
| `src/pages/Home.tsx` | course cards, quiz rows |
| `src/components/Markdown.tsx`, `CodeBlock.tsx`, `Mermaid.tsx` | rendering |
| `src/pages/CourseView.tsx`, `src/components/Toc.tsx`, `Pager.tsx`, `SourcesFooter.tsx` | course experience |
| `src/components/QuizRunner.tsx`, `QuizResults.tsx`, `src/pages/QuizView.tsx` | quiz experience |
| `src/**/*.test.ts(x)` | tests |

### Task 1: API client and progress state

**Files:**
- Create: `src/api.ts`, `src/progress.ts`, `src/ProgressProvider.tsx`
- Test: `src/progress.test.ts`, `src/ProgressProvider.test.tsx`

**Interfaces:**
- Consumes: `Catalog`, `CourseDetail`, `PageDetail`, `QuizDetail`, `ProjectProgress`, `Attempt`, `TocItem` from `shared/types.d.ts`.
- Produces:

```ts
getCatalog(): Promise<Catalog>; getCourse(slug: string): Promise<CourseDetail>;
getPage(slug: string, path: string): Promise<PageDetail>; getQuiz(slug: string): Promise<QuizDetail>;
getProgress(): Promise<ProjectProgress>; putProgress(p: ProjectProgress): Promise<void>;
class ApiError extends Error { status: number }
markVisited(p: ProjectProgress, course: string, path: string): ProjectProgress;
addAttempt(p: ProjectProgress, quiz: string, a: Attempt): ProjectProgress;
coursePercent(toc: TocItem[], p: ProjectProgress, course: string): number;
bestAttempt(p: ProjectProgress, quiz: string): Attempt | null;
isCorrect(correct: boolean[], selected: number[]): boolean;
useProgress(): { progress: ProjectProgress; update(fn: (p: ProjectProgress) => ProjectProgress): void; saveError: string | null };
```

**Behavior:**
- `markVisited` adds the path once and sets `lastPage`; inputs never mutated.
- `coursePercent` = round(100 × (visited page items + quiz items with any attempt) / toc length); empty toc → 0.
- `bestAttempt`: highest `score/total`, latest on tie.
- `isCorrect`: selected set equals the set of correct indices.
- `update` applies locally, then PUTs; a failed PUT sets `saveError` = `Progress could not be saved`, shown as a toast; app state stays updated.

**Tests:**
- `markVisited is idempotent`, `coursePercent counts quizzes`, `bestAttempt tie goes to latest`, `isCorrect multi requires exact set`.
- `failed save shows toast`: mocked `putProgress` rejects → toast text visible.

### Task 2: Shell, theme, home

**Files:**
- Create: `src/theme.ts`, `src/components/ThemeToggle.tsx`, `src/components/ErrorBanner.tsx`, `src/pages/Home.tsx`, `src/styles.css`
- Modify: `src/App.tsx` (replace placeholder), `src/main.tsx`
- Test: `src/pages/Home.test.tsx`, `src/theme.test.ts`

**Interfaces:**
- Produces: `useTheme(): { theme: 'light' | 'dark'; toggle(): void }`; routes `/`, `/courses/:slug`, `/courses/:slug/*`, `/quizzes/:slug`.

**Behavior:**
- Theme: localStorage `teachme-theme` → else `prefers-color-scheme` → sets `data-theme` on `<html>`; storage access wrapped in try/catch.
- Header: `TeachMe · <project>`, theme toggle, links home.
- Home: course cards (title, description, `N lessons · duration`, progress bar, **Start** at 0% else **Continue** → `lastPage`); quiz rows (title, `N questions`, best `score/total` with ✓ when ≥ passingScore).
- ErrorBanner lists `ERROR`/`WARN` `<file>: <message>`; dismissible; hidden when none.
- Visual per spec §5: dark default, one accent, ~720px reading column, system font stack plus monospace for code.

**Tests:**
- `home lists courses and quizzes`, `continue links to lastPage`, `banner shows errors and dismisses`, `theme falls back to OS preference`.

### Task 3: Markdown rendering

**Files:**
- Create: `src/components/Markdown.tsx`, `src/components/CodeBlock.tsx`, `src/components/Mermaid.tsx`
- Test: `src/components/Markdown.test.tsx`

**Interfaces:**
- Produces: `<Markdown source: string baseDir: string />`, where `baseDir` is the content-relative folder of the source file.

**Behavior:**
- `react-markdown` + `remark-gfm`; fenced `mermaid` → `<Mermaid>`, other fences → `<CodeBlock lang>`; inline code unchanged.
- CodeBlock: Shiki `codeToHtml` with `github-light`/`github-dark` per theme; unknown language or failure → plain `<pre><code>`.
- Mermaid: `initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'default' })`, re-renders on theme change; failure → `.mermaid-error` box with message and source.
- Relative image `src` → `/content/<baseDir>/<src>` normalized; absolute URLs untouched.

**Tests:**
- `renders gfm table`, `rewrites relative image`, `mermaid failure shows source` (mock `mermaid.render` rejecting), `unknown language falls back`.

**Gotchas:**
- Dynamic-import `shiki` and `mermaid` so they stay out of the main chunk.
- Mermaid leaves an error node `#d<id>` in `document.body` on failure; remove it.
- Mock both modules in jsdom tests with `vi.mock`.

### Task 4: Course view

**Files:**
- Create: `src/pages/CourseView.tsx`, `src/components/Toc.tsx`, `src/components/Pager.tsx`, `src/components/SourcesFooter.tsx`
- Test: `src/pages/CourseView.test.tsx`

**Interfaces:**
- Consumes: `getCourse`, `getPage`, `useProgress`, `markVisited`, `bestAttempt`, `<Markdown>`.
- Produces: `neighbors(toc: TocItem[], path: string): { prev: TocItem | null; next: TocItem | null }`.

**Behavior:**
- `/courses/:slug`: title, intro, **Start**/**Continue**.
- `/courses/:slug/<path>`: page items fetch the page; `_quiz/<quizSlug>` items render Task 5's runner inline.
- TOC: section headers; ✓ visited, ● current, ○ unvisited, ◇ quiz with best score, failed marker when best < passingScore; course quiz labelled `Final quiz`; collapsible; drawer below 900px.
- Header line `Section · Lesson N of M` (M counts pages only); `SourcesFooter` links `vscode://file/<repoRoot>/<path>`.
- Pager shows prev/next titles; ←/→ navigate unless focus is in input, textarea or contenteditable, or a modifier is held.
- Opening a page calls `markVisited`.
- Unknown path → `Page not found` with a link to the course.

**Tests:**
- `toc states`, `pager and arrow keys`, `arrow keys ignored in input`, `visiting marks progress`, `neighbors crosses sections and quizzes`.

### Task 5: Quiz runner

**Files:**
- Create: `src/components/QuizRunner.tsx`, `src/components/QuizResults.tsx`, `src/pages/QuizView.tsx`
- Modify: `src/pages/CourseView.tsx` (quiz items)
- Test: `src/components/QuizRunner.test.tsx`

**Interfaces:**
- Consumes: `getQuiz`, `useProgress`, `addAttempt`, `isCorrect`.
- Produces: `<QuizRunner quiz: QuizDetail context: Attempt['context'] onContinue?: () => void />`.

**Behavior:**
- States: start (intro, `N questions · pass P%`, **Start**) → question → results.
- Question: `Question i of N` + progress bar; radio cards when single, checkboxes + `Select all that apply` when multi; **Check answer** disabled until a selection; after check, options marked correct/incorrect, explanation shown, button becomes **Next** / **See results**.
- Results: `score/total`, percent, Passed/Not passed vs `passingScore`; per-question ✓/✗ expandable to your answer, correct answer, explanation; **Retry** restarts; course context shows **Continue** (`onContinue`), standalone shows **Back to home** and the related course link when `quiz.course` is set.
- Reaching results saves one attempt with `answers` keyed by question slug.

**Tests:**
- `single choice flow scores`, `multi requires exact set`, `check disabled until selection`, `attempt saved once`, `retry resets`, `continue shown in course context`.

## Coverage

Spec sections: 5.1, 5.2, 5.3, 5.4, 8 (mermaid failure, progress write failure), 9 (UI tests).
