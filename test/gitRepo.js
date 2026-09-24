import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Test repos must not depend on the developer's/CI machine's global git
// config (author identity, commit signing, pager, etc.).
const GIT_ENV = {
  GIT_AUTHOR_NAME: "TeachMe Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "TeachMe Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

/**
 * @param {string} dir
 * @param {string[]} args
 * @returns {string}
 */
function git(dir, args) {
  return execFileSync("git", args, {
    cwd: dir,
    env: { ...process.env, ...GIT_ENV },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * Write or delete (`null`) files relative to `dir`, creating parent
 * directories as needed.
 * @param {string} dir
 * @param {Record<string, string | null>} files
 * @returns {void}
 */
function applyFiles(dir, files) {
  for (const [relPath, content] of Object.entries(files)) {
    const abs = path.join(dir, relPath);
    if (content === null) {
      fs.rmSync(abs, { force: true });
    } else {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    }
  }
}

/**
 * Create a fresh temp git repo, write `files`, and make an initial commit.
 * Renames in tests are expressed as a delete of the old path plus a create
 * of the new path with identical content: git's `-M` rename detection picks
 * these up.
 * @param {Record<string, string>} files
 * @returns {{ dir: string; commit: (files: Record<string, string | null>, msg: string) => string }}
 */
export function makeRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "teachme-git-"));
  git(dir, ["init", "-q", "-b", "main"]);
  applyFiles(dir, files);
  git(dir, ["add", "-A"]);
  git(dir, ["-c", "commit.gpgsign=false", "commit", "-q", "-m", "init"]);

  return {
    dir,
    /**
     * Apply file changes and commit them.
     * @param {Record<string, string | null>} changedFiles
     * @param {string} msg
     * @returns {string} short sha of the new commit
     */
    commit(changedFiles, msg) {
      applyFiles(dir, changedFiles);
      git(dir, ["add", "-A"]);
      git(dir, ["-c", "commit.gpgsign=false", "commit", "-q", "-m", msg]);
      return git(dir, ["rev-parse", "--short", "HEAD"]).trim();
    },
  };
}
