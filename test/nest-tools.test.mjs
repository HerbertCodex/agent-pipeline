import { test } from "node:test";
import assert from "node:assert/strict";
import { secretKind } from "../profile-bundles/nest/tools/secrets.mjs";
import { violations } from "../profile-bundles/nest/tools/design.mjs";

test("the Nest secret scanner detects credential shapes without accepting ordinary identifiers", () => {
  assert.equal(secretKind("-----BEGIN " + "PRIVATE KEY-----"), "private key");
  assert.equal(secretKind("AKIA" + "A".repeat(16)), "AWS access key");
  assert.equal(secretKind("ghp_" + "a".repeat(36)), "GitHub token");
  assert.equal(secretKind("xoxb-" + "a".repeat(24)), "Slack token");
  assert.equal(secretKind("const token = process.env.API_TOKEN;"), null);
});

test("the Nest design policy refuses each bound independently", () => {
  const limits = { complexity: 12, function_lines: 80, parameters: 5, nesting: 4 };
  const base = { line: 1, name: "fixture", ...limits };
  assert.deepEqual(violations([base], limits), []);
  for (const key of Object.keys(limits)) {
    const result = violations([{ ...base, [key]: limits[key] + 1 }], limits);
    assert.equal(result.length, 1);
    assert.ok(result[0].includes(key));
  }
});
