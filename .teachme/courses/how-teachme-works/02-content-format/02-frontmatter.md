---
title: Frontmatter and titles
sources:
  - server/content.js
  - server/validate.js
---
Frontmatter is where authors put metadata that file names cannot carry: a course title, a
quiz's pass mark, the `sources:` that drive staleness. Because YAML is forgiving in
surprising ways, the loader checks types instead of trusting what it parsed.

## Reading it

Every Markdown file goes through `tryReadMarkdown()` in `server/validate.js`, which wraps
`gray-matter`:

```js
try {
  // gray-matter caches parses by input string; pass {} as options to avoid
  // stale results across tests/files.
  const parsed = matter(raw, {});
  return { ok: true, data: parsed.data, content: parsed.content };
} catch (err) {
```

A YAML error does not throw out of the loader. It becomes an `Invalid frontmatter: …` error
for that file and the file is skipped.

## Required vs. optional

`course.md` and `quiz.md` are read by `readRequiredFrontmatter()`, which demands a string
title:

```js
if (typeof read.data.title !== "string") {
  issues.errors.push({ file, message: 'Missing required "title"' });
  return null;
}
```

`title: 2024` parses as a number, so it fails this check. Other fields are converted:
`loadCourse()` turns `duration`, `quiz` and `syncedCommit` into strings with `String(...)`.
That conversion is why unquoted `syncedCommit` values are dangerous: YAML has already turned
`12e4567` into a number before `String()` sees it.

`loadQuiz()` is stricter about `passingScore`. It defaults to `70`, and if the key is present
it must be a real number from 0 to 100, otherwise the quiz is dropped with
`passingScore must be a number between 0 and 100`. The string `"70"` fails.

## Page titles

Pages and questions never require a title. `resolveTitle()` tries, in order:

1. frontmatter `title`;
2. a first non-blank line that is a `# H1`, which is then removed from the body so the UI
   does not show it twice;
3. `humanize(fallbackSlug)`: hyphens to spaces, first letter capitalized.

Sections work the same way without the H1 step: `_section.md`'s `title`, else the humanized
folder slug.

## Key takeaways

- Invalid YAML becomes an error on that file; the loader keeps going.
- Only `course.md` and `quiz.md` require `title`, and it must be a string.
- `passingScore` is type-checked; most other fields are converted with `String()`.
