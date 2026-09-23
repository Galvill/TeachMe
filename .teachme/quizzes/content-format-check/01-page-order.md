---
title: Page ordering
sources: [server/content.js]
---
A section folder contains `2-setup.md`, `10-deploy.md`, `faq.md` and `01-intro.md`. In
what order do they appear in the TOC?

## Options
- [ ] `01-intro`, `10-deploy`, `2-setup`, `faq`
- [x] `01-intro`, `2-setup`, `10-deploy`, `faq`
- [ ] `faq`, `01-intro`, `2-setup`, `10-deploy`
- [ ] `01-intro`, `2-setup`, `faq`, `10-deploy`

## Explanation
`compareNames()` in `server/content.js` puts prefixed names first, ordered by the prefix's
numeric value (`Number("10")` is greater than `Number("2")`), and unprefixed names after
them. A plain string sort would put `10-deploy` before `2-setup`.
