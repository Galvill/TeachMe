import { execFileSync } from "node:child_process";
import path from "node:path";

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
