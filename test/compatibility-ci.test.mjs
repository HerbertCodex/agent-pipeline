import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

test("CI matrix follows every supported manifest entry rather than a second version list", () => {
  const manifest = JSON.parse(readFileSync(new URL("../profile-bundles/nest/compatibility.json", import.meta.url), "utf8"));
  const matrix = JSON.parse(execFileSync(process.execPath, ["profile-bundles/nest/ci.mjs", "--matrix"], { encoding: "utf8" }));
  assert.deepEqual(matrix.include, manifest.supported.map((entry) => ({ id: entry.id, ...entry.reference })));
  assert.equal(new Set(matrix.include.map((entry) => entry.id)).size, manifest.supported.length);
});
