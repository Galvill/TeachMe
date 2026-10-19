import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { createHandler } from "./api.js";
import { createProgressStore } from "./progress.js";

/** @typedef {import('../shared/types.js').Content} Content */
/** @typedef {import('node:http').IncomingMessage} IncomingMessage */
/** @typedef {import('node:http').ServerResponse} ServerResponse */

const DEFAULT_PORT = 4321;
const MAX_PORT_ATTEMPTS = 20;
export const DEFAULT_HOST = "127.0.0.1";
const NOT_BUILT_MESSAGE = 'TeachMe UI is not built. Run "npm run build".';

/** @type {Record<string, string>} */
const STATIC_CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

/**
 * Format a `Content`'s errors/warnings for `teachme validate`: one
 * `ERROR <file>: <message>` line per error, then one `WARN <file>: <message>`
 * line per warning, then a `N errors, M warnings` summary line.
 * @param {Content} content
 * @returns {string}
 */
export function formatIssues(content) {
  /** @type {string[]} */
  const lines = [];
  for (const issue of content.errors) lines.push(`ERROR ${issue.file}: ${issue.message}`);
  for (const issue of content.warnings) lines.push(`WARN ${issue.file}: ${issue.message}`);
  lines.push(`${content.errors.length} errors, ${content.warnings.length} warnings`);
  return lines.join("\n");
}

/**
 * True if `host` only accepts connections from this machine: `localhost`, any
 * `127.0.0.0/8` address, `::1`, or an IPv4-mapped loopback (`::ffff:127.x.x.x`).
 * @param {string} host
 * @returns {boolean}
 */
export function isLoopbackHost(host) {
  const h = host.toLowerCase();
  if (h === "localhost" || h === "::1") return true;
  const v4 = h.startsWith("::ffff:") ? h.slice("::ffff:".length) : h;
  return net.isIPv4(v4) && v4.startsWith("127.");
}

/**
 * The URL a browser should use to reach a server bound to `host:port`.
 * Wildcard binds (`0.0.0.0`, `::`) point at the matching loopback address,
 * and IPv6 literals are bracketed.
 * @param {string} host
 * @param {number} port
 * @returns {string}
 */
export function serverUrl(host, port) {
  let urlHost = host;
  if (host === "0.0.0.0") urlHost = "127.0.0.1";
  else if (host === "::") urlHost = "::1";
  if (net.isIPv6(urlHost)) urlHost = `[${urlHost}]`;
  return `http://${urlHost}:${port}`;
}

/**
 * Decode each `/`-separated segment of a raw URL path, rejoining with `/`.
 * Returns `null` if any segment fails to decode.
 * @param {string} raw
 * @returns {string | null}
 */
function decodePath(raw) {
  /** @type {string[]} */
  const parts = [];
  for (const segment of raw.split("/")) {
    try {
      parts.push(decodeURIComponent(segment));
    } catch {
      return null;
    }
  }
  return parts.join("/");
}

/**
 * Serve `distDir/index.html` (SPA fallback), or a 503 if it doesn't exist.
 * @param {ServerResponse} res
 * @param {string} distDir
 * @param {string} method
 * @returns {void}
 */
function sendIndexOrMissing(res, distDir, method) {
  const indexPath = path.join(distDir, "index.html");
  let stat;
  try {
    stat = fs.statSync(indexPath);
  } catch {
    stat = null;
  }
  if (!stat || !stat.isFile()) {
    res.statusCode = 503;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end(method === "HEAD" ? undefined : NOT_BUILT_MESSAGE);
    return;
  }
  serveFile(res, indexPath, method);
}

/**
 * @param {ServerResponse} res
 * @param {string} absPath
 * @param {string} method
 * @returns {void}
 */
function serveFile(res, absPath, method) {
  const ext = path.extname(absPath).toLowerCase();
  const contentType = STATIC_CONTENT_TYPES[ext] ?? "application/octet-stream";
  res.statusCode = 200;
  res.setHeader("Content-Type", contentType);
  if (method === "HEAD") {
    res.end();
    return;
  }
  const stream = fs.createReadStream(absPath);
  stream.on("error", () => {
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end();
    } else {
      res.destroy();
    }
  });
  stream.pipe(res);
}

/**
 * Create the static-file + SPA-fallback handler for `distDir`. GET/HEAD
 * only; any other method (or a path that escapes `distDir`, or a path that
 * doesn't resolve to a regular file) falls back to `index.html`.
 * @param {string} distDir
 * @returns {(req: IncomingMessage, res: ServerResponse) => void}
 */
function createStaticHandler(distDir) {
  const resolvedDistDir = path.resolve(distDir);

  return function handleStatic(req, res) {
    const method = req.method ?? "GET";
    if (method !== "GET" && method !== "HEAD") {
      res.statusCode = 404;
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", "http://localhost");
    const decoded = decodePath(url.pathname);
    if (decoded !== null) {
      const resolved = path.resolve(resolvedDistDir, decoded.replace(/^\/+/, ""));
      if (resolved.startsWith(resolvedDistDir + path.sep)) {
        let stat;
        try {
          stat = fs.statSync(resolved);
        } catch {
          stat = null;
        }
        if (stat && stat.isFile()) {
          serveFile(res, resolved, method);
          return;
        }
      }
    }

    sendIndexOrMissing(res, resolvedDistDir, method);
  };
}

/**
 * Listen on `host:port` (port 0 = OS-assigned), resolving once bound.
 * @param {http.Server} server
 * @param {string} host
 * @param {number} port
 * @returns {Promise<void>}
 */
function listenOnce(server, host, port) {
  return new Promise((resolve, reject) => {
    function onError(/** @type {NodeJS.ErrnoException} */ err) {
      cleanup();
      reject(err);
    }
    function onListening() {
      cleanup();
      resolve();
    }
    function cleanup() {
      server.removeListener("error", onError);
      server.removeListener("listening", onListening);
    }
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

/**
 * Bind `server` to `host`. `port === 0` asks the OS for a free port (no
 * retry). Otherwise starts at `port` (default `4321`) and, on `EADDRINUSE`,
 * retries the next port up to `MAX_PORT_ATTEMPTS` times total before
 * rejecting with the last error.
 * @param {http.Server} server
 * @param {string} host
 * @param {number} [port]
 * @returns {Promise<number>}
 */
async function listenWithRetry(server, host, port) {
  if (port === 0) {
    await listenOnce(server, host, 0);
    return /** @type {import('node:net').AddressInfo} */ (server.address()).port;
  }

  const startPort = port ?? DEFAULT_PORT;
  /** @type {NodeJS.ErrnoException | undefined} */
  let lastErr;
  for (let attempt = 0; attempt < MAX_PORT_ATTEMPTS; attempt += 1) {
    const candidate = startPort + attempt;
    try {
      await listenOnce(server, host, candidate);
      return candidate;
    } catch (err) {
      const errno = /** @type {NodeJS.ErrnoException} */ (err);
      if (errno.code !== "EADDRINUSE") throw errno;
      lastErr = errno;
    }
  }
  throw lastErr;
}

/**
 * Start the TeachMe HTTP server: the API/content handler from `server/api.js`
 * composed with a static-file server (falling back to `distDir/index.html`
 * for unknown paths) for everything else. Binds to `opts.host` (default
 * `127.0.0.1`); the returned `url` is what a browser should open (see
 * `serverUrl`).
 * @param {{ contentDir: string; repoRoot: string; host?: string; port?: number; distDir: string }} opts
 * @returns {Promise<{ url: string; close(): Promise<void> }>}
 */
export async function startServer(opts) {
  const contentDir = path.resolve(opts.contentDir);
  const { repoRoot, distDir } = opts;
  const store = createProgressStore();

  const apiHandler = createHandler({ contentDir, repoRoot, store });
  const staticHandler = createStaticHandler(distDir);

  const server = http.createServer((req, res) => {
    apiHandler(req, res, () => staticHandler(req, res));
  });

  const host = opts.host ?? DEFAULT_HOST;
  const port = await listenWithRetry(server, host, opts.port);

  // Persistent listener: after startup, a server-level error (e.g. EMFILE
  // during accept) must not crash the process, per spec §8 ("Nothing blocks
  // navigation") — an unhandled `error` event on an EventEmitter otherwise
  // throws.
  server.on("error", (err) => {
    process.stderr.write(`TeachMe server error: ${err instanceof Error ? err.message : String(err)}\n`);
  });

  return {
    url: serverUrl(host, port),
    close() {
      return new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
