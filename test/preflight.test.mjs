import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createSandbox, destroySandbox, run } from "./harness.mjs";
import { classify } from "../scripts/preflight.mjs";

let sandbox = null;
afterEach(() => {
  if (sandbox != null) destroySandbox(sandbox);
  sandbox = null;
});

/**
 * Writes a set of commands into the sandbox configuration.
 *
 * @param commands - gates to declare
 * @param extra - extra configuration keys to merge (closure_gates, ci...)
 * @returns the sandbox path
 */
function withCommands(commands, extra = {}) {
  sandbox = createSandbox();
  const path = join(sandbox, "pipeline.config.json");
  const config = JSON.parse(readFileSync(path, "utf8"));
  config.commands = commands;
  Object.assign(config, extra);
  writeFileSync(path, JSON.stringify(config));
  return sandbox;
}

describe("preflight: telling a missing tool from a real finding", () => {
  test("a green gate is green", () => {
    assert.equal(classify("k", "true").verdict, "verte");
  });

  test("a gate that refuses is classed refusing, not unavailable", () => {
    const result = classify("k", "echo 'secret trouve a la ligne 12' ; exit 1");
    assert.equal(result.verdict, "refuse");
    assert.match(result.detail, /secret trouve/);
  });

  test("a tool that does not exist is classed unavailable", () => {
    const result = classify("k", "outil-qui-nexiste-vraiment-pas --version");
    assert.equal(result.verdict, "indisponible", "un binaire absent n'est pas un constat");
  });

  test("a non-existent script path is classed unavailable", () => {
    assert.equal(classify("k", "node /absent/vraiment/pas-la.mjs").verdict, "indisponible");
  });

  test("measures execution time and identifies an exceeded timeout", () => {
    const result = classify("slow", 'exec node -e "setTimeout(() => {}, 10000)"', { timeoutMs: 100 });
    assert.equal(result.verdict, "trop-longue");
    assert.ok(result.duration_ms >= 0);
    assert.match(result.detail, /100 ms/);
  });
});

describe("preflight: what it returns to the operator", () => {
  test("it exits 0 and says so when everything can run", () => {
    const root = withCommands({ check: "true", lint: "true" });
    const result = run(root, "preflight.mjs");
    assert.equal(result.status, 0);
    assert.match(result.output, /every declared gate can run/);
    assert.match(result.output, /never a missing tool/);
  });

  test("it exits 1 and names the gates that cannot run", () => {
    const root = withCommands({ check: "true", secrets_scan: "outil-absent-xyz" });
    const result = run(root, "preflight.mjs");
    assert.notEqual(result.status, 0);
    assert.match(result.output, /secrets_scan/);
    assert.match(result.output, /fail instead of protecting/);
  });

  test("a gate that refuses does NOT fail the check", () => {
    // `exit 1` alone no longer models a refusing gate: a gate that found
    // something says so, and silence is now read as "it did not run".
    const root = withCommands({ check: "true", lint: "echo 'two style errors' && exit 1" });
    const result = run(root, "preflight.mjs");
    assert.equal(result.status, 0, "preflight verifie l'executabilite, il ne rejoue pas les portes");
    assert.match(result.output, /refuse/);
  });

  test("it offers the two honest exits, never leaving a gate red", () => {
    const root = withCommands({ secrets_scan: "outil-absent-xyz" });
    const result = run(root, "preflight.mjs");
    assert.match(result.output, /Install the tool, or drop the key/);
  });

  test("the machine form lists the missing gates", () => {
    const root = withCommands({ check: "true", sast: "outil-absent-xyz" });
    const result = run(root, "preflight.mjs", ["--json"]);
    const parsed = JSON.parse(result.stdout);
    assert.deepEqual(parsed.missing, ["sast"]);
    assert.ok(parsed.results.every((item) => Number.isFinite(item.duration_ms)));
    assert.ok(Number.isFinite(parsed.duration_ms));
  });

  test("a timed-out gate fails preflight instead of claiming that every gate can run", () => {
    const root = withCommands({ slow: 'exec node -e "setTimeout(() => {}, 10000)"' });
    const result = run(root, "preflight.mjs", ["--timeout-seconds", "0.1", "--json"]);
    assert.notEqual(result.status, 0);
    const parsed = JSON.parse(result.stdout);
    assert.deepEqual(parsed.timed_out, ["slow"]);
  });

  test("announces each command before publishing its measured result", () => {
    const root = withCommands({ check: "true", lint: "true" });
    const result = run(root, "preflight.mjs");
    assert.match(result.stdout, /\[1\/2\] running check/);
    assert.match(result.stdout, /\[2\/2\] running lint/);
    assert.match(result.stdout, /\d+ ms/);
  });

  test("rejects invalid timeout options before running commands", () => {
    const root = withCommands({ check: "true" });
    for (const args of [["--timeout-seconds"], ["--timeout-seconds", "0"], ["--timeout-seconds", "oops"], ["--unknown"]]) {
      const result = run(root, "preflight.mjs", args);
      assert.notEqual(result.status, 0);
      assert.match(result.output, /usage|timeout/);
    }
  });

  test("refuses a configuration with no command at all", () => {
    const root = withCommands({});
    const result = run(root, "preflight.mjs");
    assert.notEqual(result.status, 0);
    assert.match(result.output, /no command declared/);
  });
});

describe("preflight: gates deferred to closure are not run during installation", () => {
  test("a closure gate is reported deferred, never executed, and does not fail the run", () => {
    const root = withCommands({ check: "true", dast_active: "exit 1" }, { closure_gates: ["dast_active"] });
    const result = run(root, "preflight.mjs", ["--json"]);
    assert.equal(result.status, 0, "had dast_active run, its silent exit 1 would read as a missing tool");
    const parsed = JSON.parse(result.stdout);
    assert.deepEqual(parsed.deferred, ["dast_active"]);
    assert.deepEqual(parsed.missing, []);
    const item = parsed.results.find((entry) => entry.key === "dast_active");
    assert.equal(item.verdict, "deferred");
  });

  test("a gate CI binds to specific events is deferred as well", () => {
    const root = withCommands(
      { check: "true", load: "exit 1" },
      { ci: { provider: "none", gate_events: { load: ["schedule"] } } },
    );
    const result = run(root, "preflight.mjs", ["--json"]);
    assert.equal(result.status, 0);
    assert.deepEqual(JSON.parse(result.stdout).deferred, ["load"]);
  });

  test("--include-deferred runs the closure gates anyway", () => {
    const root = withCommands(
      { check: "true", dast_active: "echo 'two findings' && exit 1" },
      { closure_gates: ["dast_active"] },
    );
    const result = run(root, "preflight.mjs", ["--include-deferred", "--json"]);
    const parsed = JSON.parse(result.stdout);
    assert.deepEqual(parsed.deferred, []);
    const item = parsed.results.find((entry) => entry.key === "dast_active");
    assert.equal(item.verdict, "refuse", "the flag must really execute the gate, not relabel it");
    assert.equal(result.status, 0);
  });

  test("a missing tool behind a deferred gate stays out of the verdict", () => {
    const root = withCommands({ check: "true", dast_active: "outil-absent-xyz" }, { closure_gates: ["dast_active"] });
    const result = run(root, "preflight.mjs");
    assert.equal(result.status, 0);
    assert.match(result.output, /deferred/);
    assert.match(result.output, /dast_active/);
    assert.match(result.output, /--include-deferred/);
  });
});

describe("preflight: a gate that fails without saying anything is not reporting a finding", () => {
  test("classes a silent non-zero exit as unavailable, not as refusing", () => {
    const root = withCommands({ check: "exit 254" });
    const result = run(root, "preflight.mjs", ["--json"]);
    assert.deepEqual(
      JSON.parse(result.stdout).missing,
      ["check"],
      "a task runner given --silent prints nothing when its manifest is missing: exit 254, zero output. " +
        "Classed as refusing, preflight then reports that every gate can run in a project where none can.",
    );
  });

  test("a gate that refuses and says why stays a finding", () => {
    const root = withCommands({ check: "echo 'two type errors' && exit 1" });
    const result = run(root, "preflight.mjs", ["--json"]);
    assert.deepEqual(JSON.parse(result.stdout).missing, [], "silence is the signal, not failure");
  });
});
