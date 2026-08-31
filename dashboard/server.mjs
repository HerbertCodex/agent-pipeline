import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readJsonl } from "../scripts/lib.mjs";
import { computeWave } from "../scripts/next-issues.mjs";
import { projectedStatus, readIssueTracker, trackerMatch } from "../scripts/issue-tracker.mjs";
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
    runtime_run_id: run.runtime_run_id,
    run_record: run.run_record,
    issue_id: run.issue_id,
    role: run.role,
    status: run.status,
    started_at: run.started_at,
    updated_at: run.updated_at,
    elapsed_ms: run.elapsed_ms,
    exit_code: run.exit_code,
    output: run.output,
    interactive: run.interactive,
  };
}

function processEvent(run, event) {
  if (event.type === "started") {
    run.status = "running";
    if (typeof event.run_id === "string") run.runtime_run_id = event.run_id;
  }
  if (event.type === "heartbeat" && Number.isFinite(event.elapsed_ms)) run.elapsed_ms = event.elapsed_ms;
  if (event.type === "output" && typeof event.text === "string") appendOutput(run, event.text);
  if (event.type === "interrupted") run.status = "interrupted";
  if (event.type === "completed") {
    run.status = event.exit_code === 0 ? "completed" : "failed";
    run.exit_code = event.exit_code;
    if (Number.isFinite(event.elapsed_ms)) run.elapsed_ms = event.elapsed_ms;
    if (typeof event.run_record === "string") run.run_record = event.run_record;
  }
  run.updated_at = new Date().toISOString();
}

function defaultLaunch(frameworkRoot, cwd, issueId, role) {
  return spawn(
    process.execPath,
    [join(frameworkRoot, "scripts", "dispatch.mjs"), issueId, role, "--json"],
    { cwd, env: process.env, shell: false, stdio: ["pipe", "pipe", "pipe"] },
  );
}

function readProjectJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${label} cannot be read: ${error.message}`);
  }
}

function recommendation(record, rules, ready, waiting) {
  const phase = record.pipeline_state?.phase ?? "unknown";
  const owner = rules.phases?.[phase]?.owner ?? "unknown";
  if (phase === "planned") {
    const available = ready.get(record.id);
    if (available != null) {
      return { role: available.role, dispatchable: true, reason: "Ready to start" };
    }
    return {
      role: null,
      dispatchable: false,
      reason: waiting.get(record.id) ?? "Not in the current dispatchable wave",
    };
  }
  if (phase === "closed") {
    return { role: null, dispatchable: false, reason: "Issue already closed" };
  }
  if (phase === "operator_escalation") {
    return { role: null, dispatchable: false, reason: "Waiting for the operator" };
  }
  if (phase === "ready_for_qa") {
    return { role: "qa", dispatchable: true, reason: "Ready for QA" };
  }
  if (ROLES.has(owner)) {
    const action = phase.startsWith("blocked_") ? "Unblock with the phase owner" : "Resume the phase owner";
    return { role: owner, dispatchable: true, reason: action };
  }
  return { role: null, dispatchable: false, reason: `No agent owns phase ${phase}` };
}

function titleOf(record) {
  for (const key of ["title", "summary", "name", "description"]) {
    if (typeof record[key] === "string" && record[key].trim().length > 0) return record[key].trim();
  }
  return "Untitled issue";
}

function publicIssue(record, rules, ready, waiting) {
  const phase = record.pipeline_state?.phase ?? "unknown";
  return {
    id: record.id,
    title: titleOf(record),
    spec_id: record.spec_id ?? null,
    phase,
    owner: rules.phases?.[phase]?.owner ?? "unknown",
    priority: record.priority ?? null,
    depends_on: Array.isArray(record.depends_on) ? record.depends_on : [],
    reservations: Array.isArray(record.pipeline_state?.file_reservations)
      ? record.pipeline_state.file_reservations
      : [],
    criteria_count: Array.isArray(record.acceptance_criteria)
      ? record.acceptance_criteria.length
      : 0,
    ...recommendation(record, rules, ready, waiting),
  };
}

function trackerIssueWithoutControl(entry, dependencies, managedTag) {
  const record = entry.record;
  const managed = typeof managedTag === "string" && record.tags?.includes(managedTag);
  return {
    id: record.id,
    title: titleOf(record),
    spec_id: null,
    phase: "not_imported",
    tracker_status: record.status,
    owner: managed ? "product" : "operator",
    priority: record.priority ?? null,
    depends_on: dependencies.get(record.id) ?? [],
    reservations: [],
    criteria_count: 0,
    role: managed ? "product" : null,
    dispatchable: false,
    reason: managed
      ? "Import this Sudocode issue into pipeline control"
      : `Add the ${managedTag} tag to manage this issue with the pipeline`,
  };
}

function issueFromTracker(control, match, snapshot, config, rules, ready, waiting) {
  const source = match.entry.record;
  const merged = {
    ...control,
    title: source.title,
    priority: source.priority ?? null,
    depends_on: snapshot.dependencies.get(source.id) ?? [],
  };
  const issue = {
    ...publicIssue(merged, rules, ready, waiting),
    tracker_status: source.status,
  };
  const managedTag = config.issue_tracker?.managed_tag;
  if (typeof managedTag === "string" && !source.tags?.includes(managedTag)) {
    return { ...issue, role: null, dispatchable: false, reason: `Missing Sudocode tag ${managedTag}` };
  }
  if (match.drift != null) {
    return {
      ...issue,
      role: null,
      dispatchable: false,
      reason: `Sudocode scope is ${match.drift}; refresh pipeline control`,
    };
  }
  const desired = projectedStatus(control.pipeline_state?.phase ?? "unknown", config);
  if (source.status !== desired) {
    return {
      ...issue,
      role: null,
      dispatchable: false,
      reason: `Sudocode status must be ${desired}; run tracker-sync --apply`,
    };
  }
  return issue;
}

/**
 * Reads the host project's issue store and derives safe dispatch choices.
 *
 * @param {string} cwd - Host project root containing pipeline.config.json.
 * @returns {Array<object>} Public issue rows with their recommended role.
 */
export function readIssueCatalog(cwd) {
  const config = readProjectJson(resolve(cwd, "pipeline.config.json"), "pipeline configuration");
  if (typeof config.store_dir !== "string" || typeof config.rules_path !== "string") {
    throw new Error("pipeline configuration must declare store_dir and rules_path");
  }
  const rules = readProjectJson(resolve(cwd, config.rules_path), "pipeline rules");
  const records = readJsonl(resolve(cwd, config.store_dir, "issues.jsonl")).map(
    (entry) => entry.record,
  );
  const wave = computeWave(records, rules, null, config);
  const ready = new Map(wave.ready.map((item) => [item.id, item]));
  const waiting = new Map(wave.waiting.map((item) => [item.id, item.reason]));
  const tracker = readIssueTracker(config, cwd);
  if (tracker == null) return records.map((record) => publicIssue(record, rules, ready, waiting));

  const controls = new Map(records.map((record) => [record.id, record]));
  const issues = tracker.issues.map((entry) => {
    const control = controls.get(entry.record.id);
    if (control == null) {
      return trackerIssueWithoutControl(entry, tracker.dependencies, config.issue_tracker?.managed_tag);
    }
    controls.delete(control.id);
    return issueFromTracker(
      control,
      trackerMatch(control, tracker),
      tracker,
      config,
      rules,
      ready,
      waiting,
    );
  });
  for (const control of controls.values()) {
    issues.push({
      ...publicIssue(control, rules, ready, waiting),
      tracker_status: null,
      role: null,
      dispatchable: false,
      reason: "Pipeline control has no matching Sudocode issue",
    });
  }
  return issues;
}

class RunRegistry {
  constructor(launchProcess, interactiveInput) {
    this.launchProcess = launchProcess;
    this.interactiveInput = interactiveInput;
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
      runtime_run_id: null,
      run_record: null,
      issue_id: issueId,
      role,
      status: "starting",
      started_at: timestamp,
      updated_at: timestamp,
      elapsed_ms: 0,
      exit_code: null,
      output: "",
      interactive: this.interactiveInput,
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
    child.stdin?.on("error", (error) => {
      appendOutput(run, `\n[interactive input unavailable] ${error.message}\n`);
      this.broadcast();
    });
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

  sendInput(id, message) {
    if (!this.interactiveInput) return { ok: false, reason: "interactive input is disabled for this runtime" };
    const child = this.children.get(id);
    if (child == null || child.stdin == null || child.stdin.destroyed || !child.stdin.writable) {
      return { ok: false, reason: "active runtime input is unavailable" };
    }
    try {
      child.stdin.write(`${message}\n`);
    } catch (error) {
      return { ok: false, reason: `runtime input failed: ${error.message}` };
    }
    const run = this.runs.get(id);
    if (run != null) appendOutput(run, `\n[operator] ${message}\n`);
    this.broadcast();
    return { ok: true };
  }

  hasActive(issueId) {
    return [...this.children.keys()].some((id) => this.runs.get(id)?.issue_id === issueId);
  }

  shutdown() {
    for (const client of this.clients) client.end();
    this.clients.clear();
    for (const child of this.children.values()) child.kill("SIGTERM");
    this.children.clear();
  }
}

function issuesSnapshot(issueSource, registry) {
  return {
    generated_at: new Date().toISOString(),
    issues: issueSource().map((issue) =>
      registry.hasActive(issue.id)
        ? { ...issue, dispatchable: false, reason: "An agent is already running", active: true }
        : { ...issue, active: false },
    ),
  };
}

function serveIssues(response, issueSource, registry) {
  try {
    sendJson(response, 200, issuesSnapshot(issueSource, registry));
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
}

function serveReadRoute(request, response, pathname, registry, token, issueSource) {
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
  if (pathname === "/api/issues") {
    serveIssues(response, issueSource, registry);
    return true;
  }
  if (pathname === "/events") {
    registry.subscribe(request, response);
    return true;
  }
  return false;
}

async function dispatch(request, response, registry, issueSource) {
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
    const issue = issuesSnapshot(issueSource, registry).issues.find(
      (candidate) => candidate.id === body.issue_id,
    );
    if (issue == null) {
      sendJson(response, 404, { error: `issue not found: ${body.issue_id}` });
      return;
    }
    if (!issue.dispatchable) {
      sendJson(response, 409, { error: issue.reason });
      return;
    }
    if (issue.role !== body.role) {
      sendJson(response, 409, { error: `issue requires role ${issue.role}` });
      return;
    }
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

async function serveMutationRoute(request, response, pathname, registry, token, issueSource) {
  if (request.method !== "POST") return false;
  if (request.headers["x-dashboard-token"] !== token) {
    sendJson(response, 403, { error: "request token refused" });
    return true;
  }
  if (pathname === "/api/dispatch") {
    await dispatch(request, response, registry, issueSource);
    return true;
  }
  const input = pathname.match(/^\/api\/runs\/([A-Za-z0-9-]+)\/input$/);
  if (input != null) {
    let body;
    try {
      body = await readJson(request);
    } catch (error) {
      sendJson(response, 400, { error: error.message });
      return true;
    }
    if (typeof body.message !== "string" || body.message.trim().length === 0 || body.message.length > 4_000) {
      sendJson(response, 400, { error: "message must contain between 1 and 4000 characters" });
      return true;
    }
    const result = registry.sendInput(input[1], body.message.trim());
    sendJson(response, result.ok ? 202 : 409, result.ok ? { run_id: input[1], status: "sent" } : { error: result.reason });
    return true;
  }
  return interrupt(response, registry, pathname);
}

function requestHandler(registry, token, issueSource) {
  return async (request, response) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (serveReadRoute(request, response, pathname, registry, token, issueSource)) return;
    if (await serveMutationRoute(request, response, pathname, registry, token, issueSource)) return;
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
 * @param {Function} [options.issueSource] - Testable issue catalog reader.
 * @param {boolean} [options.interactiveInput] - Override runtime stdin capability.
 * @returns {object} Dashboard lifecycle and its HTTP server state.
 */
export function createDashboard({
  cwd = process.cwd(),
  frameworkRoot = DEFAULT_FRAMEWORK_ROOT,
  launchProcess = null,
  issueSource = null,
  interactiveInput = null,
} = {}) {
  const token = randomBytes(24).toString("hex");
  const launcher =
    launchProcess ??
    ((issueId, role) => defaultLaunch(frameworkRoot, cwd, issueId, role));
  let acceptsInput = interactiveInput;
  if (acceptsInput == null) {
    try {
      const config = readProjectJson(resolve(cwd, "pipeline.config.json"), "pipeline configuration");
      acceptsInput = config.agent_runtime?.interactive_input === true;
    } catch {
      acceptsInput = false;
    }
  }
  const registry = new RunRegistry(launcher, acceptsInput === true);
  const source = issueSource ?? (() => readIssueCatalog(cwd));
  const server = createServer(requestHandler(registry, token, source));
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
