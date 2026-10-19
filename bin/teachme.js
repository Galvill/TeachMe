#!/usr/bin/env node
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import open from "open";
import { loadContent } from "../server/content.js";
import { hasCommits, isGitRepo, resolveRepoRoot } from "../server/git.js";
import { DEFAULT_HOST, formatIssues, isLoopbackHost, startServer } from "../server/serve.js";
import { buildStatus, formatStatus } from "../server/status.js";

const HELP = `Usage:
  teachme [dir]            Serve content (dir defaults to ./.teachme)
    --host <addr>           Address to listen on (default 127.0.0.1; 0.0.0.0 = all interfaces)
    --port <n>              Port to listen on (default 4321)
    --no-open               Don't open the browser
  teachme validate [dir]   Validate content and print errors/warnings
  teachme status [dir]     Report content that went stale since it was synced
    --json                  Print machine-readable JSON instead of text
  teachme --help           Show this help
  teachme --version, -v    Print the installed teachme version
`;

const DEFAULT_DIR = "./.teachme";

/**
 * Read the `version` field from the installed package's own package.json.
 * @returns {string}
 */
function readPackageVersion() {
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
  return pkg.version;
}

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
 * @param {{ host: string; port: number | undefined; open: boolean }} options
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

  /** @type {Awaited<ReturnType<typeof startServer>>} */
  let server;
  try {
    server = await startServer({
      contentDir: absDir,
      repoRoot,
      host: options.host,
      port: options.port,
      distDir,
    });
  } catch (err) {
    const code = /** @type {NodeJS.ErrnoException} */ (err).code;
    if (code === "ENOTFOUND" || code === "EADDRNOTAVAIL" || code === "EAI_AGAIN") {
      process.stderr.write(`Cannot listen on --host ${options.host}: ${code}\n`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }
  const { url, close } = server;

  console.log(`TeachMe is running at ${url}`);
  if (!isLoopbackHost(options.host)) {
    process.stderr.write(
      `Warning: listening on ${options.host}, which is reachable from other machines. TeachMe has no authentication.\n`,
    );
  }

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
 * True if `value` is an IP literal (unbracketed) or an RFC 1123 hostname.
 * @param {string} value
 * @returns {boolean}
 */
function isValidHost(value) {
  if (net.isIP(value) !== 0) return true;
  if (/^[\d.]+$/.test(value)) return false; // looks like IPv4 but isn't one
  const label = "[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?";
  return value.length <= 253 && new RegExp(`^${label}(?:\\.${label})*$`).test(value);
}

/**
 * @param {string[]} argv
 * @returns {Promise<void>}
 */
async function main(argv) {
  const noOpen = argv.includes("--no-open");
  const filteredArgv = argv.filter((arg) => arg !== "--no-open");

  /** @type {{ values: { host?: string; port?: string; help?: boolean; json?: boolean; version?: boolean }; positionals: string[] }} */
  let parsed;
  try {
    parsed = parseArgs({
      args: filteredArgv,
      options: {
        host: { type: "string" },
        port: { type: "string" },
        help: { type: "boolean" },
        json: { type: "boolean" },
        version: { type: "boolean", short: "v" },
      },
      allowPositionals: true,
    });
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
    return;
  }

  const { values, positionals } = parsed;

  if (values.version) {
    console.log(readPackageVersion());
    return;
  }

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

  let host = DEFAULT_HOST;
  if (values.host !== undefined) {
    if (!isValidHost(values.host)) {
      process.stderr.write(
        `Invalid --host: ${values.host}. Must be an IPv4/IPv6 address or a hostname.\n`,
      );
      process.exitCode = 1;
      return;
    }
    host = values.host;
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

  await runServe(first, { host, port, open: !noOpen });
}

main(process.argv.slice(2)).catch((err) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exitCode = 1;
});
