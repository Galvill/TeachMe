---
title: Nested folders
sources: [server/content.js]
---
An author creates `courses/guide/02-setup/01-advanced/01-tuning.md`. What happens to
`01-tuning.md`?

## Options
- [ ] It becomes a nested section `setup/advanced/tuning`
- [ ] Validation reports a `Duplicate slug` error
- [ ] It is flattened into the `setup` section as `setup/tuning`
- [x] It is ignored: section folders are scanned for files only

## Explanation
`loadCourseToc()` reads a section's entries with a filter that keeps only
`d.isFile() && d.name.endsWith(".md")`, so folders inside a section are silently skipped.
TeachMe supports one level of sections.
