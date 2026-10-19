import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { makeRepo } from "./gitRepo.js";
import { writeTree } from "./helpers.js";
import { isLoopbackHost, serverUrl, startServer } from "../server/serve.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const binPath = path.join(repoRoot, "bin", "teachme.js");
const exampleContentDir = path.join(repoRoot, "skill/teachme-authoring/examples/.teachme");

/**
 * @returns {string}
 */
function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "teachme-home-"));
}

/**
 * Run the CLI to completion and collect its output.
 * @param {string[]} args
 * @returns {Promise<{ code: number | null; stdout: string; stderr: string }>}
 */
function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [binPath, ...args], {
      cwd: repoRoot,
      env: { ...process.env, TEACHME_HOME: tmpHome() },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

describe("teachme --version", () => {
  const pkgVersion = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"))
    .version;

  it("prints the package version and exits 0", async () => {
    const { code, stdout, stderr } = await run(["--version"]);
    expect(stderr).toBe("");
    expect(stdout).toBe(`${pkgVersion}\n`);
    expect(code).toBe(0);
  });

  it("-v is an alias for --version", async () => {
    const { code, stdout, stderr } = await run(["-v"]);
    expect(stderr).toBe("");
    expect(stdout).toBe(`${pkgVersion}\n`);
    expect(code).toBe(0);
  });

  it("works from a cwd outside the repo", async () => {
    const { code, stdout, stderr } = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [binPath, "--version"], {
        cwd: os.tmpdir(),
        env: { ...process.env, TEACHME_HOME: tmpHome() },
      });
      let out = "";
      let err = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      child.on("error", reject);
      child.on("close", (c) => resolve({ code: c, stdout: out, stderr: err }));
    });
    expect(stderr).toBe("");
    expect(stdout).toBe(`${pkgVersion}\n`);
    expect(code).toBe(0);
  });
});

describe("teachme validate", () => {
  it("validate example exits 0", async () => {
    const { code, stdout, stderr } = await run(["validate", exampleContentDir]);
    expect(stderr).toBe("");
    expect(stdout).toMatch(/^0 errors, 0 warnings$/m);
    expect(code).toBe(0);
  });

  it("validate broken exits 1 and prints ERROR", async () => {
    const dir = writeTree({
      ".teachme/courses/broken/course.md": "no frontmatter title here\n",
    });
    const contentDir = path.join(dir, ".teachme");

    const { code, stdout } = await run(["validate", contentDir]);
    expect(stdout).toMatch(/^ERROR /m);
    expect(stdout).toMatch(/^1 errors, 0 warnings$/m);
    expect(code).toBe(1);
  });

  it("missing dir exits 1", async () => {
    const missing = path.join(os.tmpdir(), `teachme-missing-${Date.now()}`);
    const { code, stderr, stdout } = await run(["validate", missing]);
    expect(stderr).toBe(
      `No TeachMe content at ${missing}. Create it with the teachme-authoring skill.\n`,
    );
    expect(stdout).toBe("");
    expect(code).toBe(1);
  });
});

describe("teachme status", () => {
  it("status --json reports never-synced content", async () => {
    const repo = makeRepo({
      ".teachme/courses/arch/course.md": "---\ntitle: Architecture\n---\nIntro.\n",
      ".teachme/courses/arch/01-setup.md": "---\ntitle: Setup\n---\nBody.\n",
    });
    const contentDir = path.join(repo.dir, ".teachme");

    const { code, stdout, stderr } = await run(["status", contentDir, "--json"]);
    expect(stderr).toBe("");
    expect(code).toBe(0);

    const report = JSON.parse(stdout);
    expect(report.items).toEqual([
      expect.objectContaining({ kind: "course", slug: "arch", state: "never-synced" }),
    ]);
  });

  it("not a git repository exits 1", async () => {
    const dir = writeTree({
      ".teachme/courses/arch/course.md": "---\ntitle: Architecture\n---\nIntro.\n",
      ".teachme/courses/arch/01-setup.md": "---\ntitle: Setup\n---\nBody.\n",
    });
    const contentDir = path.join(dir, ".teachme");

    const { code, stdout, stderr } = await run(["status", contentDir]);
    expect(stderr).toBe("teachme status needs a git repository\n");
    expect(stdout).toBe("");
    expect(code).toBe(1);
  });
  it("repository without commits exits 1", async () => {
    const dir = writeTree({
      ".teachme/courses/arch/course.md": "---\ntitle: Architecture\n---\nIntro.\n",
      ".teachme/courses/arch/01-setup.md": "---\ntitle: Setup\n---\nBody.\n",
    });
    execFileSync("git", ["init", "-q"], { cwd: dir, stdio: "ignore" });
    const contentDir = path.join(dir, ".teachme");

    const { code, stdout, stderr } = await run(["status", contentDir]);
    expect(stderr).toBe("teachme status needs at least one commit\n");
    expect(stdout).toBe("");
    expect(code).toBe(1);
  });
});

describe("teachme serve", () => {
  /** @type {import('node:child_process').ChildProcess[]} */
  const children = [];

  afterEach(async () => {
    for (const child of children.splice(0)) {
      child.kill();
      await new Promise((resolve) => child.on("close", resolve));
    }
  });

  /**
   * Spawn `teachme <example> --no-open --port 0 ...extra` and resolve once it
   * prints its URL.
   * @param {string[]} extra
   * @returns {Promise<{ url: string; stderr: () => string }>}
   */
  function spawnServe(extra) {
    const child = spawn(
      process.execPath,
      [binPath, exampleContentDir, "--no-open", "--port", "0", ...extra],
      { cwd: repoRoot, env: { ...process.env, TEACHME_HOME: tmpHome() } },
    );
    children.push(child);
    let err = "";
    child.stderr.on("data", (d) => (err += d));
    return new Promise((resolve, reject) => {
      let buf = "";
      const onData = (/** @type {Buffer} */ d) => {
        buf += d.toString();
        const m = buf.match(/TeachMe is running at (\S+)/);
        if (m) {
          child.stdout.off("data", onData);
          // Give the post-URL warning a moment to land on stderr.
          setTimeout(() => resolve({ url: m[1], stderr: () => err }), 50);
        }
      };
      child.stdout.on("data", onData);
      child.on("error", reject);
      child.on("close", (code) => reject(new Error(`teachme exited early with code ${code}: ${err}`)));
    });
  }

  it("defaults to 127.0.0.1 without a warning", async () => {
    const { url, stderr } = await spawnServe([]);
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(stderr()).not.toMatch(/Warning: listening/);
  });

  it("--host localhost binds there without a warning", async () => {
    const { url, stderr } = await spawnServe(["--host", "localhost"]);
    expect(url).toMatch(/^http:\/\/localhost:\d+$/);
    expect(stderr()).not.toMatch(/Warning: listening/);
    const res = await fetch(`${url}/api/catalog`);
    expect(res.status).toBe(200);
  });

  it("--host 0.0.0.0 prints a loopback URL and a no-auth warning", async () => {
    const { url, stderr } = await spawnServe(["--host", "0.0.0.0"]);
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(stderr()).toContain(
      "Warning: listening on 0.0.0.0, which is reachable from other machines. TeachMe has no authentication.\n",
    );
    const res = await fetch(`${url}/api/catalog`);
    expect(res.status).toBe(200);
  });

  it("serve answers catalog", async () => {
    const child = spawn(
      process.execPath,
      [binPath, exampleContentDir, "--no-open", "--port", "0"],
      { cwd: repoRoot, env: { ...process.env, TEACHME_HOME: tmpHome() } },
    );
    children.push(child);

    const url = await new Promise((resolve, reject) => {
      let buf = "";
      const onData = (/** @type {Buffer} */ d) => {
        buf += d.toString();
        const m = buf.match(/TeachMe is running at (\S+)/);
        if (m) {
          child.stdout.off("data", onData);
          resolve(m[1]);
        }
      };
      child.stdout.on("data", onData);
      child.on("error", reject);
      child.on("close", (code) => reject(new Error(`teachme exited early with code ${code}`)));
    });

    const res = await fetch(`${url}/api/catalog`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.courses)).toBe(true);
    expect(body.courses.some((/** @type {{ slug: string }} */ c) => c.slug === "teachme-basics")).toBe(
      true,
    );
  });
});

describe("teachme --host validation", () => {
  it("--help lists --host", async () => {
    const { code, stdout } = await run(["--help"]);
    expect(stdout).toMatch(/--host <addr>/);
    expect(code).toBe(0);
  });

  it.each(["not a host", "999.1.1.1", "bad-", "[::1]"])("rejects --host %j", async (host) => {
    const { code, stdout, stderr } = await run([exampleContentDir, "--no-open", "--host", host]);
    expect(stderr).toBe(`Invalid --host: ${host}. Must be an IPv4/IPv6 address or a hostname.\n`);
    expect(stdout).toBe("");
    expect(code).toBe(1);
  });
});

describe("serverUrl / isLoopbackHost", () => {
  it("builds browser URLs", () => {
    expect(serverUrl("127.0.0.1", 4321)).toBe("http://127.0.0.1:4321");
    expect(serverUrl("localhost", 80)).toBe("http://localhost:80");
    expect(serverUrl("0.0.0.0", 1)).toBe("http://127.0.0.1:1");
    expect(serverUrl("::", 1)).toBe("http://[::1]:1");
    expect(serverUrl("::1", 1)).toBe("http://[::1]:1");
    expect(serverUrl("fe80::1", 1)).toBe("http://[fe80::1]:1");
    expect(serverUrl("192.168.1.5", 1)).toBe("http://192.168.1.5:1");
  });

  it("recognises loopback hosts", () => {
    for (const h of ["127.0.0.1", "127.1.2.3", "localhost", "LOCALHOST", "::1", "::ffff:127.0.0.1"]) {
      expect(isLoopbackHost(h)).toBe(true);
    }
    for (const h of ["0.0.0.0", "::", "192.168.1.5", "example.com", "fe80::1"]) {
      expect(isLoopbackHost(h)).toBe(false);
    }
  });
});

describe("startServer", () => {
  beforeAll(() => {
    process.env.TEACHME_HOME = tmpHome();
  });

  it("spa fallback serves index.html for unknown paths", async () => {
    const distDir = writeTree({
      "index.html": "<!doctype html><html><body>TeachMe UI</body></html>",
    });

    const { url, close } = await startServer({
      contentDir: exampleContentDir,
      repoRoot,
      distDir,
      port: 0,
    });

    try {
      const res = await fetch(`${url}/courses/teachme-basics`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/html/);
      const text = await res.text();
      expect(text).toContain("TeachMe UI");

      const api = await fetch(`${url}/api/catalog`);
      expect(api.status).toBe(200);
    } finally {
      await close();
    }
  });

  it("returns 503 when the UI is not built", async () => {
    const distDir = writeTree({});

    const { url, close } = await startServer({
      contentDir: exampleContentDir,
      repoRoot,
      distDir,
      port: 0,
    });

    try {
      const res = await fetch(`${url}/`);
      expect(res.status).toBe(503);
      const text = await res.text();
      expect(text).toBe('TeachMe UI is not built. Run "npm run build".');
    } finally {
      await close();
    }
  });

  it("survives a server-level error after startup", async () => {
    const distDir = writeTree({
      "index.html": "<!doctype html><html><body>TeachMe UI</body></html>",
    });

    // Capture the underlying http.Server that startServer() creates
    // internally (its public return value only exposes { url, close }), so
    // we can simulate a post-startup, server-level error (e.g. EMFILE during
    // accept) the same way Node would emit one.
    const createServerSpy = vi.spyOn(http, "createServer");
    const { url, close } = await startServer({
      contentDir: exampleContentDir,
      repoRoot,
      distDir,
      port: 0,
    });
    const server = createServerSpy.mock.results[0].value;
    createServerSpy.mockRestore();

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      // If serve.js didn't keep a persistent 'error' listener on the server,
      // this emit would throw (an unhandled 'error' event on an
      // EventEmitter crashes the process) and fail the test.
      server.emit("error", new Error("simulated accept error"));

      expect(stderrSpy).toHaveBeenCalledWith(
        "TeachMe server error: simulated accept error\n",
      );

      // The server must still be usable after the error.
      const res = await fetch(`${url}/api/catalog`);
      expect(res.status).toBe(200);
    } finally {
      stderrSpy.mockRestore();
      await close();
    }
  });

  it("binds to an explicit host and returns a browser URL for it", async () => {
    const distDir = writeTree({});
    const createServerSpy = vi.spyOn(http, "createServer");
    const { url, close } = await startServer({
      contentDir: exampleContentDir,
      repoRoot,
      distDir,
      host: "0.0.0.0",
      port: 0,
    });
    const server = createServerSpy.mock.results[0].value;
    createServerSpy.mockRestore();

    try {
      const addr = server.address();
      expect(addr.address).toBe("0.0.0.0");
      expect(url).toBe(`http://127.0.0.1:${addr.port}`);
      const res = await fetch(`${url}/api/catalog`);
      expect(res.status).toBe(200);
    } finally {
      await close();
    }
  });
});
