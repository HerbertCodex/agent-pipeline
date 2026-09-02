import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const framework = join(here, "..");
const bootstrap = readFileSync(join(framework, "docs", "nouveau-profil.md"), "utf8");
const gates = readFileSync(join(framework, "docs", "quality-gates.md"), "utf8");

test("the bootstrap guide distinguishes QA closure gates from CI deferral", () => {
  assert.match(bootstrap, /closure_gates[\s\S]*QA[\s\S]*not.*CI/i);
  assert.match(bootstrap, /only.*map.*deferred.*CI/i);
  assert.match(gates, /closure_gates[^\n]*does not touch CI/i);
});
