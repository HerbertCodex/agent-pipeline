import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeUpdate } from "../scripts/setup-migration.mjs";

test("migration merges independent changes while preserving local configuration", () => {
  const base = { config: { smoke: { path: "/", status: 200 }, commands: { check: "old", lint: "same" } }, files: { "tool.mjs": "old", "context.md": "original" } };
  const local = { config: { smoke: { path: "/health", status: 200 }, commands: { check: "old", lint: "same" } }, files: { "tool.mjs": "old", "context.md": "my context" } };
  const incoming = { config: { smoke: { path: "/", status: 200 }, commands: { check: "new", lint: "same" } }, files: { "tool.mjs": "new", "context.md": "original", "new.mjs": "added" } };
  const result = mergeUpdate(base, local, incoming);
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.config.smoke.path, "/health");
  assert.equal(result.config.commands.check, "new");
  assert.equal(result.files["context.md"], "my context");
  assert.equal(result.files["new.mjs"], "added");
});

test("migration reports both-sided conflicts and treats arrays as one choice", () => {
  const base = { config: { gates: ["a"] }, files: { "tool.mjs": "base" } };
  const local = { config: { gates: ["a", "local"] }, files: { "tool.mjs": "local" } };
  const incoming = { config: { gates: ["a", "upstream"] }, files: { "tool.mjs": "upstream" } };
  assert.deepEqual(mergeUpdate(base, local, incoming).conflicts.sort(), ["config.gates", "files.tool.mjs"]);
});

test("migration preserves deletions and identifies safe obsolete file removal", () => {
  const base = { config: { obsolete: true, retained: true }, files: { "old.mjs": "old" } };
  const local = { config: { retained: true }, files: { "old.mjs": "old" } };
  const incoming = { config: { obsolete: true, retained: true }, files: {} };
  const result = mergeUpdate(base, local, incoming);
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.config, { retained: true });
  assert.deepEqual(result.files, {});
});
