import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** @typedef {import('../shared/types.js').ProjectProgress} ProjectProgress */
/** @typedef {import('../shared/types.js').ProgressStore} ProgressStore */

const FILE_VERSION = 1;

/**
 * @returns {ProjectProgress}
 */
function emptyProgress() {
  return { courses: {}, quizzes: {} };
}

/**
 * Narrow check that `x` has the shape of a `ProjectProgress`: a non-null,
 * non-array object with non-null, non-array `courses` and `quizzes`. No
 * deep validation of the nested values.
 * @param {unknown} x
 * @returns {x is ProjectProgress}
 */
export function isProjectProgress(x) {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return false;
  const obj = /** @type {Record<string, unknown>} */ (x);
  const { courses, quizzes } = obj;
  if (typeof courses !== "object" || courses === null || Array.isArray(courses)) return false;
  if (typeof quizzes !== "object" || quizzes === null || Array.isArray(quizzes)) return false;
  return true;
}

/**
 * @param {string} dir
 * @returns {string}
 */
function progressPath(dir) {
  return path.join(dir, "progress.json");
}

/**
 * Load `projects` map from disk. Missing file → empty map. Corrupt JSON, or
 * JSON lacking a `projects` object → backed up to `progress.json.bak` and
 * treated as empty.
 * @param {string} dir
 * @returns {Record<string, ProjectProgress>}
 */
function loadProjects(dir) {
  const file = progressPath(dir);
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed) ||
      typeof parsed.projects !== "object" ||
      parsed.projects === null ||
      Array.isArray(parsed.projects)
    ) {
      throw new Error("missing projects object");
    }
    return parsed.projects;
  } catch {
    fs.mkdirSync(dir, { recursive: true });
    fs.renameSync(file, path.join(dir, "progress.json.bak"));
    return {};
  }
}

/**
 * Create a progress store backed by `<dir>/progress.json` (spec §4.2).
 * `dir` defaults to `$TEACHME_HOME`, else `~/.TeachMe`, resolved once at
 * call time.
 * @param {{ dir?: string }} [opts]
 * @returns {ProgressStore}
 */
export function createProgressStore(opts = {}) {
  const dir = opts.dir ?? process.env.TEACHME_HOME ?? path.join(os.homedir(), ".TeachMe");

  return {
    /**
     * @param {string} key
     * @returns {ProjectProgress}
     */
    get(key) {
      const projects = loadProjects(dir);
      return projects[key] ?? emptyProgress();
    },

    /**
     * @param {string} key
     * @param {ProjectProgress} p
     * @returns {void}
     */
    put(key, p) {
      const projects = loadProjects(dir);
      projects[key] = p;

      fs.mkdirSync(dir, { recursive: true });
      const file = progressPath(dir);
      const tmpFile = `${file}.tmp`;
      fs.writeFileSync(tmpFile, JSON.stringify({ version: FILE_VERSION, projects }, null, 2));
      fs.renameSync(tmpFile, file);
    },
  };
}
