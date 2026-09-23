---
title: Content in dev mode
sources: [vite.config.ts]
---
You run `npm run dev` without setting `TEACHME_DIR`. Which content does the dev server show?

## Options
- [ ] `./.teachme` in the TeachMe repo
- [x] `skill/teachme-authoring/examples/.teachme`
- [ ] None: the dev server needs `TEACHME_DIR` and fails without it
- [ ] The content dir of the last `teachme` process that ran

## Explanation
`vite.config.ts` resolves `process.env.TEACHME_DIR ?? DEFAULT_DEV_CONTENT_DIR`, and
`DEFAULT_DEV_CONTENT_DIR` is `"skill/teachme-authoring/examples/.teachme"`. Run
`TEACHME_DIR=.teachme npm run dev` to work on this course.
