import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { createSandbox, destroySandbox, run } from "./harness.mjs";

let sandbox = null;
afterEach(() => {
  if (sandbox != null) destroySandbox(sandbox);
  sandbox = null;
});

// Sample credentials are assembled, never written as one literal: a whole
// sample sitting in this file is the first thing a real sweep of this
// repository would report.
const AWS_SAMPLE = "AKIA" + "IOSFODNN7EXAMPLE";
const GITHUB_SAMPLE = "ghp_" + "a".repeat(36);
const PASSWORD_SAMPLE = "correct-horse-battery-9";

/**
 * Prepares a sandbox holding the given files and `secrets_scan` block.
 *
 * @param files - map of relative path to content
 * @param settings - the `secrets_scan` block, or null to omit it entirely
 * @returns the sandbox root
 */
function withTree(files, settings) {
  const root = createSandbox();
  const path = join(root, "pipeline.config.json");
  const config = JSON.parse(readFileSync(path, "utf8"));
  if (settings != null) config.secrets_scan = settings;
  writeFileSync(path, JSON.stringify(config, null, 2));
  for (const [name, body] of Object.entries(files)) {
    const target = join(root, name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, body);
  }
  return root;
}

describe("secrets-scan: the dependency-free floor of secrets_scan", () => {
  test("refuses a configuration with no roots, because a guessed tree is green for the wrong reason", () => {
    sandbox = withTree({ "src/app.ts": "export const answer = 42;\n" }, null);
    const result = run(sandbox, "secrets-scan.mjs", []);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /secrets_scan\.roots/);
    assert.match(result.output, /green for the wrong reason/, "the refusal says why guessing is refused, not only that it is");
  });

  test("refuses an empty roots list on the same grounds", () => {
    sandbox = withTree({ "src/app.ts": "export const answer = 42;\n" }, { roots: [] });
    const result = run(sandbox, "secrets-scan.mjs", []);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /secrets_scan\.roots/);
  });

  test("refuses to report green when nothing was scanned", () => {
    sandbox = withTree({ "README.md": "# demo\n" }, { roots: ["src"] });
    const result = run(sandbox, "secrets-scan.mjs", []);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /no file to sweep/, "an empty sweep must not close a gate");
  });

  test("a clean tree exits zero and states the limit of the method", () => {
    sandbox = withTree({ "src/app.ts": "export const answer = 42;\n" }, { roots: ["src"] });
    const result = run(sandbox, "secrets-scan.mjs", []);
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /no recognized credential/);
    assert.match(result.output, /patterns, not entropy/, "a green verdict that hides its own limit reads as a guarantee");
  });

  test("flags an AWS access key with its rule name and location", () => {
    sandbox = withTree({ "src/config.ts": `const awsKey = "${AWS_SAMPLE}";\n` }, { roots: ["src"] });
    const result = run(sandbox, "secrets-scan.mjs", []);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /aws-access-key/);
    assert.match(result.output, /src\/config\.ts:1/);
  });

  test("flags a GitHub token", () => {
    sandbox = withTree({ "src/config.ts": `const hub = "${GITHUB_SAMPLE}";\n` }, { roots: ["src"] });
    const result = run(sandbox, "secrets-scan.mjs", []);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /github-token/);
  });

  test("flags a private key header", () => {
    sandbox = withTree({ "src/key.pem": "-----BEGIN " + "PRIVATE KEY-----\nMIIBOgIBAAJBAK\n" }, { roots: ["src"] });
    const result = run(sandbox, "secrets-scan.mjs", []);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /private-key/);
  });

  test("flags a high-entropy literal assigned to a credential name", () => {
    sandbox = withTree({ "src/config.ts": `const password = "${PASSWORD_SAMPLE}";\n` }, { roots: ["src"] });
    const result = run(sandbox, "secrets-scan.mjs", []);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /high-entropy-assignment/);
  });

  test("redacts the matched secret in its report", () => {
    sandbox = withTree({ "src/config.ts": `const awsKey = "${AWS_SAMPLE}";\n` }, { roots: ["src"] });
    const result = run(sandbox, "secrets-scan.mjs", []);
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.output, /IOSFODNN7EXAMPLE/, "a report that prints the credential leaks it into every log that catches it");
    assert.match(result.output, /AKIA/, "the first characters stay, so the hit can be told from a neighbour");
  });

  test("an allowlisted example key passes", () => {
    sandbox = withTree(
      { "src/config.ts": `const example = "${AWS_SAMPLE}";\n` },
      { roots: ["src"], allow: ["AKIAIOSFODNN7EXAMPLE"] },
    );
    const result = run(sandbox, "secrets-scan.mjs", []);
    assert.equal(result.status, 0, result.output);
  });

  test("the default skip covers dependencies, builds, coverage and lockfiles", () => {
    sandbox = withTree(
      {
        "src/ok.ts": "export const answer = 42;\n",
        "node_modules/pkg/index.js": `const k = "${AWS_SAMPLE}";\n`,
        "dist/bundle.js": `const k = "${AWS_SAMPLE}";\n`,
        "build/out.js": `const k = "${AWS_SAMPLE}";\n`,
        "coverage/lcov-report.js": `const k = "${AWS_SAMPLE}";\n`,
        "package-lock.json": `{"resolved":"${GITHUB_SAMPLE}"}\n`,
        "yarn.lock": `# lock\n${GITHUB_SAMPLE}\n`,
        "pnpm-lock.yaml": `resolved: ${GITHUB_SAMPLE}\n`,
      },
      { roots: ["."] },
    );
    const result = run(sandbox, "secrets-scan.mjs", []);
    assert.equal(result.status, 0, result.output);
  });

  test("accepts skip as a regular expression", () => {
    sandbox = withTree(
      {
        "src/app.ts": "export const answer = 42;\n",
        "src/fixtures/sample.ts": `const k = "${AWS_SAMPLE}";\n`,
      },
      { roots: ["src"], skip: "fixtures" },
    );
    const result = run(sandbox, "secrets-scan.mjs", []);
    assert.equal(result.status, 0, result.output);
  });

  test("accepts skip as a list of globs, without over-skipping", () => {
    sandbox = withTree(
      {
        "src/real.ts": `const k = "${AWS_SAMPLE}";\n`,
        "src/fixtures/sample.ts": `const k = "${AWS_SAMPLE}";\n`,
      },
      { roots: ["src"], skip: ["src/fixtures/**"] },
    );
    const result = run(sandbox, "secrets-scan.mjs", []);
    assert.notEqual(result.status, 0, "the real file keeps being swept");
    assert.match(result.output, /src\/real\.ts:1/);
    assert.doesNotMatch(result.output, /fixtures\/sample\.ts:1/);
  });
});
