---
title: The CLI entry point
sources:
  - bin/teachme.js
  - server/git.js
---
`bin/teachme.js` is the only file users run. It is where arguments are interpreted, where
"which folder?" and "which repo?" are decided, and where exit codes are set. Knowing its
decisions saves you from debugging the loader for what is really an argument problem.

## Parsing arguments

`main()` uses Node's built-in `parseArgs` with three options, `port`, `help` and `json`.
`--no-open` is handled before that, by hand:

```js
const noOpen = argv.includes("--no-open");
const filteredArgv = argv.filter((arg) => arg !== "--no-open");
```

`--port` must be all digits and at most 65535, otherwise the CLI prints
`Invalid --port: <value>. Must be an integer 0-65535.` and exits 1. `--port 0` is allowed;
it asks the OS for any free port.

## Folder and repo root

Every command resolves its folder the same way:

```js
function resolveDir(dir) {
  return path.resolve(process.cwd(), dir ?? DEFAULT_DIR);
}
```

with `DEFAULT_DIR = "./.teachme"`. If the folder does not exist, `reportMissingDir()` prints
`No TeachMe content at <abs-path>. Create it with the teachme-authoring skill.` and the
command exits 1.

The repo root comes from `resolveRepoRoot()` in `server/git.js`: `git rev-parse
--show-toplevel` run from the content dir, falling back to the content dir's parent when git
fails. The repo root is what `sources:` paths are resolved against, and what the UI uses to
build editor links.

## The serve command

`runServe()` warns (but keeps going) when `dist/index.html` is missing, then calls
`startServer()` and prints `TeachMe is running at <url>`. It loads the content once more
only to print a count of errors and warnings; the server itself reloads content on every
request. Unless `--no-open` was passed it opens the browser, ignoring any failure to do so.
SIGINT and SIGTERM close the server before exiting.

## Key takeaways

- `--no-open` is stripped before `parseArgs`; `--port` is validated by hand.
- `[dir]` defaults to `./.teachme`, resolved against the current directory.
- The repo root is the git top level, or the content dir's parent outside git.
