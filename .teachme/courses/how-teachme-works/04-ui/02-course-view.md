---
title: Course view and rendering
sources:
  - src/pages/CourseView.tsx
  - src/courseNav.ts
  - src/components/Markdown.tsx
  - src/components/CodeBlock.tsx
  - src/components/Mermaid.tsx
  - src/components/SourcesFooter.tsx
---
The course view is where learners spend their time, so it has to turn a URL into the right
lesson or quiz, keep navigation working across sections, and render author Markdown, code
and diagrams without one broken block taking down the page.

## From URL to content

`CourseView` in `src/pages/CourseView.tsx` reads the splat part of `/courses/:slug/*` as the
TOC path, and checks whether it is a quiz item:

```tsx
const QUIZ_PREFIX = "_quiz/";
…
const quizSlug = path && path.startsWith(QUIZ_PREFIX) ? path.slice(QUIZ_PREFIX.length) : null;
```

- No path: the course landing, with **Start**, or **Continue** to `lastPage`.
- A `_quiz/<slug>` path: `InlineQuiz` fetches the quiz and runs it with context
  `course:<slug>`.
- Anything else: `getPage(slug, path)`; on success the page is marked visited with
  `update((p) => markVisited(p, slug, path))`. A 404 shows "Page not found" with a link back
  to the course.

Pages and quizzes share one sequence. `neighbors()` in `src/courseNav.ts` returns the TOC
items before and after the current path, so the pager and the ← / → keys move from a
section's last page into its quiz and on into the next section. The key handler ignores
events whose target is an input, textarea, select, or editable element.

## Rendering Markdown

`Markdown` in `src/components/Markdown.tsx` uses `react-markdown` with `remark-gfm` and
never enables raw HTML. It overrides `pre` to route fenced code by language:

```tsx
if (lang === "mermaid") return <Mermaid code={code} />;
if (lang) return <CodeBlock code={code} lang={lang} />;
```

- `CodeBlock` shows plain `<pre><code>` at once, then lazy-imports `shiki` and swaps in
  highlighted HTML (`github-dark` or `github-light`, following the theme). An unknown
  language just keeps the plain version.
- `Mermaid` lazy-imports `mermaid`, initializes it with `securityLevel: "strict"`, and
  renders. Initialization also pins `fontFamily` to the app's `--font-sans` stack and sets
  `htmlLabels: false`, so labels are drawn as plain SVG text instead of HTML in a
  `foreignObject` — the same font and measurement path on every machine. Once the SVG is in
  the page, `fitViewBox()` widens its `viewBox` if the drawing spills past the box Mermaid
  measured, so edge nodes are never cut off. On failure it shows
  an error box with the message and the diagram source; only that block is affected.

Image URLs go through `resolveContentUrl()`, which joins a relative `src` onto the page's
folder, clamps `..` at the content root, and returns `/content/<path>`: the route from the
previous section.

Links work the same way. `resolveLessonLink()` resolves a relative link ending in `.md`
(optionally with `#anchor`) against the page's folder; if it lands on
`courses/<course>/[<NN-section>/]<NN-page>.md`, the link becomes a react-router `<Link>` to
`/courses/<course>/[<section-slug>/]<page-slug>`, so authors link lessons by file name and
navigation stays client-side. Other `.md` links are left as-is. Tables are wrapped in a
`table-scroll` box that scrolls sideways on narrow screens.

Below each lesson, `SourcesFooter` lists the page's `sources:` as `vscode://file/<abs-path>`
links, turning a Windows repo root's backslashes into forward slashes.

## Key takeaways

- A TOC path starting with `_quiz/` renders a quiz inline; other paths load a page and
  mark it visited.
- Pager and arrow keys follow the TOC order, crossing sections and quizzes.
- Mermaid and Shiki are lazy-loaded; a broken diagram becomes a local error box.
