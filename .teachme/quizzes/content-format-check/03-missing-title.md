---
title: Title fallbacks
sources: [server/content.js]
---
Which of these files load without an error even though their frontmatter has no `title`?
(Select all that apply.)

## Options
- [x] A page file whose body starts with `# Getting started`
- [ ] A `quiz.md` whose body starts with `# Basics quiz`
- [x] A question file with no frontmatter at all
- [x] A section's `_section.md`

## Explanation
Pages fall back to a leading `# H1` or the humanized slug (`resolveTitle()`), questions
fall back to the humanized slug, and sections to the humanized folder name. Only `course.md`
and `quiz.md` go through `readRequiredFrontmatter()`, which records
`Missing required "title"`; an H1 in the body does not count there.
