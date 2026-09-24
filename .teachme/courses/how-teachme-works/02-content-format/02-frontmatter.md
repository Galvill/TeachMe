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

`title: 2024` parses as a number, so it fails this check. Most other fields are converted:
`loadCourse()` turns `duration` and `quiz` into strings with `String(...)`.

`syncedCommit` is not converted, because YAML has already turned an unquoted `12e4567` into
`Infinity` (and `0123456` into a number) before the loader sees it. `readSyncedCommit()`
accepts only a string; anything else records `syncedCommit must be a quoted string`, keeps
the course or quiz, and treats it as never synced.

`sources:` goes through `normalizeSources()` in `server/validate.js`. A lone string becomes a
one-item list; anything that is not a list of strings records
`sources must be a list of file paths` and keeps only the string entries, so the UI always
gets a `string[]`.

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
- `passingScore`, `syncedCommit` and `sources:` are type-checked; most other fields are
  converted with `String()`.
