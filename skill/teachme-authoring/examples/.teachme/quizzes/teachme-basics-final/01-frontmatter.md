Which fields are TeachMe's Markdown frontmatter parsed with?

## Options
- [x] Any fields, since all frontmatter is YAML
- [ ] Only `title` and `description`
- [ ] JSON only

## Explanation
Every content file's frontmatter is YAML, parsed with `gray-matter` in
`server/content.js`.
