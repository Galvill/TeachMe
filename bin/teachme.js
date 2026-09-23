#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import open from "open";
import { loadContent } from "../server/content.js";
import { hasCommits, isGitRepo, resolveRepoRoot } from "../server/git.js";
import { formatIssues, startServer } from "../server/serve.js";
import { buildStatus, formatStatus } from "../server/status.js";

const HELP = `Usage:
  teachme [dir]            Serve content (dir defaults to ./.teachme)
    --port <n>              Port to listen on (default 4321)
    --no-open               Don't open the browser
  teachme validate [dir]   Validate content and print errors/warnings
  teachme status [dir]     Report content that went stale since it was synced
    --json                  Print machine-readable JSON instead of text
  teachme --help           Show this help
`;

const DEFAULT_DIR = "./.teachme";

/**
 * Resolve `dir` (or the default) against `cwd`.
 * @param {string | undefined} dir
 * @returns {string}
 */
function resolveDir(dir) {
  return path.resolve(process.cwd(), dir ?? DEFAULT_DIR);
}

/**
 * @param {string} absDir
 * @returns {boolean} true if missing (and the "no content" error was printed)
 */
function reportMissingDir(absDir) {
  if (fs.existsSync(absDir)) return false;
  process.stderr.write(
    `No TeachMe content at ${absDir}. Create it with the teachme-authoring skill.\n`,
  );
  return true;
}

/**
 * `teachme validate [dir]`.
 * @param {string | undefined} dir
 * @returns {void}
 */
function runValidate(dir) {
  const absDir = resolveDir(dir);
  if (reportMissingDir(absDir)) {
    process.exitCode = 1;
    return;
  }

  const repoRoot = resolveRepoRoot(absDir);
  const content = loadContent(absDir, { repoRoot });
  console.log(formatIssues(content));
  process.exitCode = content.errors.length > 0 ? 1 : 0;
}

/**
 * `teachme status [dir] [--json]`.
 * @param {string | undefined} dir
 * @param {{ json: boolean }} options
 * @returns {void}
 */
function runStatus(dir, options) {
  const absDir = resolveDir(dir);
  if (reportMissingDir(absDir)) {
    process.exitCode = 1;
    return;
  }

  if (!isGitRepo(absDir)) {
    process.stderr.write("teachme status needs a git repository\n");
    process.exitCode = 1;
    return;
  }

  if (!hasCommits(absDir)) {
    process.stderr.write("teachme status needs at least one commit\n");
    process.exitCode = 1;
    return;
  }

  const repoRoot = resolveRepoRoot(absDir);
  const content = loadContent(absDir, { repoRoot });
  const report = buildStatus(content, { contentDir: absDir, repoRoot });
  console.log(options.json ? JSON.stringify(report, null, 2) : formatStatus(report));
  process.exitCode = 0;
}

/**
 * `teachme [dir]`.
 * @param {string | undefined} dir
 * @param {{ port: number | undefined; open: boolean }} options
 * @returns {Promise<void>}
 */
async function runServe(dir, options) {
  const absDir = resolveDir(dir);
  if (reportMissingDir(absDir)) {
    process.exitCode = 1;
    return;
  }

  const repoRoot = resolveRepoRoot(absDir);
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const distDir = path.join(packageRoot, "dist");

  if (!fs.existsSync(path.join(distDir, "index.html"))) {
    process.stderr.write(
      'Warning: TeachMe UI is not built. Run "npm run build". Serving the API only.\n',
    );
  }

  const { url, close } = await startServer({
    contentDir: absDir,
    repoRoot,
    port: options.port,
    distDir,
  });

  console.log(`TeachMe is running at ${url}`);

  const content = loadContent(absDir, { repoRoot });
  if (content.errors.length > 0 || content.warnings.length > 0) {
    console.log(`${content.errors.length} errors, ${content.warnings.length} warnings in content`);
  }

  if (options.open) {
    try {
      await open(url);
    } catch {
      // Ignore browser-launch failures; the server keeps running regardless.
    }
  }

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    close()
      .catch(() => {})
      .then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

/**
 * @param {string[]} argv
 * @returns {Promise<void>}
 */
async function main(argv) {
  const noOpen = argv.includes("--no-open");
  const filteredArgv = argv.filter((arg) => arg !== "--no-open");

  /** @type {{ values: { port?: string; help?: boolean; json?: boolean }; positionals: string[] }} */
  let parsed;
  try {
    parsed = parseArgs({
      args: filteredArgv,
      options: {
        port: { type: "string" },
        help: { type: "boolean" },
        json: { type: "boolean" },
      },
      allowPositionals: true,
    });
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
    return;
  }

  const { values, positionals } = parsed;

  if (values.help) {
    console.log(HELP);
    return;
  }

  let port;
  if (values.port !== undefined) {
    if (!/^\d+$/.test(values.port) || Number(values.port) > 65535) {
      process.stderr.write(`Invalid --port: ${values.port}. Must be an integer 0-65535.\n`);
      process.exitCode = 1;
      return;
    }
    port = Number(values.port);
  }

  const [first, second] = positionals;
  if (first === "validate") {
    runValidate(second);
    return;
  }
  if (first === "status") {
    runStatus(second, { json: !!values.json });
    return;
  }

  await runServe(first, { port, open: !noOpen });
}

main(process.argv.slice(2)).catch((err) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exitCode = 1;
});
