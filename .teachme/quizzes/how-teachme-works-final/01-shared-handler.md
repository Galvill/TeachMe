---
title: One handler, two servers
sources: [server/api.js, server/serve.js, vite.config.ts]
---
You add a new route to `createHandler()` in `server/api.js`. Where is it available without
further changes? (Select all that apply.)

## Options
- [x] In `teachme [dir]`, through `startServer()`
- [x] In `npm run dev`, through the Vite plugin in `vite.config.ts`
- [ ] In `teachme validate`, which starts the handler to load content
- [ ] In the built `dist/` bundle, which embeds the handler

## Explanation
`startServer()` in `server/serve.js` and `teachmeDevMiddleware()` in `vite.config.ts` both
call `createHandler()`. `teachme validate` only calls `loadContent()` and `formatIssues()`,
and `dist/` contains only the browser app.
