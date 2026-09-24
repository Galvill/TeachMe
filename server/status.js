import path from "node:path";
import { changesSince, headCommit, UnknownCommitError } from "./git.js";

/** @typedef {import('../shared/types.js').Content} Content */
/** @typedef {import('../shared/types.js').Course} Course */
/** @typedef {import('../shared/types.js').Quiz} Quiz */
/** @typedef {import('../shared/types.js').Page} Page */
/** @typedef {import('../shared/types.js').Question} Question */
/** @typedef {import('../shared/types.js').FileChange} FileChange */
/** @typedef {import('../shared/types.js').StatusItem} StatusItem */
/** @typedef {import('../shared/types.js').StatusReport} StatusReport */

/**
 * Normalize a `sources:` entry (repo-relative) to a posix path with no
 * leading `./`.
 * @param {string} source
 * @returns {string}
 */
function normalizeSourcePath(source) {
  return path.posix.normalize(source.split(path.sep).join("/"));
}

/**
 * Build a per-commit `changesSince` lookup that calls `changesSince` at most
 * once per distinct commit, caching both successful results and thrown
 * errors (so a shared unknown `syncedCommit` also only shells out once).
 * @param {string} repoRoot
 * @returns {(commit: string) => FileChange[]}
 */
function makeChangesLookup(repoRoot) {
  /** @type {Map<string, FileChange[] | Error>} */
  const cache = new Map();
  return (commit) => {
    const cached = cache.get(commit);
    if (cached) {
      if (cached instanceof Error) throw cached;
      return cached;
    }
    try {
      const changes = changesSince(repoRoot, commit);
      cache.set(commit, changes);
      return changes;
    } catch (err) {
      cache.set(commit, /** @type {Error} */ (err));
      throw err;
    }
  };
}

/**
 * Collect the `stale` entry (if any) and `broken` entries for one
 * page/question, given the course/quiz's changes indexed by original path.
 * Every normalized source is added to `referenced`, whether or not it
 * changed.
 * @param {{ file: string; title: string; sources: string[] }} entity
 * @param {Map<string, FileChange>} changesByPath
 * @param {Set<string>} referenced
 * @returns {{ stale: StatusItem['stale'][number] | null; broken: StatusItem['broken'] }}
 */
function collectEntityChanges(entity, changesByPath, referenced) {
  /** @type {{ path: string; commits: FileChange['commits'] }[]} */
  const staleSources = [];
  /** @type {StatusItem['broken']} */
  const broken = [];

  for (const rawSource of entity.sources) {
    const source = normalizeSourcePath(rawSource);
    referenced.add(source);

    const change = changesByPath.get(source);
    if (!change) continue;

    if (change.status === "modified" || change.status === "renamed") {
      staleSources.push({ path: source, commits: change.commits });
    }
    if (change.status === "deleted") {
      broken.push({ file: entity.file, source, status: "deleted", newPath: null });
    } else if (change.status === "renamed") {
      broken.push({ file: entity.file, source, status: "renamed", newPath: change.newPath });
    }
  }

  const stale =
    staleSources.length > 0 ? { file: entity.file, title: entity.title, sources: staleSources } : null;

  return { stale, broken };
}

/**
 * Changed paths (post-rename) not referenced by any source, excluding the
 * content dir itself, grouped by first path segment.
 * @param {FileChange[]} changes
 * @param {Set<string>} referenced
 * @param {string} contentDirRel
 * @returns {StatusItem['uncovered']}
 */
function computeUncovered(changes, referenced, contentDirRel) {
  /** @type {Set<string>} */
  const files = new Set();
  for (const change of changes) {
    const p = change.newPath ?? change.path;
    if (referenced.has(p)) continue;
    if (contentDirRel !== "" && (p === contentDirRel || p.startsWith(`${contentDirRel}/`))) continue;
    files.add(p);
  }

  /** @type {Map<string, string[]>} */
  const byDir = new Map();
  for (const file of files) {
    const slash = file.indexOf("/");
    const dir = slash === -1 ? "." : file.slice(0, slash);
    const list = byDir.get(dir) ?? [];
    list.push(file);
    byDir.set(dir, list);
  }

  return [...byDir.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([dir, dirFiles]) => ({ dir, files: [...dirFiles].sort() }));
}

/**
 * @param {'course' | 'quiz'} kind
 * @param {{ slug: string; file: string; syncedCommit: string | null }} entity
 * @returns {StatusItem}
 */
function emptyItem(kind, entity) {
  return {
    kind,
    slug: entity.slug,
    file: entity.file,
    syncedCommit: entity.syncedCommit,
    state: "ok",
    stale: [],
    broken: [],
    uncovered: [],
  };
}

/**
 * Build a `StatusItem` for one course or quiz. Courses and quizzes share
 * everything here except which children (`pages`/`questions`) get scanned
 * and whether `uncovered` is computed (courses only) — that's captured by
 * `children` and the optional `computeUncoveredFor` callback.
 * @param {'course' | 'quiz'} kind
 * @param {{ slug: string; file: string; syncedCommit: string | null }} entity
 * @param {{ file: string; title: string; sources: string[] }[]} children
 * @param {(commit: string) => FileChange[]} getChanges
 * @param {(changes: FileChange[], referenced: Set<string>) => StatusItem['uncovered']} [computeUncoveredFor]
 * @returns {StatusItem}
 */
function buildItem(kind, entity, children, getChanges, computeUncoveredFor) {
  const item = emptyItem(kind, entity);

  if (entity.syncedCommit == null) {
    item.state = "never-synced";
    return item;
  }

  /** @type {FileChange[]} */
  let changes;
  try {
    changes = getChanges(entity.syncedCommit);
  } catch (err) {
    if (err instanceof UnknownCommitError) {
      item.state = "unknown-commit";
      return item;
    }
    throw err;
  }

  const changesByPath = new Map(changes.map((c) => [c.path, c]));
  /** @type {Set<string>} */
  const referenced = new Set();

  for (const child of children) {
    const { stale, broken } = collectEntityChanges(child, changesByPath, referenced);
    if (stale) item.stale.push(stale);
    item.broken.push(...broken);
  }

  if (computeUncoveredFor) {
    item.uncovered = computeUncoveredFor(changes, referenced);
  }

  if (item.stale.length > 0 || item.broken.length > 0 || item.uncovered.length > 0) {
    item.state = "stale";
  }

  return item;
}

/**
 * @param {Course} course
 * @param {(commit: string) => FileChange[]} getChanges
 * @param {string} contentDirRel
 * @returns {StatusItem}
 */
function buildCourseItem(course, getChanges, contentDirRel) {
  return buildItem("course", course, Object.values(course.pages), getChanges, (changes, referenced) =>
    computeUncovered(changes, referenced, contentDirRel),
  );
}

/**
 * @param {Quiz} quiz
 * @param {(commit: string) => FileChange[]} getChanges
 * @returns {StatusItem}
 */
function buildQuizItem(quiz, getChanges) {
  return buildItem("quiz", quiz, quiz.questions, getChanges);
}

/**
 * Build the staleness report for every course and quiz in `content`, using
 * git history in `repoRoot` since each item's `syncedCommit`.
 * @param {Content} content
 * @param {{ contentDir: string; repoRoot: string }} opts
 * @returns {StatusReport}
 */
export function buildStatus(content, opts) {
  const { contentDir, repoRoot } = opts;
  const head = headCommit(repoRoot);
  const getChanges = makeChangesLookup(repoRoot);
  const contentDirRel = path.relative(repoRoot, contentDir).split(path.sep).join("/");

  /** @type {StatusItem[]} */
  const items = [];
  for (const course of content.courses) {
    items.push(buildCourseItem(course, getChanges, contentDirRel));
  }
  for (const quiz of content.quizzes) {
    items.push(buildQuizItem(quiz, getChanges));
  }

  return { head, items };
}

/**
 * Render a {@link StatusReport} as human-readable text.
 * @param {StatusReport} report
 * @returns {string}
 */
export function formatStatus(report) {
  /** @type {string[]} */
  const lines = [`HEAD ${report.head}`];

  for (const item of report.items) {
    lines.push("");
    const syncedLabel = item.syncedCommit ?? "never synced";
    lines.push(`${item.kind} ${item.slug} (${syncedLabel}): ${item.state}`);

    for (const entry of item.stale) {
      lines.push(`  ${entry.file} ${entry.title}`);
      for (const source of entry.sources) {
        lines.push(`    ${source.path}:`);
        for (const commit of source.commits) {
          lines.push(`      ${commit.sha} ${commit.subject}`);
        }
      }
    }

    for (const entry of item.broken) {
      if (entry.status === "deleted") {
        lines.push(`  ${entry.file}: ${entry.source} deleted`);
      } else {
        lines.push(`  ${entry.file}: ${entry.source} renamed → ${entry.newPath}`);
      }
    }

    for (const group of item.uncovered) {
      lines.push(`  uncovered ${group.dir}/: ${group.files.join(" ")}`);
    }
  }

  return lines.join("\n");
}
