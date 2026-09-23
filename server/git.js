import { execFileSync } from "node:child_process";
import path from "node:path";

/** @typedef {import('../shared/types.js').Commit} Commit */
/** @typedef {import('../shared/types.js').FileChange} FileChange */

/**
 * @typedef {{ type: 'A' | 'D' | 'M'; path: string }
 *   | { type: 'R'; path: string; newPath: string }} Change
 * @typedef {{ sha: string; subject: string; changes: Change[] }} ParsedCommit
 * @typedef {{
 *   originPath: string;
 *   currentPath: string;
 *   addedInRange: boolean;
 *   deleted: boolean;
 *   commits: Commit[];
 * }} Lineage
 */

/**
 * Resolve the repo root for a content directory: `git rev-parse
 * --show-toplevel` run from `contentDir`, trimmed. If that fails (not a git
 * repo, git missing, etc.), falls back to the parent directory of
 * `contentDir`.
 * @param {string} contentDir
 * @returns {string}
 */
export function resolveRepoRoot(contentDir) {
  try {
    const out = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: contentDir,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.toString().trim();
  } catch {
    return path.dirname(path.resolve(contentDir));
  }
}

/**
 * Whether `dir` is inside a git working tree.
 * @param {string} dir
 * @returns {boolean}
 */
export function isGitRepo(dir) {
  try {
    const out = execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return out.trim() === "true";
  } catch {
    return false;
  }
}

/**
 * Whether the repo containing `dir` has at least one commit (HEAD resolves).
 * @param {string} dir
 * @returns {boolean}
 */
export function hasCommits(dir) {
  try {
    execFileSync("git", ["rev-parse", "--verify", "--quiet", "HEAD"], {
      cwd: dir,
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Short sha of HEAD.
 * @param {string} repoRoot
 * @returns {string}
 */
export function headCommit(repoRoot) {
  return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/**
 * Thrown by {@link changesSince} when `commit` cannot be resolved in the
 * repo.
 */
export class UnknownCommitError extends Error {
  /**
   * @param {string} commit
   */
  constructor(commit) {
    super(`Unknown commit ${commit}`);
    this.name = "UnknownCommitError";
    /** @type {string} */
    this.commit = commit;
  }
}

/**
 * File-level changes between `commit` (exclusive) and HEAD (inclusive),
 * aggregated per original path and following renames. Throws
 * {@link UnknownCommitError} if `commit` does not resolve in `repoRoot`.
 * @param {string} repoRoot
 * @param {string} commit
 * @returns {FileChange[]}
 */
export function changesSince(repoRoot, commit) {
  try {
    execFileSync(
      "git",
      ["rev-parse", "--verify", "--quiet", `${commit}^{commit}`],
      { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch {
    throw new UnknownCommitError(commit);
  }

  const out = execFileSync(
    "git",
    [
      "-c",
      "core.quotePath=false",
      "log",
      "-M",
      "--name-status",
      "--format=%x00%h%x09%s",
      "--no-show-signature",
      `${commit}..HEAD`,
    ],
    { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );

  return aggregateChanges(parseLog(out));
}

/**
 * Parse `git log -M --name-status --format=%x00%h%x09%s` output into
 * commits newest-first, each with its parsed name-status lines.
 * @param {string} out
 * @returns {ParsedCommit[]}
 */
function parseLog(out) {
  return out
    .split("\0")
    .filter((block) => block.length > 0)
    .map(parseCommitBlock);
}

/**
 * @param {string} block
 * @returns {ParsedCommit}
 */
function parseCommitBlock(block) {
  const lines = block.split("\n");
  const header = lines[0];
  const tab = header.indexOf("\t");
  const sha = header.slice(0, tab);
  const subject = header.slice(tab + 1);

  /** @type {Change[]} */
  const changes = [];
  for (const line of lines.slice(1)) {
    if (line === "") continue;
    const fields = line.split("\t");
    const code = fields[0][0];
    if (code === "R") {
      changes.push({ type: "R", path: fields[1], newPath: fields[2] });
    } else if (code === "C") {
      // Copy: treat like a modify on the destination path.
      changes.push({ type: "M", path: fields[2] });
    } else if (code === "A") {
      changes.push({ type: "A", path: fields[1] });
    } else if (code === "D") {
      changes.push({ type: "D", path: fields[1] });
    } else {
      // 'M' and 'T' (type change): treat like a modify.
      changes.push({ type: "M", path: fields[1] });
    }
  }

  return { sha, subject, changes };
}

/**
 * Walk parsed commits oldest→newest, aggregating changes per original path
 * and following renames.
 * @param {ParsedCommit[]} commitsNewestFirst
 * @returns {FileChange[]}
 */
function aggregateChanges(commitsNewestFirst) {
  const oldestFirst = [...commitsNewestFirst].reverse();

  /** @type {Map<string, Lineage>} */
  const byCurrentPath = new Map();
  /** @type {Lineage[]} */
  const all = [];

  /**
   * @param {string} originPath
   * @param {string} currentPath
   * @param {boolean} addedInRange
   * @returns {Lineage}
   */
  function startLineage(originPath, currentPath, addedInRange) {
    /** @type {Lineage} */
    const lineage = { originPath, currentPath, addedInRange, deleted: false, commits: [] };
    all.push(lineage);
    byCurrentPath.set(currentPath, lineage);
    return lineage;
  }

  /**
   * @param {Lineage} lineage
   * @param {Commit} commit
   */
  function recordCommit(lineage, commit) {
    const last = lineage.commits[lineage.commits.length - 1];
    if (!last || last.sha !== commit.sha) lineage.commits.push(commit);
  }

  for (const parsed of oldestFirst) {
    const commit = { sha: parsed.sha, subject: parsed.subject };
    for (const change of parsed.changes) {
      if (change.type === "R") {
        const existing = byCurrentPath.get(change.path);
        if (existing) {
          byCurrentPath.delete(change.path);
          existing.currentPath = change.newPath;
          existing.deleted = false;
          byCurrentPath.set(change.newPath, existing);
          recordCommit(existing, commit);
        } else {
          recordCommit(startLineage(change.path, change.newPath, false), commit);
        }
      } else if (change.type === "A") {
        // A re-add at a path whose lineage we're already tracking (it was
        // deleted earlier in the range) continues that lineage rather than
        // starting a new one, so a delete-then-re-add nets out to a single
        // entry for the path.
        const existing = byCurrentPath.get(change.path);
        const lineage = existing ?? startLineage(change.path, change.path, true);
        lineage.deleted = false;
        recordCommit(lineage, commit);
      } else if (change.type === "D") {
        const existing = byCurrentPath.get(change.path);
        const lineage = existing ?? startLineage(change.path, change.path, false);
        lineage.deleted = true;
        recordCommit(lineage, commit);
      } else {
        const existing = byCurrentPath.get(change.path);
        const lineage = existing ?? startLineage(change.path, change.path, false);
        lineage.deleted = false;
        recordCommit(lineage, commit);
      }
    }
  }

  /** @type {FileChange[]} */
  const results = [];
  for (const lineage of all) {
    if (lineage.addedInRange && lineage.deleted) continue;

    /** @type {FileChange['status']} */
    let status;
    if (lineage.addedInRange) {
      status = "added";
    } else if (lineage.deleted) {
      status = "deleted";
    } else if (lineage.currentPath !== lineage.originPath) {
      status = "renamed";
    } else {
      status = "modified";
    }

    results.push({
      path: lineage.originPath,
      status,
      newPath: status === "renamed" ? lineage.currentPath : null,
      commits: [...lineage.commits].reverse(),
    });
  }

  results.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return results;
}
