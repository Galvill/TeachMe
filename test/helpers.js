import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Write a map of relative file paths to contents into a fresh temp
 * directory, creating parent directories as needed.
 * @param {Record<string, string>} files
 * @returns {string} the temp directory path
 */
export function writeTree(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "teachme-"));
  for (const [relPath, content] of Object.entries(files)) {
    const abs = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return dir;
}
