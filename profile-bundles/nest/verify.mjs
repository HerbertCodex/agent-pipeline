import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { runStep } from "../../scripts/setup-runner.mjs";
import { measure, violations } from "./tools/design.mjs";
import { smoke } from "./tools/smoke.mjs";

// Run only in a disposable, installed Nest host. Probe files are removed in finally.
const config = JSON.parse(readFileSync("pipeline.config.json", "utf8"));
assert.equal(config.setup?.adapter, "nest");
const require = createRequire(join(process.cwd(), "package.json"));
const ts = require("typescript");
const limits = config.design_limits;
const probes = {
  parameters: "function probe(a,b,c,d,e,f) { return a; }",
  function_lines: `function probe() {\n${"  void 0;\n".repeat(90)}}`,
  complexity: `function probe(value) { ${"if (value) { value++; } ".repeat(15)}}`,
  nesting: "function probe(value) { if(value) { if(value) { if(value) { if(value) { if(value) { value++; } } } } } }",
};
for (const [key, source] of Object.entries(probes)) {
  assert.ok(violations(measure(ts, source), limits).some((line) => line.includes(key)), `${key} must reject its deliberate defect`);
}
assert.deepEqual(violations(measure(ts, "function probe() { return 1; }"), limits), []);

async function refused(gate, files) {
  for (const path of Object.keys(files)) assert.equal(existsSync(path), false, `Probe already exists: ${path}`);
  try {
    for (const [path, source] of Object.entries(files)) writeFileSync(path, source);
    const result = await runStep(`negative proof: ${gate}`, config.commands[gate], [], { shell: true });
    assert.equal(result.timed_out, false);
    assert.equal(result.interrupted, false);
    assert.equal(result.error, undefined);
    assert.ok(Number.isInteger(result.code) && result.code > 0, `${gate} accepted its deliberate defect`);
  } finally {
    for (const path of Object.keys(files)) if (existsSync(path)) unlinkSync(path);
  }
}

const sourceProbe = "src/pipeline-install-probe.ts";
await refused("check", { [sourceProbe]: 'export const invalid: number = "wrong";\n' });
await refused("build", { [sourceProbe]: 'export const invalid: number = "wrong";\n' });
await refused("lint", { [sourceProbe]: "const = ;\n" });
await refused("design_limits", { [sourceProbe]: probes.parameters });
const runner = config.setup.test_runner === "jest" ? "@jest/globals" : "vitest";
const failingTest = `import { test, expect } from "${runner}";\ntest("pipeline negative proof", () => { expect(1).toBe(2); });\n`;
await refused("test_unit", { "src/pipeline-install-probe.spec.ts": failingTest });
await refused("test_e2e", { "test/pipeline-install-probe.e2e-spec.ts": failingTest });
await refused("secrets_scan", { "pipeline-install-probe.txt": "ghp_" + "a".repeat(36) });
const duplicate = "export function duplicate(value: number) {\n" + Array.from({ length: 9 }, (_, index) => `  value += ${index};`).join("\n") + "\n  return value;\n}\n";
await refused("duplication", { [sourceProbe]: duplicate, "src/pipeline-install-probe-copy.ts": duplicate });
await refused("project_map", { [sourceProbe]: "export const newSymbol = 1;\n" });
await assert.rejects(smoke({ ...config.smoke, status: 599 }), /Smoke expected/);
console.log("Nest preset negative proofs passed. Probe files removed. Rebuild before the next smoke gate.");
