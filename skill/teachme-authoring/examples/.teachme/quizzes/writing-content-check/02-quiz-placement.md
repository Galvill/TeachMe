Where can a `quiz:` reference appear to attach an existing quiz to a course? (Select all that apply.)

## Options
- [x] A section's `_section.md`
- [x] A course's `course.md`
- [ ] A question file
- [ ] `shared/types.d.ts`

## Explanation
`_section.md` and `course.md` both accept an optional `quiz:` field; see the
`TocItem` type in `shared/types.d.ts` for how the resulting entry is shaped.
