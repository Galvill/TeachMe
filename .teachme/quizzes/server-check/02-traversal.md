---
title: Blocking path traversal
sources: [server/api.js]
---
Which checks stop `GET /content/...` from serving a file outside the content folder?
(Select all that apply.)

## Options
- [x] The resolved path must start with the content dir plus a path separator
- [ ] The file extension must be listed in `CONTENT_TYPES`
- [x] The symlink-resolved real path must start with the real content dir
- [ ] The request must come from `127.0.0.1`

## Explanation
`handleGetContentFile()` compares `path.resolve(contentDir, decoded)` with
`contentDir + path.sep`, then `fs.realpathSync()` with `contentDirReal + path.sep`. The
second check catches symlinks. Unknown extensions are still served, as
`application/octet-stream`, and binding to `127.0.0.1` is a server setting in
`server/serve.js`, not a per-request check.
