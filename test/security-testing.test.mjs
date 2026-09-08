import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildZapPlan,
  dockerInvocation,
  securityEvidenceHistory,
  summarizeZapReport,
  validateSecurityTesting,
} from "../scripts/security-testing.mjs";
import { runSecurityScan, validateSecurityFiles } from "../scripts/security-scan.mjs";
import { runLoadTest, validateLoadTesting } from "../scripts/load-testing.mjs";
import { createSandbox, destroySandbox, run, seedFramework } from "./harness.mjs";

const DIGEST = `ghcr.io/zaproxy/zaproxy@sha256:${"a".repeat(64)}`;

function configured(overrides = {}) {
  return {
    version: 1,
    assurance: {
      standard: "OWASP ASVS",
      level: 2,
      top10_2025: "pipeline/security/owasp-top10-2025.json",
    },
    target: "http://app:3000",
    allowed_targets: ["http://app:3000"],
    environment: {
      start: "docker compose -f compose.security.yml up -d",
      stop: "docker compose -f compose.security.yml down -v",
      prepare: "node tools/seed-security.mjs",
      health_url: "http://127.0.0.1:3000/health",
      health_timeout_seconds: 30,
      disposable: true,
      external_side_effects: "disabled",
      network: "project-security",
    },
    authentication: {
      method: "form",
      parameters: {
        loginPageUrl: "http://app:3000/login",
        loginRequestUrl: "http://app:3000/login",
        loginRequestBody: "email={%username%}&password={%password%}",
      },
      credentials: {
        username_env: "ZAP_TEST_USERNAME",
        password_env: "ZAP_TEST_PASSWORD",
      },
      verification: {
        method: "response",
        logged_in_regex: "\\QSign out\\E",
        logged_out_regex: "\\QSign in\\E",
      },
    },
    zap: {
      image: DIGEST,
      spider: "client",
      reports_dir: "pipeline/evidence/security",
      max_scan_minutes: 20,
      max_rule_minutes: 3,
      threads_per_host: 4,
      fail_level: "High",
      warn_level: "Medium",
      exclude_paths: ["http://app:3000/real-payment.*"],
    },
    api: {
      format: "openapi",
      definition: "docs/openapi.json",
      target_url: "http://app:3000",
    },
    accepted_findings: "pipeline/security/accepted-findings.json",
    allow_active: true,
    ...overrides,
  };
}

describe("security testing contract", () => {
  test("accepts a bounded authenticated disposable target", () => {
    const value = validateSecurityTesting(configured(), "active", {
      ZAP_TEST_USERNAME: "security-user@example.test",
      ZAP_TEST_PASSWORD: "test-only-secret",
    });
    assert.equal(value.target, "http://app:3000");
  });

  test("refuses floating images, undeclared targets and scans on persistent data", () => {
    assert.throws(
      () => validateSecurityTesting(configured({ zap: { ...configured().zap, image: "zaproxy/zap-stable" } }), "baseline", {}),
      /immutable sha256 digest/,
    );
    assert.throws(
      () => validateSecurityTesting(configured({ allowed_targets: ["http://other:3000"] }), "baseline", {}),
      /target must exactly match allowed_targets/,
    );
    assert.throws(
      () => validateSecurityTesting(configured({ zap: { ...configured().zap, spider: "automatic" } }), "baseline", {}),
      /spider must be traditional, ajax, or client/,
    );
    assert.throws(
      () => validateSecurityTesting(configured({ environment: { ...configured().environment, disposable: false } }), "active", {
        ZAP_TEST_USERNAME: "user",
        ZAP_TEST_PASSWORD: "secret",
      }),
      /disposable environment/,
    );
    assert.throws(
      () => validateSecurityTesting(configured({ environment: { ...configured().environment, disposable: false } }), "baseline", {
        ZAP_TEST_USERNAME: "user",
        ZAP_TEST_PASSWORD: "secret",
      }),
      /disposable environment/,
    );
    assert.throws(
      () => validateSecurityTesting(configured({ environment: { ...configured().environment, external_side_effects: "live" } }), "active", {
        ZAP_TEST_USERNAME: "user",
        ZAP_TEST_PASSWORD: "secret",
      }),
      /external side effects/,
    );
  });

  test("requires an explicit allowlist for remote API definitions", () => {
    const api = { ...configured().api, definition: "https://schemas.example.test/openapi.json" };
    assert.throws(
      () => validateSecurityTesting(configured({ api }), "api", {
        ZAP_TEST_USERNAME: "user",
        ZAP_TEST_PASSWORD: "secret",
      }),
      /allowed_definition_urls/,
    );
    assert.doesNotThrow(() => validateSecurityTesting(configured({ api: {
      ...api,
      allowed_definition_urls: ["https://schemas.example.test/openapi.json"],
    } }), "api", { ZAP_TEST_USERNAME: "user", ZAP_TEST_PASSWORD: "secret" }));
  });

  test("refuses missing authentication secrets and unverifiable sessions", () => {
    assert.throws(() => validateSecurityTesting(configured(), "baseline", {}), /ZAP_TEST_USERNAME/);
    const authentication = { ...configured().authentication };
    delete authentication.verification;
    assert.throws(
      () => validateSecurityTesting(configured({ authentication }), "baseline", {
        ZAP_TEST_USERNAME: "user",
        ZAP_TEST_PASSWORD: "secret",
      }),
      /authentication.verification/,
    );
    assert.throws(
      () => validateSecurityTesting(configured({ authentication: {
        ...configured().authentication,
        parameters: { "loginPageUrl\n  injected": "http://app:3000/login" },
      } }), "baseline", { ZAP_TEST_USERNAME: "user", ZAP_TEST_PASSWORD: "secret" }),
      /parameter name/,
    );
  });

  test("builds passive, active and API plans with explicit budgets and reports", () => {
    const baseline = buildZapPlan(configured(), "baseline");
    assert.match(baseline, /type: spiderClient/);
    assert.doesNotMatch(baseline, /type: activeScan/);
    assert.match(baseline, /type: requestor/);
    assert.match(baseline, /responseBodyRegex: "\\\\QSign out\\\\E"/);
    assert.match(baseline, /onFail: "error"/);
    assert.match(baseline, /type: passiveScan-wait/);
    assert.match(baseline, /template: "sarif-json"/);
    assert.match(baseline, /type: exitStatus/);

    const active = buildZapPlan(configured(), "active");
    assert.match(active, /type: activeScan/);
    assert.match(active, /maxScanDurationInMins: 20/);
    assert.match(active, /maxRuleDurationInMins: 3/);
    assert.match(active, /threadPerHost: 4/);

    const api = buildZapPlan(configured(), "api", { apiDefinition: "/zap/wrk/openapi.json" });
    assert.match(api, /type: openapi/);
    assert.match(api, /apiFile: "\/zap\/wrk\/openapi.json"/);
    assert.match(api, /targetUrl: "http:\/\/app:3000"/);
    assert.match(api, /user: "security-user"/);
  });

  test("turns reviewed unexpired findings into narrow alert filters before scanning", () => {
    const plan = buildZapPlan(configured(), "baseline", { acceptedFindings: [{
      rule_id: "10020",
      url: "http://app:3000/legacy",
      reason: "Reviewed upstream framing control.",
      accepted_at: "2026-09-01T00:00:00.000Z",
      expires_at: "2026-10-01T00:00:00.000Z",
    }] });
    assert.ok(plan.indexOf("type: alertFilter") < plan.indexOf("type: spiderClient"));
    assert.match(plan, /ruleId: "10020"/);
    assert.match(plan, /newRisk: "False Positive"/);
    assert.match(plan, /url: "http:\/\/app:3000\/legacy"/);
  });

  test("passes secrets by environment name rather than command arguments", () => {
    const invocation = dockerInvocation(configured(), "/tmp/evidence", "/zap/wrk/zap.yaml");
    assert.equal(invocation.command, "docker");
    assert.ok(invocation.args.includes("--network"));
    assert.ok(invocation.args.includes("project-security"));
    assert.ok(invocation.args.includes("ZAP_TEST_USERNAME"));
    assert.ok(invocation.args.includes(DIGEST));
    assert.doesNotMatch(invocation.args.join(" "), /test-only-secret/);
    assert.equal(invocation.options.env.ZAP_TEST_USERNAME, undefined);
  });

  test("reads durable scan records without exposing secret-shaped fields", () => {
    const root = mkdtempSync(join(tmpdir(), "security-evidence-"));
    try {
      const directory = join(root, "pipeline/evidence/security/run-1");
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, "run.json"), JSON.stringify({
        kind: "zap",
        mode: "baseline",
        status: "passed",
        target: "http://app:3000",
        commit_sha: "abc123",
        duration_ms: 1200,
        started_at: "2026-09-08T10:00:00.000Z",
        finished_at: "2026-09-08T10:00:01.200Z",
        reports: ["report.html", "report.sarif.json"],
        summary: {
          discovered_url_count: 4,
          affected_url_count: 2,
          alert_count: 1,
          risks: { High: 1, SECRET_TOKEN: 1 },
          password: "nested-secret",
        },
        password: "must-not-leak",
      }));
      const history = securityEvidenceHistory(root, configured());
      assert.equal(history.length, 1);
      assert.equal(history[0].mode, "baseline");
      assert.equal(history[0].password, undefined);
      assert.deepEqual(history[0].reports, ["report.html", "report.sarif.json"]);
      assert.equal(history[0].summary.discovered_url_count, 4);
      assert.equal(history[0].summary.password, undefined);
      assert.equal(history[0].summary.risks.SECRET_TOKEN, undefined);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("summarizes affected URLs and alert risks from the machine report", () => {
    const summary = summarizeZapReport({ site: [{ alerts: [{
      riskdesc: "High (Medium)",
      instances: [{ uri: "http://app:3000/a" }, { uri: "http://app:3000/b" }],
    }, {
      riskdesc: "Low (High)",
      instances: [{ uri: "http://app:3000/a" }],
    }] }] });
    assert.deepEqual(summary, { affected_url_count: 2, alert_count: 2, risks: { High: 1, Low: 1 } });
  });
});

describe("security assurance templates", () => {
  test("ships one explicit entry for every OWASP Top 10 2025 category", () => {
    const matrix = JSON.parse(readFileSync(new URL("../templates/owasp-top10-2025.template.json", import.meta.url)));
    assert.deepEqual(Object.keys(matrix.categories), [
      "A01", "A02", "A03", "A04", "A05", "A06", "A07", "A08", "A09", "A10",
    ]);
    for (const entry of Object.values(matrix.categories)) {
      assert.equal(entry.status, "unverified");
      assert.ok(Array.isArray(entry.controls));
      assert.ok(Array.isArray(entry.limitations));
    }
  });
});

describe("security setup", () => {
  test("installs reviewed security and load contracts without storing credentials", () => {
    const root = createSandbox();
    try {
      const configPath = join(root, "pipeline.config.json");
      const original = JSON.parse(readFileSync(configPath));
      original.ci = {
        provider: "github",
        install: "project install",
        runtime_setup: { uses: "owner/runtime@v1", with: {} },
        timeout_minutes: 30,
        secret_environment: ["EXISTING_SECRET"],
        artifacts: { name: "existing-evidence", paths: ["pipeline/evidence/existing/**/run.json"] },
      };
      original.architecture = { id: "feature-modules", project_type: "backend" };
      original.commands = {
        check: "true", lint: "true", build: "true", test_unit: "true", audit: "true",
        secrets_scan: "true", project_map: "true", design_limits: "true", duplication: "true", smoke: "true",
      };
      writeFileSync(configPath, JSON.stringify(original));
      const input = join(root, "security-input.json");
      writeFileSync(input, JSON.stringify({
        security_testing: configured(),
        load_testing: {
          version: 1,
          command: "node tools/load.mjs",
          target_env: "LOAD_TEST_TARGET",
          allowed_targets: ["http://app:3000"],
          timeout_seconds: 300,
          reports_dir: "pipeline/evidence/load",
          summary_file: "summary.json",
          result_files: ["summary.json"],
          use_security_environment: true,
        },
        ci_artifact_upload: { uses: `owner/upload@${"b".repeat(40)}` },
      }));
      const result = run(root, "configure-security.mjs", [input]);
      assert.equal(result.status, 0, result.output);
      const pipeline = JSON.parse(readFileSync(join(root, "pipeline.config.json")));
      assert.match(pipeline.commands.security_scope, /security-scan\.mjs check/);
      assert.match(pipeline.commands.dast_baseline, /security-scan\.mjs baseline/);
      assert.match(pipeline.commands.dast_active, /security-scan\.mjs active/);
      assert.match(pipeline.commands.dast_api, /security-scan\.mjs api/);
      assert.match(pipeline.commands.load, /load-testing\.mjs/);
      assert.ok(pipeline.closure_gates.includes("dast_baseline"));
      assert.ok(pipeline.closure_gates.includes("dast_active"));
      assert.ok(pipeline.closure_gates.includes("dast_api"));
      assert.ok(pipeline.closure_gates.includes("load"));
      assert.deepEqual(pipeline.ci.gate_events.dast_baseline, ["pull_request"]);
      assert.deepEqual(pipeline.ci.gate_events.dast_active, ["schedule", "workflow_dispatch"]);
      assert.deepEqual(pipeline.ci.gate_events.load, ["schedule", "workflow_dispatch"]);
      assert.deepEqual(pipeline.ci.secret_environment, ["EXISTING_SECRET", "ZAP_TEST_PASSWORD", "ZAP_TEST_USERNAME"]);
      assert.equal(pipeline.ci.environment.LOAD_TEST_TARGET, "http://app:3000");
      assert.deepEqual(pipeline.ci.artifacts, {
        name: "existing-evidence",
        paths: ["pipeline/evidence/existing/**/run.json", "pipeline/evidence/security/**/run.json", "pipeline/evidence/load/**/run.json"],
      });
      assert.equal(pipeline.ci.timeout_minutes, 100);
      assert.ok(existsSync(join(root, "pipeline/security/owasp-top10-2025.json")));
      assert.deepEqual(JSON.parse(readFileSync(join(root, "pipeline/security/accepted-findings.json"))), []);
      assert.doesNotMatch(readFileSync(join(root, "pipeline.config.json"), "utf8"), /test-only-secret/);
      seedFramework(root);
      const applied = run(root, "apply-profile.mjs", []);
      assert.equal(applied.status, 0, applied.output);
      const workflow = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");
      assert.match(workflow, /timeout-minutes: 100/);
      assert.match(workflow, /ZAP_TEST_PASSWORD: \$\{\{ secrets\.ZAP_TEST_PASSWORD \}\}/);
      assert.match(workflow, /name: dast-baseline\n        if: \$\{\{ github\.event_name == 'pull_request' \}\}/);
      assert.match(workflow, /name: dast-active\n        if: \$\{\{ github\.event_name == 'schedule' \|\| github\.event_name == 'workflow_dispatch' \}\}/);
      assert.match(workflow, new RegExp(`uses: owner/upload@${"b".repeat(40)}`));
      assert.match(workflow, /pipeline\/evidence\/security\/\*\*\/run\.json/);
      assert.doesNotMatch(workflow, /report\.html|report\.sarif\.json/);
    } finally {
      destroySandbox(root);
    }
  });

  test("leaves no partial assurance file when a configured target already exists", () => {
    const root = createSandbox();
    try {
      mkdirSync(join(root, "pipeline/security"), { recursive: true });
      writeFileSync(join(root, "pipeline/security/accepted-findings.json"), "[]\n");
      const input = join(root, "security-input.json");
      writeFileSync(input, JSON.stringify({ security_testing: configured() }));
      const before = readFileSync(join(root, "pipeline.config.json"), "utf8");
      const result = run(root, "configure-security.mjs", [input]);
      assert.notEqual(result.status, 0);
      assert.equal(existsSync(join(root, "pipeline/security/owasp-top10-2025.json")), false);
      assert.equal(readFileSync(join(root, "pipeline.config.json"), "utf8"), before);
    } finally {
      destroySandbox(root);
    }
  });

  test("requires a pinned evidence uploader before changing GitHub CI", () => {
    const root = createSandbox();
    try {
      const configPath = join(root, "pipeline.config.json");
      const config = JSON.parse(readFileSync(configPath));
      config.ci = {
        provider: "github",
        install: "project install",
        runtime_setup: { uses: "owner/runtime@v1", with: {} },
      };
      writeFileSync(configPath, JSON.stringify(config));
      const before = readFileSync(configPath, "utf8");
      const input = join(root, "security-input.json");
      writeFileSync(input, JSON.stringify({ security_testing: configured() }));
      const result = run(root, "configure-security.mjs", [input]);
      assert.notEqual(result.status, 0);
      assert.match(result.output, /ci_artifact_upload\.uses/);
      assert.equal(readFileSync(configPath, "utf8"), before);
      assert.equal(existsSync(join(root, "pipeline/security/owasp-top10-2025.json")), false);
    } finally {
      destroySandbox(root);
    }
  });

  test("validates all ten assurance entries and refuses expired accepted findings", () => {
    const root = mkdtempSync(join(tmpdir(), "security-files-"));
    try {
      mkdirSync(join(root, "pipeline/security"), { recursive: true });
      mkdirSync(join(root, "docs"), { recursive: true });
      const matrix = JSON.parse(readFileSync(new URL("../templates/owasp-top10-2025.template.json", import.meta.url)));
      writeFileSync(join(root, configured().assurance.top10_2025), JSON.stringify(matrix));
      writeFileSync(join(root, configured().accepted_findings), JSON.stringify([{
        rule_id: "10020",
        url: "http://app:3000/",
        reason: "Compensating framing policy is verified upstream.",
        accepted_at: "2026-01-01T00:00:00.000Z",
        expires_at: "2026-02-01T00:00:00.000Z",
      }]));
      assert.throws(() => validateSecurityFiles(root, configured(), new Date("2026-09-08T00:00:00.000Z")), /expired/);
      const invalidAcceptance = JSON.parse(readFileSync(join(root, configured().accepted_findings)));
      invalidAcceptance[0].accepted_at = "someday";
      invalidAcceptance[0].expires_at = "2027-01-01T00:00:00.000Z";
      writeFileSync(join(root, configured().accepted_findings), JSON.stringify(invalidAcceptance));
      assert.throws(() => validateSecurityFiles(root, configured(), new Date("2026-09-08T00:00:00.000Z")), /invalid acceptance date/);
      const unrelated = JSON.parse(readFileSync(join(root, configured().accepted_findings)));
      unrelated[0].accepted_at = "2026-01-01T00:00:00.000Z";
      unrelated[0].expires_at = "2027-01-01T00:00:00.000Z";
      unrelated[0].url = "https://unrelated.example/";
      writeFileSync(join(root, configured().accepted_findings), JSON.stringify(unrelated));
      assert.throws(() => validateSecurityFiles(root, configured(), new Date("2026-09-08T00:00:00.000Z")), /outside the allowed target/);
      matrix.categories.A01.name = "Access seems fine";
      writeFileSync(join(root, configured().assurance.top10_2025), JSON.stringify(matrix));
      writeFileSync(join(root, configured().accepted_findings), "[]\n");
      assert.throws(() => validateSecurityFiles(root, configured()), /A01 must be named Broken Access Control/);
      matrix.categories.A01.name = "Broken Access Control";
      delete matrix.categories.A10;
      writeFileSync(join(root, configured().assurance.top10_2025), JSON.stringify(matrix));
      writeFileSync(join(root, configured().accepted_findings), "[]\n");
      assert.throws(() => validateSecurityFiles(root, configured()), /A01 through A10/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("binds verified OWASP claims to declared executable gates", () => {
    const root = mkdtempSync(join(tmpdir(), "security-files-"));
    try {
      mkdirSync(join(root, "pipeline/security"), { recursive: true });
      const matrix = JSON.parse(readFileSync(new URL("../templates/owasp-top10-2025.template.json", import.meta.url)));
      matrix.categories.A01.status = "verified";
      matrix.categories.A01.controls = [{ gate: "authorization", description: "Role matrix integration suite" }];
      writeFileSync(join(root, configured().assurance.top10_2025), JSON.stringify(matrix));
      writeFileSync(join(root, configured().accepted_findings), "[]\n");
      assert.throws(() => validateSecurityFiles(root, configured(), new Date(), { check: "true" }), /undeclared gate authorization/);
      assert.doesNotThrow(() => validateSecurityFiles(root, configured(), new Date(), { authorization: "run auth matrix" }));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("security execution", () => {
  test("runs setup, health, scan and cleanup while retaining bounded evidence", async () => {
    const root = mkdtempSync(join(tmpdir(), "security-run-"));
    const calls = [];
    let scanTimeoutMs = null;
    try {
      mkdirSync(join(root, "pipeline/security"), { recursive: true });
      mkdirSync(join(root, "docs"), { recursive: true });
      const matrix = readFileSync(new URL("../templates/owasp-top10-2025.template.json", import.meta.url));
      writeFileSync(join(root, configured().assurance.top10_2025), matrix);
      writeFileSync(join(root, configured().accepted_findings), "[]\n");
      writeFileSync(join(root, "docs/openapi.json"), "{}\n", { flag: "w" });
      const result = await runSecurityScan(configured(), "baseline", {
        cwd: root,
        env: { ZAP_TEST_USERNAME: "user", ZAP_TEST_PASSWORD: "secret" },
        gitSha: () => "deadbeef",
        waitForHealth: async () => calls.push("health"),
        runStep: async (name, command, args, options) => {
          calls.push(name);
          if (name === "ZAP baseline scan") {
            scanTimeoutMs = options.timeoutMs;
            const mount = args[args.indexOf("--volume") + 1].split(":/zap/wrk")[0];
            writeFileSync(join(mount, "report.html"), "<html></html>\n");
            writeFileSync(join(mount, "report.sarif.json"), "{}\n");
            writeFileSync(join(mount, "report.json"), JSON.stringify({ site: [] }));
            writeFileSync(join(mount, "urls.txt"), "http://app:3000/\n");
          }
          return { name, code: 0, duration_ms: 5, timed_out: false, interrupted: false };
        },
      });
      assert.deepEqual(calls, ["start security environment", "health", "prepare security data", "ZAP baseline scan", "stop security environment"]);
      assert.equal(result.status, "passed");
      assert.equal(result.commit_sha, "deadbeef");
      assert.equal(result.authenticated, true);
      assert.equal(scanTimeoutMs, 27 * 60_000);
      assert.equal(result.summary.discovered_url_count, 1);
      assert.ok(existsSync(join(result.evidence_dir, "zap.yaml")));
      assert.ok(existsSync(join(result.evidence_dir, "run.json")));
      assert.doesNotMatch(readFileSync(join(result.evidence_dir, "run.json"), "utf8"), /secret/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("refuses a successful ZAP process that produced no evidence", async () => {
    const root = mkdtempSync(join(tmpdir(), "security-run-"));
    try {
      mkdirSync(join(root, "pipeline/security"), { recursive: true });
      writeFileSync(join(root, configured().assurance.top10_2025), readFileSync(new URL("../templates/owasp-top10-2025.template.json", import.meta.url)));
      writeFileSync(join(root, configured().accepted_findings), "[]\n");
      await assert.rejects(runSecurityScan(configured(), "baseline", {
        cwd: root,
        env: { ZAP_TEST_USERNAME: "user", ZAP_TEST_PASSWORD: "secret" },
        waitForHealth: async () => {},
        runStep: async (name) => ({ name, code: 0, duration_ms: 1, timed_out: false, interrupted: false }),
      }), /did not produce required evidence/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("still stops the environment when the scanner fails", async () => {
    const root = mkdtempSync(join(tmpdir(), "security-run-"));
    const calls = [];
    try {
      mkdirSync(join(root, "pipeline/security"), { recursive: true });
      writeFileSync(join(root, configured().assurance.top10_2025), readFileSync(new URL("../templates/owasp-top10-2025.template.json", import.meta.url)));
      writeFileSync(join(root, configured().accepted_findings), "[]\n");
      await assert.rejects(
        runSecurityScan(configured(), "active", {
          cwd: root,
          env: { ZAP_TEST_USERNAME: "user", ZAP_TEST_PASSWORD: "secret" },
          waitForHealth: async () => {},
          runStep: async (name) => {
            calls.push(name);
            return { name, code: name.startsWith("ZAP") ? 1 : 0, duration_ms: 5, timed_out: false, interrupted: false };
          },
        }),
        /ZAP active scan failed/,
      );
      assert.equal(calls.at(-1), "stop security environment");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("load testing contract", () => {
  const load = {
    version: 1,
    command: "node tools/load.mjs",
    target_env: "LOAD_TEST_TARGET",
    allowed_targets: ["http://app:3000"],
    timeout_seconds: 300,
    reports_dir: "pipeline/evidence/load",
    summary_file: "summary.json",
    result_files: ["summary.json"],
    use_security_environment: true,
  };

  test("requires an allowlisted target and a disposable environment", () => {
    assert.equal(validateLoadTesting(load, configured(), { LOAD_TEST_TARGET: "http://app:3000" }).command, "node tools/load.mjs");
    assert.throws(() => validateLoadTesting(load, configured(), { LOAD_TEST_TARGET: "https://production.example" }), /allowed_targets/);
    assert.throws(() => validateLoadTesting(load, configured({ environment: { ...configured().environment, disposable: false } }), { LOAD_TEST_TARGET: "http://app:3000" }), /disposable/);
  });

  test("retains the command duration and declared result files", async () => {
    const root = mkdtempSync(join(tmpdir(), "load-run-"));
    try {
      const calls = [];
      const result = await runLoadTest(load, configured(), {
        cwd: root,
        env: { LOAD_TEST_TARGET: "http://app:3000" },
        gitSha: () => "cafebabe",
        waitForHealth: async () => calls.push("health"),
        runStep: async (name, command, args, options) => {
          calls.push(name);
          if (name === "load test") {
            const report = join(options.env.PIPELINE_LOAD_EVIDENCE_DIR, "summary.json");
            writeFileSync(report, JSON.stringify({
              metrics: { requests: 1200, error_rate: 0.002, p95_ms: 240, p99_ms: 410, throughput_per_second: 80 },
              thresholds: { error_rate: "<0.01", p95_ms: "<500" },
            }));
          }
          return { name, code: 0, duration_ms: 7, timed_out: false, interrupted: false };
        },
      });
      assert.deepEqual(calls, ["start security environment", "health", "prepare security data", "load test", "stop security environment"]);
      assert.equal(result.status, "passed");
      assert.deepEqual(result.result_files, ["summary.json"]);
      assert.equal(result.summary.metrics.p95_ms, 240);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("fails when the load tool omits a declared result", async () => {
    const root = mkdtempSync(join(tmpdir(), "load-run-"));
    try {
      await assert.rejects(runLoadTest(load, configured(), {
        cwd: root,
        env: { LOAD_TEST_TARGET: "http://app:3000" },
        waitForHealth: async () => {},
        runStep: async (name) => ({ name, code: 0, duration_ms: 1, timed_out: false, interrupted: false }),
      }), /missing declared result files: summary.json/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("refuses load thresholds unrelated to normalized metrics", async () => {
    const root = mkdtempSync(join(tmpdir(), "load-run-"));
    try {
      await assert.rejects(runLoadTest(load, configured(), {
        cwd: root,
        env: { LOAD_TEST_TARGET: "http://app:3000" },
        waitForHealth: async () => {},
        runStep: async (name, command, args, options) => {
          if (name === "load test") {
            writeFileSync(join(options.env.PIPELINE_LOAD_EVIDENCE_DIR, "summary.json"), JSON.stringify({
              metrics: { requests: 1, error_rate: 0, p95_ms: 1, p99_ms: 1, throughput_per_second: 1 },
              thresholds: { password: "do-not-expose" },
            }));
          }
          return { name, code: 0, duration_ms: 1, timed_out: false, interrupted: false };
        },
      }), /threshold password does not name a normalized metric/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
