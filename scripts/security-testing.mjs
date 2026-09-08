import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

const MODES = new Set(["baseline", "active", "api"]);
const SPIDERS = new Map([
  ["traditional", "spider"],
  ["ajax", "spiderAjax"],
  ["client", "spiderClient"],
]);
const AUTH_METHODS = new Set(["none", "manual", "http", "form", "json", "script", "autodetect", "browser", "client", "header"]);
const LEVELS = new Set(["Informational", "Low", "Medium", "High"]);
const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/;
const NETWORK_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const DIGEST_IMAGE = /^[a-z0-9][a-z0-9./_-]*(?::[a-z0-9._-]+)?@sha256:[a-f0-9]{64}$/i;
const SUMMARY_RISKS = new Set(["Informational", "Low", "Medium", "High", "Unknown"]);

function object(value, name) {
  if (value == null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value;
}

function text(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${name} must be a non-empty string`);
  return value;
}

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function relativePath(value, name) {
  text(value, name);
  if (isAbsolute(value) || value.split(/[\\/]/).includes("..")) throw new Error(`${name} must stay inside the project`);
  return value;
}

function httpUrl(value, name) {
  text(value, name);
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error(`${name} must be an HTTP URL`); }
  if (!new Set(["http:", "https:"]).has(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error(`${name} must be an HTTP URL without credentials`);
  }
  return value;
}

function envNames(authentication) {
  const credentials = authentication?.credentials ?? {};
  const names = Object.entries(credentials)
    .filter(([key]) => key.endsWith("_env"))
    .map(([, value]) => value);
  if (authentication?.method === "header") names.push(authentication.value_env);
  return [...new Set(names.filter(Boolean))];
}

function validateAuthentication(value, env, requireSecrets) {
  const authentication = object(value ?? { method: "none" }, "security_testing.authentication");
  if (!AUTH_METHODS.has(authentication.method)) throw new Error(`security_testing.authentication.method is unsupported: ${authentication.method}`);
  if (authentication.method === "none") return authentication;
  if (authentication.parameters != null) {
    object(authentication.parameters, "security_testing.authentication.parameters");
    for (const [key, value] of Object.entries(authentication.parameters)) {
      if (!/^[A-Za-z][A-Za-z0-9]*$/.test(key)) throw new Error(`authentication parameter name is malformed: ${key}`);
      if (!["string", "number", "boolean"].includes(typeof value)) throw new Error(`authentication parameter ${key} must be scalar`);
    }
  }
  const verification = object(authentication.verification, "security_testing.authentication.verification");
  if (!new Set(["response", "request", "both", "poll"]).has(verification.method)) {
    throw new Error("security_testing.authentication.verification.method is unsupported");
  }
  if (!verification.logged_in_regex) throw new Error("security_testing.authentication.verification needs a logged-in indicator");
  if (verification.url != null) httpUrl(verification.url, "security_testing.authentication.verification.url");
  if (authentication.method === "header") text(authentication.value_env, "security_testing.authentication.value_env");
  else object(authentication.credentials, "security_testing.authentication.credentials");
  for (const key of Object.keys(authentication.credentials ?? {})) {
    if (!/^[a-z][a-z0-9_]*_env$/.test(key)) throw new Error(`authentication credential key must end in _env: ${key}`);
  }
  for (const name of envNames(authentication)) {
    if (!ENV_NAME.test(name)) throw new Error(`authentication secret reference is not an environment name: ${name}`);
    if (requireSecrets && !env[name]) throw new Error(`authentication requires environment variable ${name}`);
  }
  return authentication;
}

/** Validates the project-owned boundary before any scanner or environment command runs. */
export function validateSecurityTesting(value, mode = "baseline", env = process.env, { requireSecrets = true } = {}) {
  if (!MODES.has(mode)) throw new Error(`unknown security scan mode: ${mode}`);
  const security = object(value, "security_testing");
  if (security.version !== 1) throw new Error("security_testing.version must be 1");
  const assurance = object(security.assurance, "security_testing.assurance");
  if (assurance.standard !== "OWASP ASVS") throw new Error("security_testing.assurance.standard must be OWASP ASVS");
  if (![1, 2, 3].includes(assurance.level)) throw new Error("security_testing.assurance.level must be 1, 2, or 3");
  relativePath(assurance.top10_2025, "security_testing.assurance.top10_2025");

  httpUrl(security.target, "security_testing.target");
  if (!Array.isArray(security.allowed_targets) || !security.allowed_targets.includes(security.target)) {
    throw new Error("security_testing.target must exactly match allowed_targets");
  }
  for (const target of security.allowed_targets) httpUrl(target, "security_testing.allowed_targets entry");

  const environment = object(security.environment, "security_testing.environment");
  text(environment.start, "security_testing.environment.start");
  text(environment.stop, "security_testing.environment.stop");
  httpUrl(environment.health_url, "security_testing.environment.health_url");
  positiveInteger(environment.health_timeout_seconds, "security_testing.environment.health_timeout_seconds");
  if (environment.network != null && !NETWORK_NAME.test(environment.network)) throw new Error("security_testing.environment.network is malformed");
  if (environment.disposable !== true) {
    throw new Error(`${mode} requires a disposable environment`);
  }
  if (environment.external_side_effects !== "disabled") {
    throw new Error(`${mode} requires external side effects to be disabled`);
  }
  if ((mode === "active" || mode === "api") && security.allow_active !== true) {
    throw new Error(`${mode} requires security_testing.allow_active`);
  }

  const zap = object(security.zap, "security_testing.zap");
  if (!DIGEST_IMAGE.test(zap.image ?? "")) throw new Error("security_testing.zap.image must use an immutable sha256 digest");
  if (!SPIDERS.has(zap.spider)) throw new Error("security_testing.zap.spider must be traditional, ajax, or client");
  relativePath(zap.reports_dir, "security_testing.zap.reports_dir");
  positiveInteger(zap.max_scan_minutes, "security_testing.zap.max_scan_minutes");
  positiveInteger(zap.max_rule_minutes, "security_testing.zap.max_rule_minutes");
  positiveInteger(zap.threads_per_host, "security_testing.zap.threads_per_host");
  if (!LEVELS.has(zap.fail_level) || !LEVELS.has(zap.warn_level)) throw new Error("ZAP fail and warning levels must be valid risk levels");
  if (zap.exclude_paths != null) {
    if (!Array.isArray(zap.exclude_paths)) throw new Error("security_testing.zap.exclude_paths must be a list");
    for (const [index, path] of zap.exclude_paths.entries()) text(path, `security_testing.zap.exclude_paths[${index}]`);
  }
  relativePath(security.accepted_findings, "security_testing.accepted_findings");
  validateAuthentication(security.authentication, env, requireSecrets);

  if (mode === "api") {
    const api = object(security.api, "security_testing.api");
    if (!new Set(["openapi", "graphql", "soap"]).has(api.format)) throw new Error("security_testing.api.format must be openapi, graphql, or soap");
    text(api.definition, "security_testing.api.definition");
    if (/^https?:\/\//.test(api.definition)) {
      httpUrl(api.definition, "security_testing.api.definition");
      if (!Array.isArray(api.allowed_definition_urls) || !api.allowed_definition_urls.includes(api.definition)) {
        throw new Error("remote security_testing.api.definition must exactly match api.allowed_definition_urls");
      }
      for (const url of api.allowed_definition_urls) httpUrl(url, "security_testing.api.allowed_definition_urls entry");
    } else relativePath(api.definition, "security_testing.api.definition");
    if (api.target_url != null) {
      httpUrl(api.target_url, "security_testing.api.target_url");
      if (!security.allowed_targets.includes(api.target_url)) throw new Error("security_testing.api.target_url must exactly match allowed_targets");
    }
  }
  return security;
}

const quote = (value) => JSON.stringify(String(value));
const line = (depth, value) => `${"  ".repeat(depth)}${value}`;

function authenticationYaml(security) {
  const auth = security.authentication ?? { method: "none" };
  if (auth.method === "none") return { context: [], user: null };
  const method = auth.method === "header" ? "manual" : auth.method;
  const lines = [line(3, "authentication:"), line(4, `method: ${quote(method)}`)];
  if (auth.parameters && Object.keys(auth.parameters).length > 0) {
    lines.push(line(4, "parameters:"));
    for (const [key, value] of Object.entries(auth.parameters)) lines.push(line(5, `${key}: ${quote(value)}`));
  }
  lines.push(line(4, "verification:"), line(5, `method: ${quote(auth.verification.method)}`));
  if (auth.verification.logged_in_regex) lines.push(line(5, `loggedInRegex: ${quote(auth.verification.logged_in_regex)}`));
  if (auth.verification.logged_out_regex) lines.push(line(5, `loggedOutRegex: ${quote(auth.verification.logged_out_regex)}`));
  lines.push(line(3, "sessionManagement:"), line(4, "method: \"cookie\""));
  if (auth.method !== "header") {
    lines.push(line(3, "users:"), line(4, "- name: \"security-user\""), line(5, "credentials:"));
    for (const [key, envName] of Object.entries(auth.credentials)) {
      if (!key.endsWith("_env")) continue;
      lines.push(line(6, `${key.slice(0, -4)}: ${quote(`\${${envName}}`)}`));
    }
  }
  return { context: lines, user: auth.method === "header" ? null : "security-user" };
}

function apiJob(security, apiDefinition, user) {
  const api = security.api;
  const location = apiDefinition ?? api.definition;
  const remote = /^https?:\/\//.test(location);
  const common = [line(1, `- type: ${api.format}`), line(2, "parameters:")];
  if (api.format === "openapi") {
    common.push(line(3, `${remote ? "apiUrl" : "apiFile"}: ${quote(location)}`));
    common.push(line(3, `targetUrl: ${quote(api.target_url ?? security.target)}`));
  } else if (api.format === "graphql") {
    common.push(line(3, `endpoint: ${quote(api.target_url ?? security.target)}`));
    common.push(line(3, `${remote ? "schemaUrl" : "schemaFile"}: ${quote(location)}`));
  } else {
    common.push(line(3, `${remote ? "wsdlUrl" : "wsdlFile"}: ${quote(location)}`));
  }
  if (api.format !== "soap") common.push(line(3, "context: \"agent-pipeline\""));
  if (user && api.format !== "soap") common.push(line(3, `user: ${quote(user)}`));
  return common;
}

/** Builds the ZAP Automation Framework plan from validated project data. */
export function buildZapPlan(value, mode, { apiDefinition, acceptedFindings = [] } = {}) {
  const security = validateSecurityTesting(value, mode, {}, { requireSecrets: false });
  const auth = authenticationYaml(security);
  const lines = [
    "env:",
    line(1, "contexts:"),
    line(2, "- name: \"agent-pipeline\""),
    line(3, "urls:"),
    line(4, `- ${quote(security.target)}`),
  ];
  if (security.zap.exclude_paths?.length) {
    lines.push(line(3, "excludePaths:"));
    for (const path of security.zap.exclude_paths) lines.push(line(4, `- ${quote(path)}`));
  }
  lines.push(...auth.context, line(1, "parameters:"), line(2, "failOnError: true"), line(2, "failOnWarning: false"), line(2, "continueOnFailure: false"), "jobs:");
  if (acceptedFindings.length > 0) {
    lines.push(line(1, "- type: alertFilter"), line(2, "parameters:"), line(3, "deleteGlobalAlerts: false"), line(2, "alertFilters:"));
    for (const finding of acceptedFindings) {
      lines.push(
        line(3, `- ruleId: ${quote(finding.rule_id)}`),
        line(4, "newRisk: \"False Positive\""),
        line(4, "context: \"agent-pipeline\""),
        line(4, `url: ${quote(finding.url)}`),
      );
    }
  }
  if (auth.context.length > 0) {
    lines.push(line(1, "- type: requestor"), line(2, "parameters:"));
    if (auth.user) lines.push(line(3, `user: ${quote(auth.user)}`));
    const verificationUrl = security.authentication.verification.url ?? security.target;
    lines.push(
      line(2, "requests:"),
      line(3, `- url: ${quote(verificationUrl)}`),
      line(4, "name: \"authenticated-session-proof\""),
      line(4, "method: \"GET\""),
      line(2, "tests:"),
      line(3, "- name: \"authenticated response contains the logged-in indicator\""),
      line(4, "type: url"),
      line(4, `url: ${quote(verificationUrl)}`),
      line(4, `responseBodyRegex: ${quote(security.authentication.verification.logged_in_regex)}`),
      line(4, "onFail: \"error\""),
    );
  }
  if (mode === "api") lines.push(...apiJob(security, apiDefinition, auth.user));
  else {
    lines.push(line(1, `- type: ${SPIDERS.get(security.zap.spider)}`), line(2, "parameters:"), line(3, "context: \"agent-pipeline\""), line(3, `maxDuration: ${Math.min(5, security.zap.max_scan_minutes)}`));
    if (auth.user) lines.push(line(3, `user: ${quote(auth.user)}`));
  }
  lines.push(line(1, "- type: passiveScan-wait"), line(2, "parameters:"), line(3, `maxDuration: ${security.zap.max_scan_minutes}`));
  if (mode === "active" || mode === "api") {
    lines.push(
      line(1, "- type: activeScan"),
      line(2, "parameters:"),
      line(3, "context: \"agent-pipeline\""),
      line(3, `maxScanDurationInMins: ${security.zap.max_scan_minutes}`),
      line(3, `maxRuleDurationInMins: ${security.zap.max_rule_minutes}`),
      line(3, `threadPerHost: ${security.zap.threads_per_host}`),
    );
    if (auth.user) lines.push(line(3, `user: ${quote(auth.user)}`));
  }
  lines.push(
    line(1, "- type: export"),
    line(2, "parameters:"),
    line(3, "context: \"agent-pipeline\""),
    line(3, "type: \"url\""),
    line(3, "source: \"all\""),
    line(3, "fileName: \"/zap/wrk/urls.txt\""),
  );
  for (const [template, file] of [["risk-confidence-html", "report.html"], ["sarif-json", "report.sarif.json"], ["traditional-json", "report.json"]]) {
    lines.push(
      line(1, "- type: report"),
      line(2, "parameters:"),
      line(3, `template: ${quote(template)}`),
      line(3, "reportDir: \"/zap/wrk\""),
      line(3, `reportFile: ${quote(file)}`),
      line(3, "displayReport: false"),
    );
  }
  lines.push(
    line(1, "- type: exitStatus"),
    line(2, "parameters:"),
    line(3, `errorLevel: ${quote(security.zap.fail_level)}`),
    line(3, `warnLevel: ${quote(security.zap.warn_level)}`),
    "",
  );
  return lines.join("\n");
}

/** Returns the sequential upper bound declared by a validated ZAP plan. */
export function zapExecutionBudgetMinutes(value, mode) {
  const security = validateSecurityTesting(value, mode, {}, { requireSecrets: false });
  const exploration = mode === "api" ? 0 : Math.min(5, security.zap.max_scan_minutes);
  const passive = security.zap.max_scan_minutes;
  const active = mode === "active" || mode === "api" ? security.zap.max_scan_minutes : 0;
  return exploration + passive + active;
}

/** Returns a shell-free Docker invocation; secret values remain only in the child environment. */
export function dockerInvocation(value, evidenceDir, plan = "/zap/wrk/zap.yaml", env = process.env) {
  const security = validateSecurityTesting(value, "baseline", env, { requireSecrets: false });
  const args = ["run", "--rm"];
  if (security.environment.network) args.push("--network", security.environment.network);
  const childEnv = { ...env };
  for (const name of envNames(security.authentication)) args.push("--env", name);
  if (security.authentication?.method === "header") {
    childEnv.ZAP_AUTH_HEADER_VALUE = env[security.authentication.value_env];
    args.push("--env", "ZAP_AUTH_HEADER_VALUE");
    if (security.authentication.header_name) {
      childEnv.ZAP_AUTH_HEADER = security.authentication.header_name;
      args.push("--env", "ZAP_AUTH_HEADER");
    }
    childEnv.ZAP_AUTH_HEADER_SITE = new URL(security.target).hostname;
    args.push("--env", "ZAP_AUTH_HEADER_SITE");
  }
  args.push("--volume", `${resolve(evidenceDir)}:/zap/wrk:rw`, security.zap.image, "zap.sh", "-cmd", "-autorun", plan);
  return { command: "docker", args, options: { shell: false, env: childEnv } };
}

/** Reads whitelisted scan metadata for the dashboard. */
export function securityEvidenceHistory(root, value) {
  const security = validateSecurityTesting(value, "baseline", {}, { requireSecrets: false });
  const base = resolve(root, security.zap.reports_dir);
  if (!existsSync(base)) return [];
  const records = [];
  const visit = (directory) => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) visit(path);
      else if (name === "run.json") {
        try {
          const raw = JSON.parse(readFileSync(path, "utf8"));
          if (raw.kind !== "zap") continue;
          const record = Object.fromEntries([
            "kind", "mode", "status", "target", "authenticated", "commit_sha", "duration_ms",
            "started_at", "finished_at", "exit_code", "reports", "error",
          ].filter((key) => raw[key] !== undefined).map((key) => [key, raw[key]]));
          const summary = sanitizeControlSummary("zap", raw.summary);
          if (summary != null) record.summary = summary;
          records.push(record);
        } catch { /* An interrupted record does not hide complete scans. */ }
      }
    }
  };
  visit(base);
  return records.sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)));
}

/** Restricts third-party report summaries to fields the dashboard understands. */
export function sanitizeControlSummary(kind, summary) {
  if (summary == null || typeof summary !== "object" || Array.isArray(summary)) return undefined;
  if (kind === "zap") {
    const sanitized = {};
    for (const key of ["discovered_url_count", "affected_url_count", "alert_count"]) {
      if (Number.isFinite(summary[key]) && summary[key] >= 0) sanitized[key] = summary[key];
    }
    if (summary.risks != null && typeof summary.risks === "object" && !Array.isArray(summary.risks)) {
      sanitized.risks = Object.fromEntries(Object.entries(summary.risks)
        .filter(([key, value]) => SUMMARY_RISKS.has(key) && Number.isFinite(value) && value >= 0));
    }
    return Object.keys(sanitized).length > 0 ? sanitized : undefined;
  }
  if (kind === "load") {
    const metricNames = ["requests", "error_rate", "p95_ms", "p99_ms", "throughput_per_second"];
    const metrics = Object.fromEntries(metricNames
      .filter((key) => Number.isFinite(summary.metrics?.[key]) && summary.metrics[key] >= 0)
      .map((key) => [key, summary.metrics[key]]));
    const thresholds = Object.fromEntries(metricNames
      .filter((key) => ["string", "number"].includes(typeof summary.thresholds?.[key]))
      .map((key) => [key, String(summary.thresholds[key])]));
    return Object.keys(metrics).length === metricNames.length ? { metrics, thresholds } : undefined;
  }
  return undefined;
}

/** Reduces a ZAP JSON report to counts safe for durable dashboard metadata. */
export function summarizeZapReport(report) {
  const sites = Array.isArray(report?.site) ? report.site : report?.site ? [report.site] : [];
  const urls = new Set();
  const risks = {};
  let alertCount = 0;
  for (const site of sites) {
    const alerts = Array.isArray(site?.alerts) ? site.alerts : [];
    for (const alert of alerts) {
      alertCount += 1;
      const risk = String(alert.riskdesc ?? alert.risk ?? "Unknown").split(/[ (]/)[0] || "Unknown";
      risks[risk] = (risks[risk] ?? 0) + 1;
      for (const instance of alert.instances ?? []) if (typeof instance.uri === "string") urls.add(instance.uri);
    }
  }
  return { affected_url_count: urls.size, alert_count: alertCount, risks };
}
