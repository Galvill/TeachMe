---
title: Quiz parsing and validation
sources:
  - server/quizParser.js
  - server/validate.js
  - server/content.js
  - server/serve.js
---
A question is free-form Markdown with a strict skeleton, and the parser has to find that
skeleton without being fooled by code samples in the prompt. Validation then decides what
the app can still show when some files are broken.

## Parsing one question

`parseQuestion()` in `server/quizParser.js` first finds every `## ` heading, skipping lines
inside fenced code (`findHeadings()` toggles `inFence` on each fence line). That is why a
prompt may contain a code block with `## Options` in it.

The prompt is everything before `## Options`. Every non-blank line after it, up to the next
`## ` heading, must match one pattern:

```js
const OPTION_RE = /^-\s*\[([ xX])\]\s*(.*)$/;
```

Anything else produces `Unexpected line in Options: "<line>"`. After the loop, the parser
counts options:

```js
if (options.length < 2) {
  errors.push("Needs at least 2 options");
}
const correctCount = options.filter((o) => o.correct).length;
if (correctCount === 0) {
  errors.push("No correct option marked");
}
```

and returns `multi: correctCount > 1`. There is no separate flag for multi-select questions:
two or more `[x]` lines make it one.

## Errors vs. warnings

`loadQuiz()` drops a question with any parse error, and drops the quiz if no question
survives (`Quiz has no questions`). Errors mean "this item is left out of the app".

Warnings mean "this item is shown, but something it points at is missing". They come from
two helpers in `server/validate.js`:

- `checkSources()` warns `Source not found: <path>` when a `sources:` entry does not exist
  under the repo root.
- `checkMarkdownContent()` warns `Empty mermaid block` and `Image not found: <src>` for
  relative images that do not resolve from the file's folder.

References are checked after loading: `loadContent()` loads quizzes first, so
`loadCourseToc()` can report `Unknown quiz "<slug>"`, and then checks every quiz's
`course:` against the loaded courses (`Unknown course "<slug>"`). A quiz dropped for its own
error therefore cascades into `Unknown quiz` errors wherever it is referenced.

`teachme validate` prints all of this with `formatIssues()` from `server/serve.js`: one
`ERROR` line per error, one `WARN` line per warning, then `N errors, M warnings`. The exit
code is 1 only when there are errors.

## Key takeaways

- The parser ignores `## ` headings inside code fences.
- More than one `[x]` makes a question multi-select.
- Errors remove items from the app; warnings leave them in and flag missing references.
