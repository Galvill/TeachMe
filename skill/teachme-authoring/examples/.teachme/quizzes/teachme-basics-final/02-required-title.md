Which files require a `title` in their frontmatter?

## Options
- [x] `course.md` and `quiz.md`
- [ ] Every Markdown file in `.teachme/`
- [ ] Only page files

## Explanation
Pages and question files fall back to a heading or a humanized filename, but
`course.md` and `quiz.md` must declare `title` explicitly — see `loadCourse`
and `loadQuiz` in `server/content.js`.
