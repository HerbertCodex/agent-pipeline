import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  probeClientFromOutput,
  probeDiagnosis,
  probeInvocation,
  runSecurityProbe,
} from "../scripts/security-scan.mjs";

const DIGEST = `ghcr.io/zaproxy/zaproxy@sha256:${"d".repeat(64)}`;

function contract(overrides = {}) {
  return {
    version: 1,
    assurance: { standard: "OWASP ASVS", level: 1, top10_2025: "pipeline/security/owasp-top10-2025.json" },
    target: "http://app:3000",
    allowed_targets: ["http://app:3000"],
    environment: {
      start: "docker compose -f compose.security.yml up -d",
      stop: "docker compose -f compose.security.yml down -v",
      health_url: "http://127.0.0.1:3000/health",
      health_timeout_seconds: 30,
      disposable: true,
      external_side_effects: "disabled",
      network: "project-security",
    },
    zap: {
      image: DIGEST, spider: "traditional", reports_dir: "pipeline/evidence/security",
      max_scan_minutes: 10, max_rule_minutes: 2, threads_per_host: 2,
      fail_level: "High", warn_level: "Medium",
    },
    accepted_findings: "pipeline/security/accepted-findings.json",
    ...overrides,
  };
}

function withSecurityFiles(root) {
  mkdirSync(join(root, "pipeline/security"), { recursive: true });
  const matrix = readFileSync(new URL("../templates/owasp-top10-2025.template.json", import.meta.url));
  writeFileSync(join(root, contract().assurance.top10_2025), matrix);
  writeFileSync(join(root, contract().accepted_findings), "[]\n");
}

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), "security-probe-"));
  withSecurityFiles(root);
  return root;
}

describe("security probe client detection", () => {
  test("parses the HTTP client the pinned scanner image ships", () => {
    assert.equal(probeClientFromOutput("/usr/bin/curl\n"), "curl");
    assert.equal(probeClientFromOutput("/usr/bin/wget\n"), "wget");
    assert.equal(probeClientFromOutput(""), null);
    assert.equal(probeClientFromOutput("/bin/sh\n"), null);
  });
});

describe("security probe invocation", () => {
  test("runs one bounded GET from the scanner container on the declared network", () => {
    const invocation = probeInvocation(contract(), "curl");
    assert.equal(invocation.command, "docker");
    const args = invocation.args;
    assert.deepEqual(args.slice(0, 2), ["run", "--rm"]);
    assert.ok(args.includes("--network"));
    assert.ok(args.includes("project-security"));
    assert.ok(args.includes(DIGEST));
    assert.deepEqual(args.slice(args.indexOf(DIGEST) + 1), ["curl", "-fsS", "-o", "/dev/null", "--max-time", "15", "http://app:3000"]);
    assert.ok(!args.includes("--volume"), "a probe mounts nothing: one GET leaves no artifacts");
    assert.ok(!args.includes("--env"), "a probe forwards no secret into the container");
  });

  test("joins the default bridge when the contract declares no network", () => {
    const without = contract({ environment: { ...contract().environment } });
    delete without.environment.network;
    const invocation = probeInvocation(without, "wget");
    assert.ok(!invocation.args.includes("--network"));
    assert.deepEqual(
      invocation.args.slice(invocation.args.indexOf(DIGEST) + 1),
      ["wget", "-q", "-O", "/dev/null", "-T", "15", "http://app:3000"],
    );
  });

  test("refuses an unknown probe client instead of inventing one", () => {
    assert.throws(() => probeInvocation(contract(), "httpie"), /unknown probe client/);
  });
});

describe("security probe diagnosis", () => {
  test("names the named-network containerized application pattern", () => {
    const message = probeDiagnosis(contract(), "exit code 7");
    assert.match(message, /cannot reach http:\/\/app:3000/);
    assert.match(message, /172\.17\.0\.1/);
    assert.match(message, /--network host/);
    assert.match(message, /security_testing\.environment\.network/);
    assert.match(message, /127\.0\.0\.1/);
    assert.match(message, /http:\/\/<alias>:<port>/);
    assert.match(message, /exit code 7/);
  });
});

describe("security probe run", () => {
  test("validates the contract before starting anything", async () => {
    const root = sandbox();
    const calls = [];
    try {
      await assert.rejects(runSecurityProbe(contract({ allowed_targets: ["http://other:3000"] }), {
        cwd: root,
        runStep: async (name) => { calls.push(name); return { name, code: 0, timed_out: false, interrupted: false }; },
      }), /target must exactly match allowed_targets/);
      assert.deepEqual(calls, [], "an invalid contract must not start the environment");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("starts, probes from a container and always stops the environment", async () => {
    const root = sandbox();
    const calls = [];
    try {
      const record = await runSecurityProbe(contract(), {
        cwd: root,
        waitForHealth: async () => calls.push("health"),
        detectClient: async () => "curl",
        runStep: async (name) => {
          calls.push(name);
          return { name, code: 0, duration_ms: 3, timed_out: false, interrupted: false };
        },
      });
      assert.deepEqual(calls, ["start security environment", "health", "probe target reachability", "stop security environment"]);
      assert.equal(record.reachability, "verified");
      assert.equal(record.client, "curl");
      assert.equal(record.target, "http://app:3000");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("fails with the actionable diagnosis and still stops when the target is unreachable", async () => {
    const root = sandbox();
    const calls = [];
    try {
      await assert.rejects(runSecurityProbe(contract(), {
        cwd: root,
        waitForHealth: async () => calls.push("health"),
        detectClient: async () => "curl",
        runStep: async (name) => {
          calls.push(name);
          const failing = name === "probe target reachability";
          return { name, code: failing ? 7 : 0, duration_ms: 3, timed_out: false, interrupted: false };
        },
      }), (error) => {
        assert.match(error.message, /cannot reach http:\/\/app:3000/);
        assert.match(error.message, /security_testing\.environment\.network/);
        assert.match(error.message, /http:\/\/<alias>:<port>/);
        return true;
      });
      assert.equal(calls.at(-1), "stop security environment");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("verifies only the lifecycle when the pinned image ships no HTTP client", async () => {
    const root = sandbox();
    const calls = [];
    try {
      const record = await runSecurityProbe(contract(), {
        cwd: root,
        waitForHealth: async () => calls.push("health"),
        detectClient: async () => null,
        runStep: async (name) => {
          calls.push(name);
          return { name, code: 0, duration_ms: 3, timed_out: false, interrupted: false };
        },
      });
      assert.equal(record.reachability, "not_verified");
      assert.match(record.detail, /reachability was not verified/i);
      assert.ok(!calls.includes("probe target reachability"), "no other image is invented to replace the pinned one");
      assert.equal(calls.at(-1), "stop security environment");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
