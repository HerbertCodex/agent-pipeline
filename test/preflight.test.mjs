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
 * @returns the sandbox path
 */
function withCommands(commands) {
  sandbox = createSandbox();
  const path = join(sandbox, "pipeline.config.json");
  const config = JSON.parse(readFileSync(path, "utf8"));
  config.commands = commands;
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
  });

  test("refuses a configuration with no command at all", () => {
    const root = withCommands({});
    const result = run(root, "preflight.mjs");
    assert.notEqual(result.status, 0);
    assert.match(result.output, /no command declared/);
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
