import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dashboardPage } from "./page.mjs";

const ROLES = new Set(["orchestrator", "product", "implementer", "qa"]);
const ISSUE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const OUTPUT_LIMIT = 40_000;
const BODY_LIMIT = 16_384;
const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);
const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_FRAMEWORK_ROOT = join(HERE, "..");

function sendJson(response, status, value) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(value));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    let oversized = false;
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      if (oversized) return;
      body += chunk;
      if (body.length > BODY_LIMIT) oversized = true;
    });
    request.on("end", () => {
      if (oversized) reject(new Error("request body exceeds 16 KiB"));
      else parseJson(body, resolve, reject);
    });
    request.on("error", reject);
  });
}

function parseJson(body, resolve, reject) {
  try {
    resolve(body.length === 0 ? {} : JSON.parse(body));
  } catch {
    reject(new Error("request body is not valid JSON"));
  }
}

function appendOutput(run, text) {
  run.output = `${run.output}${text}`.slice(-OUTPUT_LIMIT);
  run.updated_at = new Date().toISOString();
}

function publicRun(run) {
  return {
    id: run.id,
    issue_id: run.issue_id,
    role: run.role,
    status: run.status,
    started_at: run.started_at,
    updated_at: run.updated_at,
    elapsed_ms: run.elapsed_ms,
    exit_code: run.exit_code,
    output: run.output,
  };
}

function processEvent(run, event) {
  if (event.type === "started") run.status = "running";
  if (event.type === "heartbeat" && Number.isFinite(event.elapsed_ms)) run.elapsed_ms = event.elapsed_ms;
  if (event.type === "output" && typeof event.text === "string") appendOutput(run, event.text);
  if (event.type === "interrupted") run.status = "interrupted";
  if (event.type === "completed") {
    run.status = event.exit_code === 0 ? "completed" : "failed";
    run.exit_code = event.exit_code;
    if (Number.isFinite(event.elapsed_ms)) run.elapsed_ms = event.elapsed_ms;
  }
  run.updated_at = new Date().toISOString();
}

function defaultLaunch(frameworkRoot, cwd, issueId, role) {
  return spawn(
    process.execPath,
    [join(frameworkRoot, "scripts", "dispatch.mjs"), issueId, role, "--json"],
    { cwd, env: process.env, shell: false, stdio: ["ignore", "pipe", "pipe"] },
  );
}

class RunRegistry {
  constructor(launchProcess) {
    this.launchProcess = launchProcess;
    this.runs = new Map();
    this.children = new Map();
    this.clients = new Set();
  }

  snapshot() {
    return {
      generated_at: new Date().toISOString(),
      runs: [...this.runs.values()].reverse().map(publicRun),
    };
  }

  broadcast() {
    const frame = `data: ${JSON.stringify(this.snapshot())}\n\n`;
    for (const client of this.clients) client.write(frame);
  }

  subscribe(request, response) {
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
      "x-content-type-options": "nosniff",
    });
    this.clients.add(response);
    response.write(`data: ${JSON.stringify(this.snapshot())}\n\n`);
    request.on("close", () => this.clients.delete(response));
  }

  launch(issueId, role) {
    const id = randomUUID();
    const timestamp = new Date().toISOString();
    const run = {
      id,
      issue_id: issueId,
      role,
      status: "starting",
      started_at: timestamp,
      updated_at: timestamp,
      elapsed_ms: 0,
      exit_code: null,
      output: "",
    };
    const child = this.launchProcess(issueId, role);
    this.runs.set(id, run);
    this.children.set(id, child);
    this.bind(child, run);
    this.broadcast();
    return id;
  }

  bind(child, run) {
    let buffer = "";
    child.stdout.on("data", (chunk) => {
      buffer = this.consume(run, buffer + chunk.toString());
      this.broadcast();
    });
    child.stderr.on("data", (chunk) => {
      appendOutput(run, chunk.toString());
      this.broadcast();
    });
    child.on("error", (error) => this.fail(run, error));
    child.on("close", (code) => this.finish(run, code, buffer));
  }

  consume(run, body) {
    const lines = body.split("\n");
    const remaining = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim().length === 0) continue;
      try {
        processEvent(run, JSON.parse(line));
      } catch {
        appendOutput(run, `${line}\n`);
      }
    }
    return remaining;
  }

  fail(run, error) {
    appendOutput(run, `${error.message}\n`);
    run.status = "failed";
    run.exit_code = 1;
    this.children.delete(run.id);
    this.broadcast();
  }

  finish(run, code, buffer) {
    if (buffer.trim().length > 0) appendOutput(run, `${buffer}\n`);
    if (["starting", "running"].includes(run.status)) {
      run.status = code === 0 ? "completed" : "failed";
      run.exit_code = code ?? 1;
    }
    this.children.delete(run.id);
    this.broadcast();
  }

  interrupt(id) {
    const child = this.children.get(id);
    if (child == null) return false;
    child.kill("SIGTERM");
    const run = this.runs.get(id);
    if (run != null) {
      run.status = "interrupted";
      run.updated_at = new Date().toISOString();
    }
    this.broadcast();
    return true;
  }

  shutdown() {
    for (const client of this.clients) client.end();
    this.clients.clear();
    for (const child of this.children.values()) child.kill("SIGTERM");
    this.children.clear();
  }
}

function serveReadRoute(request, response, pathname, registry, token) {
  if (request.method !== "GET") return false;
  if (pathname === "/") {
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy":
        "default-src 'none'; connect-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
    });
    response.end(dashboardPage(token));
    return true;
  }
  if (pathname === "/api/snapshot") {
    sendJson(response, 200, registry.snapshot());
    return true;
  }
  if (pathname === "/events") {
    registry.subscribe(request, response);
    return true;
  }
  return false;
}

async function dispatch(request, response, registry) {
  let body;
  try {
    body = await readJson(request);
  } catch (error) {
    sendJson(response, 400, { error: error.message });
    return;
  }
  if (typeof body.issue_id !== "string" || !ISSUE_ID.test(body.issue_id)) {
    sendJson(response, 400, { error: "issue_id is malformed" });
    return;
  }
  if (typeof body.role !== "string" || !ROLES.has(body.role)) {
    sendJson(response, 400, { error: "role is unknown" });
    return;
  }
  try {
    sendJson(response, 202, { run_id: registry.launch(body.issue_id, body.role) });
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
}

function interrupt(response, registry, pathname) {
  const match = pathname.match(/^\/api\/runs\/([A-Za-z0-9-]+)\/interrupt$/);
  if (match == null) return false;
  if (!registry.interrupt(match[1])) {
    sendJson(response, 404, { error: "active run not found" });
    return true;
  }
  sendJson(response, 202, { run_id: match[1], status: "interrupted" });
  return true;
}

async function serveMutationRoute(request, response, pathname, registry, token) {
  if (request.method !== "POST") return false;
  if (request.headers["x-dashboard-token"] !== token) {
    sendJson(response, 403, { error: "request token refused" });
    return true;
  }
  if (pathname === "/api/dispatch") {
    await dispatch(request, response, registry);
    return true;
  }
  return interrupt(response, registry, pathname);
}

function requestHandler(registry, token) {
  return async (request, response) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (serveReadRoute(request, response, pathname, registry, token)) return;
    if (await serveMutationRoute(request, response, pathname, registry, token)) return;
    sendJson(response, 404, { error: "not found" });
  };
}

function lifecycle(server, registry, token) {
  return {
    token,
    listen(port = 4399, host = "127.0.0.1", { allowNonLoopback = false } = {}) {
      if (!LOOPBACK.has(host) && !allowNonLoopback) {
        return Promise.reject(new Error("the dashboard only binds to a loopback address"));
      }
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          resolve();
        });
      });
    },
    address() {
      return server.address();
    },
    close() {
      registry.shutdown();
      if (!server.listening) return Promise.resolve();
      return new Promise((resolve, reject) => {
        server.close((error) => (error == null ? resolve() : reject(error)));
      });
    },
  };
}

/**
 * Creates a local dashboard over the portable dispatch event stream.
 *
 * The dashboard launches the existing dispatch command rather than owning a
 * second scheduler. Mutating requests require a random token embedded only in
 * the same-origin page, and the command is spawned without a shell.
 *
 * @param {object} options - Host paths and optional process launcher.
 * @param {string} [options.cwd] - Host project working directory.
 * @param {string} [options.frameworkRoot] - Root containing the core scripts.
 * @param {Function} [options.launchProcess] - Testable dispatch launcher.
 * @returns {object} Dashboard lifecycle and its HTTP server state.
 */
export function createDashboard({
  cwd = process.cwd(),
  frameworkRoot = DEFAULT_FRAMEWORK_ROOT,
  launchProcess = null,
} = {}) {
  const token = randomBytes(24).toString("hex");
  const launcher =
    launchProcess ??
    ((issueId, role) => defaultLaunch(frameworkRoot, cwd, issueId, role));
  const registry = new RunRegistry(launcher);
  const server = createServer(requestHandler(registry, token));
  return lifecycle(server, registry, token);
}

function cliOptions(args) {
  const portAt = args.indexOf("--port");
  const hostAt = args.indexOf("--host");
  const port = portAt === -1 ? 4399 : Number(args[portAt + 1]);
  const host = hostAt === -1 ? "127.0.0.1" : args[hostAt + 1];
  const allowNonLoopback = args.includes("--allow-non-loopback");
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("--port must be an integer between 0 and 65535");
  }
  if (typeof host !== "string" || host.length === 0) {
    throw new Error("--host must name an address");
  }
  if (!LOOPBACK.has(host) && !allowNonLoopback) {
    throw new Error("a non-loopback --host requires --allow-non-loopback");
  }
  return { port, host, allowNonLoopback };
}

async function main() {
  try {
    const options = cliOptions(process.argv.slice(2));
    const dashboard = createDashboard();
    await dashboard.listen(options.port, options.host, {
      allowNonLoopback: options.allowNonLoopback,
    });
    const address = dashboard.address();
    const port = address != null && typeof address === "object" ? address.port : options.port;
    console.log(`Agent dashboard: http://${options.host}:${port}`);
    const close = async () => {
      await dashboard.close();
      process.exit(0);
    };
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
