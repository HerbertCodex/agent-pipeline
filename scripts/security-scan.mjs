import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { atomicWrite, loadConfig } from "./lib.mjs";
import { runStep as defaultRunStep } from "./setup-runner.mjs";
import { buildZapPlan, dockerInvocation, summarizeZapReport, validateSecurityTesting, zapExecutionBudgetMinutes } from "./security-testing.mjs";

const CATEGORIES = {
  A01: "Broken Access Control",
  A02: "Security Misconfiguration",
  A03: "Software Supply Chain Failures",
  A04: "Cryptographic Failures",
  A05: "Injection",
  A06: "Insecure Design",
  A07: "Authentication Failures",
  A08: "Software or Data Integrity Failures",
  A09: "Security Logging and Alerting Failures",
  A10: "Mishandling of Exceptional Conditions",
};
const ASSURANCE_STATUS = new Set(["unverified", "partial", "verified", "not_applicable"]);

function readJson(path, label) {
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (error) { throw new Error(`${label} cannot be read: ${error.message}`); }
}

/** Validates durable assurance and accepted-finding records before a scan. */
export function validateSecurityFiles(root, security, now = new Date(), commands = null) {
  const matrix = readJson(resolve(root, security.assurance.top10_2025), "OWASP Top 10 2025 matrix");
  if (JSON.stringify(Object.keys(matrix.categories ?? {})) !== JSON.stringify(Object.keys(CATEGORIES))) {
    throw new Error("OWASP Top 10 2025 matrix must carry A01 through A10 in order");
  }
  for (const [id, entry] of Object.entries(matrix.categories)) {
    if (entry.name !== CATEGORIES[id]) throw new Error(`OWASP category ${id} must be named ${CATEGORIES[id]}`);
    if (!ASSURANCE_STATUS.has(entry.status) || !Array.isArray(entry.controls) || !Array.isArray(entry.limitations)) {
      throw new Error(`OWASP category ${id} needs a status, controls, and limitations`);
    }
    if (entry.status === "verified" && entry.controls.length === 0) throw new Error(`OWASP category ${id} cannot be verified without a control`);
    if (entry.status === "partial" && entry.limitations.length === 0) throw new Error(`OWASP category ${id} needs a limitation while partially covered`);
    if (entry.status === "not_applicable" && entry.limitations.length === 0) throw new Error(`OWASP category ${id} needs a reason when not applicable`);
    for (const control of entry.controls) {
      if (control == null || typeof control !== "object" || typeof control.gate !== "string" || typeof control.description !== "string") {
        throw new Error(`OWASP category ${id} controls need a gate and description`);
      }
      if (commands != null && typeof commands[control.gate] !== "string") throw new Error(`OWASP category ${id} names undeclared gate ${control.gate}`);
    }
  }
  const findings = readJson(resolve(root, security.accepted_findings), "accepted security findings");
  if (!Array.isArray(findings)) throw new Error("accepted security findings must be a list");
  for (const finding of findings) {
    for (const key of ["rule_id", "url", "reason", "accepted_at", "expires_at"]) {
      if (typeof finding[key] !== "string" || finding[key].length === 0) throw new Error(`accepted security finding needs ${key}`);
    }
    const acceptedAt = new Date(finding.accepted_at);
    const expiry = new Date(finding.expires_at);
    if (Number.isNaN(acceptedAt.valueOf())) throw new Error(`accepted security finding ${finding.rule_id} has an invalid acceptance date`);
    if (Number.isNaN(expiry.valueOf())) throw new Error(`accepted security finding ${finding.rule_id} has an invalid expiry`);
    if (acceptedAt >= expiry) throw new Error(`accepted security finding ${finding.rule_id} must expire after acceptance`);
    if (expiry <= now) throw new Error(`accepted security finding ${finding.rule_id} expired at ${finding.expires_at}`);
    let accepted;
    try { accepted = new URL(finding.url); } catch { throw new Error(`accepted security finding ${finding.rule_id} has an invalid URL`); }
    const target = new URL(security.target);
    const targetPath = target.pathname.endsWith("/") ? target.pathname : `${target.pathname}/`;
    if (accepted.origin !== target.origin || (accepted.pathname !== target.pathname && !accepted.pathname.startsWith(targetPath))) {
      throw new Error(`accepted security finding ${finding.rule_id} is outside the allowed target`);
    }
  }
  return { matrix, findings };
}

/** Waits for an HTTP health endpoint with a fixed deadline. */
export async function waitForHealth(url, timeoutSeconds, fetchImpl = fetch) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let detail = "no response";
  while (Date.now() < deadline) {
    try {
      const response = await fetchImpl(url, { redirect: "manual", signal: AbortSignal.timeout(3000) });
      if (response.ok) return;
      detail = `HTTP ${response.status}`;
    } catch (error) { detail = error.message; }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`security environment health check timed out: ${detail}`);
}

const PROBE_CLIENTS = {
  curl: (target) => ["curl", "-fsS", "-o", "/dev/null", "--max-time", "15", target],
  wget: (target) => ["wget", "-q", "-O", "/dev/null", "-T", "15", target],
};

/** Reads which HTTP client the pinned scanner image ships, from `command -v` output. */
export function probeClientFromOutput(output) {
  const name = String(output).trim().split(/\r?\n/)[0]?.split("/").pop();
  return name === "curl" || name === "wget" ? name : null;
}

function detectProbeClient(image) {
  try {
    const output = execFileSync("docker", ["run", "--rm", image, "sh", "-c", "command -v curl || command -v wget"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    });
    return probeClientFromOutput(output);
  } catch { return null; }
}

/** Builds the one-shot container probe: a single GET, no mount, no forwarded secret. */
export function probeInvocation(value, client) {
  const security = validateSecurityTesting(value, "baseline", {}, { requireSecrets: false });
  const build = PROBE_CLIENTS[client];
  if (build == null) throw new Error(`unknown probe client: ${client}`);
  const args = ["run", "--rm"];
  if (security.environment.network) args.push("--network", security.environment.network);
  args.push(security.zap.image, ...build(security.target));
  return { command: "docker", args, options: { shell: false } };
}

/** Explains an unreachable target with the pattern that works where the bridge gateway does not. */
export function probeDiagnosis(value, detail) {
  const security = validateSecurityTesting(value, "baseline", {}, { requireSecrets: false });
  return [
    `security probe: the scanner container cannot reach ${security.target} (${detail})`,
    "The scan runs inside a container, so an address that answers from this host proves nothing about the scan itself.",
    "On Docker Desktop, rootless Docker, or WSL2 the default bridge gateway (for example 172.17.0.1) is dead or namespaced, and --network host selects a virtual machine namespace rather than this host.",
    "Working pattern: run the application in a container on the user-defined network named by security_testing.environment.network, give it a network alias, publish its port on 127.0.0.1 for the health check, and set security_testing.target to http://<alias>:<port>.",
  ].join("\n");
}

/** Validates the contract, then checks the target the way the scan will see it. */
export async function runSecurityProbe(value, dependencies = {}) {
  const cwd = resolve(dependencies.cwd ?? process.cwd());
  const env = dependencies.env ?? process.env;
  const security = validateSecurityTesting(value, "baseline", env, { requireSecrets: false });
  validateSecurityFiles(cwd, security, new Date(), dependencies.commands ?? null);
  const runStep = dependencies.runStep ?? defaultRunStep;
  const health = dependencies.waitForHealth ?? waitForHealth;
  const detectClient = dependencies.detectClient ?? (async (image) => detectProbeClient(image));
  const record = { kind: "probe", target: security.target, network: security.environment.network ?? null, reachability: "unverified" };
  let startedEnvironment = false;
  let primaryError = null;
  try {
    const start = await runStep("start security environment", security.environment.start, [], { cwd, shell: true, timeoutMs: 120000, env });
    if (failed(start)) throw new Error("security environment start failed");
    startedEnvironment = true;
    await health(security.environment.health_url, security.environment.health_timeout_seconds);
    const client = await detectClient(security.zap.image);
    if (client == null) {
      record.reachability = "not_verified";
      record.detail = `the pinned scanner image provides neither curl nor wget, or could not be inspected: container-to-target reachability was not verified. Only the environment lifecycle and the health check from this host were verified.`;
    } else {
      const invocation = probeInvocation(security, client);
      const probe = await runStep("probe target reachability", invocation.command, invocation.args, { cwd, shell: false, timeoutMs: 60000, env });
      if (failed(probe)) {
        const detail = probe.error ?? (probe.timed_out ? "timed out" : probe.interrupted ? "interrupted" : `exit code ${probe.code}`);
        throw new Error(probeDiagnosis(security, detail));
      }
      record.reachability = "verified";
      record.client = client;
    }
  } catch (error) {
    primaryError = error;
  } finally {
    if (startedEnvironment) {
      const stop = await runStep("stop security environment", security.environment.stop, [], { cwd, shell: true, timeoutMs: 120000, env });
      if (failed(stop) && primaryError == null) primaryError = new Error("security environment cleanup failed");
    }
  }
  if (primaryError) throw primaryError;
  return record;
}

function gitRevision(cwd) {
  try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return null; }
}

function failed(result) {
  return result.code !== 0 || result.timed_out || result.interrupted || result.error;
}

function safeApiDefinition(cwd, security, evidenceDir) {
  if (!security.api || /^https?:\/\//.test(security.api.definition)) return security.api?.definition;
  const source = resolve(cwd, security.api.definition);
  const root = resolve(cwd);
  if (source !== root && !source.startsWith(`${root}/`)) throw new Error("API definition leaves the project");
  if (!existsSync(source)) throw new Error(`API definition not found: ${security.api.definition}`);
  const extension = security.api.definition.match(/\.[A-Za-z0-9]+$/)?.[0] ?? ".txt";
  const destination = join(evidenceDir, `api-definition${extension}`);
  copyFileSync(source, destination);
  return `/zap/wrk/${destination.split(/[\\/]/).at(-1)}`;
}

/** Runs one bounded ZAP lifecycle and always tears down its test environment. */
export async function runSecurityScan(value, mode, dependencies = {}) {
  const cwd = resolve(dependencies.cwd ?? process.cwd());
  const env = dependencies.env ?? process.env;
  const security = validateSecurityTesting(value, mode, env);
  const { findings } = validateSecurityFiles(cwd, security);
  const runStep = dependencies.runStep ?? defaultRunStep;
  const health = dependencies.waitForHealth ?? waitForHealth;
  const gitSha = dependencies.gitSha ?? (() => gitRevision(cwd));
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
  const evidenceDir = resolve(cwd, security.zap.reports_dir, `${stamp}-${mode}-${randomUUID()}`);
  mkdirSync(evidenceDir, { recursive: true });
  // The scanner image runs as its own user and needs its own home, so it is
  // not run as the host user; the mount is opened to it instead. A CI runner
  // creates the directory as an account the container does not share, and
  // the scan then completes every job and fails on the report it cannot write.
  chmodSync(evidenceDir, 0o777);
  const apiDefinition = mode === "api" ? safeApiDefinition(cwd, security, evidenceDir) : undefined;
  const plan = buildZapPlan(security, mode, { apiDefinition, acceptedFindings: findings });
  writeFileSync(join(evidenceDir, "zap.yaml"), plan);
  const record = {
    kind: "zap", mode, target: security.target,
    authenticated: security.authentication?.method !== "none",
    commit_sha: gitSha(), started_at: new Date().toISOString(), status: "running",
    exit_code: null, duration_ms: 0, reports: [], evidence_dir: evidenceDir,
  };
  const started = performance.now();
  let primaryError = null;
  let startedEnvironment = false;
  try {
    const start = await runStep("start security environment", security.environment.start, [], { cwd, shell: true, timeoutMs: 120000, env });
    if (failed(start)) throw new Error("security environment start failed");
    startedEnvironment = true;
    await health(security.environment.health_url, security.environment.health_timeout_seconds);
    if (security.environment.prepare) {
      const prepare = await runStep("prepare security data", security.environment.prepare, [], { cwd, shell: true, timeoutMs: 120000, env });
      if (failed(prepare)) throw new Error("security data preparation failed");
    }
    const invocation = dockerInvocation(security, evidenceDir, "/zap/wrk/zap.yaml", env);
    const scan = await runStep(`ZAP ${mode} scan`, invocation.command, invocation.args, {
      cwd, shell: false, timeoutMs: (zapExecutionBudgetMinutes(security, mode) + 2) * 60000, env: invocation.options.env,
    });
    record.exit_code = scan.code;
    if (failed(scan)) throw new Error(`ZAP ${mode} scan failed`);
    record.status = "passed";
  } catch (error) {
    primaryError = error;
    record.status = "failed";
    record.error = error.message;
  } finally {
    if (startedEnvironment) {
      const stop = await runStep("stop security environment", security.environment.stop, [], { cwd, shell: true, timeoutMs: 120000, env });
      if (failed(stop) && primaryError == null) {
        primaryError = new Error("security environment cleanup failed");
        record.status = "failed";
        record.error = primaryError.message;
      }
    }
    record.duration_ms = Math.round(performance.now() - started);
    record.finished_at = new Date().toISOString();
    record.reports = ["report.html", "report.sarif.json", "report.json"].filter((name) => existsSync(join(evidenceDir, name)));
    const requiredEvidence = ["report.html", "report.sarif.json", "report.json", "urls.txt"];
    const missingEvidence = requiredEvidence.filter((name) => !existsSync(join(evidenceDir, name)));
    if (missingEvidence.length > 0 && primaryError == null) {
      primaryError = new Error(`ZAP ${mode} scan did not produce required evidence: ${missingEvidence.join(", ")}`);
      record.status = "failed";
      record.error = primaryError.message;
    }
    if (record.reports.includes("report.json")) {
      try { record.summary = summarizeZapReport(readJson(join(evidenceDir, "report.json"), "ZAP JSON report")); }
      catch (error) {
        record.status = "failed";
        record.error = error.message;
        primaryError ??= error;
      }
    }
    if (existsSync(join(evidenceDir, "urls.txt"))) {
      const urls = new Set(readFileSync(join(evidenceDir, "urls.txt"), "utf8").split(/\r?\n/).map((value) => value.trim()).filter(Boolean));
      record.summary = { ...(record.summary ?? { affected_url_count: 0, alert_count: 0, risks: {} }), discovered_url_count: urls.size };
    }
    atomicWrite(join(evidenceDir, "run.json"), `${JSON.stringify(record, null, 2)}\n`);
  }
  if (primaryError) throw primaryError;
  return record;
}

async function main() {
  const [mode] = process.argv.slice(2);
  const config = loadConfig();
  if (mode === "check") {
    validateSecurityTesting(config.security_testing, "baseline", process.env, { requireSecrets: false });
    validateSecurityFiles(process.cwd(), config.security_testing, new Date(), config.commands);
    console.log("security scope and assurance records are valid");
    return;
  }
  if (mode === "probe") {
    const result = await runSecurityProbe(config.security_testing, { commands: config.commands });
    if (result.reachability === "not_verified") console.log(`security probe: ${result.detail}`);
    else console.log(`security probe: ${result.target} is reachable from the scanner container`);
    return;
  }
  if (!MODES_FOR_CLI.has(mode)) throw new Error("usage: security-scan.mjs <check|probe|baseline|active|api>");
  const result = await runSecurityScan(config.security_testing, mode);
  console.log(`security evidence: ${join(result.evidence_dir, "run.json")}`);
}

const MODES_FOR_CLI = new Set(["baseline", "active", "api"]);
if (process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
