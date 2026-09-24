---
sources:
  - package.json
---
# Welcome

TeachMe turns a folder of Markdown files into a browsable course with
quizzes. There's nothing to install for your readers beyond the `teachme`
CLI, and nothing to learn beyond Markdown and YAML frontmatter.

This page itself has no `title` in its frontmatter — only a `sources` list.
When a page's frontmatter has no `title`, TeachMe falls back to the first
`# H1` heading (this one), and that heading is then removed from the
rendered body so it isn't shown twice. If there were no heading either, the
title would fall back to a humanized version of the filename.

The `teachme` command you're running right now comes from the `bin.teachme`
entry in `package.json`.

Every course lives under `.teachme/courses/<slug>/`, and every quiz lives
under `.teachme/quizzes/<slug>/`. The rest of this course walks through
both.
