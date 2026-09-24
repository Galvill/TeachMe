---
title: The progress store
sources:
  - server/progress.js
  - server/api.js
  - shared/types.d.ts
---
Progress is the only thing TeachMe writes. It must survive restarts, keep several repos
apart, and never lose everything because of one bad write. There is no database, so these
guarantees come from how one JSON file is handled.

## Where it lives

`createProgressStore()` in `server/progress.js` picks the directory once:

```js
const dir = opts.dir ?? process.env.TEACHME_HOME ?? path.join(os.homedir(), ".TeachMe");
```

The file is `<dir>/progress.json`, shaped `{ version: 1, projects: { … } }`. The API keys
projects by the absolute content dir: both routes in `server/api.js` call
`store.get(contentDir)` and `store.put(contentDir, parsed)`. Two repos, or two content
folders in one repo, never share progress.

A project's value is a `ProjectProgress` from `shared/types.d.ts`: per course the `visited`
page paths and `lastPage`, per quiz a list of `attempts`.

## Writing safely

`put()` re-reads the file, replaces one project, and writes through a temp file:

```js
const tmpFile = `${file}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
try {
  fs.writeFileSync(tmpFile, JSON.stringify({ version: FILE_VERSION, projects }, null, 2));
  fs.renameSync(tmpFile, file);
} catch (err) {
  fs.rmSync(tmpFile, { force: true });
  throw err;
}
```

The rename replaces the file in one step, so a crash mid-write leaves the old file intact.
The temp name is unique per process and write, so two TeachMe servers sharing one
`progress.json` never write into the same temp file, and a failed write removes its temp
file.

## Reading defensively

`loadProjects()` treats a missing file as empty. If the JSON is corrupt or has no
`projects` object, it renames the file to `progress.json.bak` and starts empty, so the app
keeps working and the old data can still be recovered by hand.

Incoming data is checked too. `PUT /api/progress` rejects bodies over 1 MB
(`MAX_PROGRESS_BODY_BYTES`), invalid JSON, and anything that fails `isProjectProgress()` with
`400 { error: "Invalid progress" }`. That check is shallow: it only requires `courses` and
`quizzes` to be objects.

## Key takeaways

- `~/.TeachMe/progress.json`, or `$TEACHME_HOME/progress.json`, keyed by absolute content dir.
- Writes go to a uniquely named `.tmp` file and are renamed into place.
- A corrupt file is moved to `progress.json.bak` instead of crashing the app.
