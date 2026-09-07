import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createSandbox, destroySandbox, run } from "./harness.mjs";

test("map coverage checks the same configured extensions as the map generator", () => {
  const root = createSandbox();
  try {
    const config = JSON.parse(readFileSync(join(root, "pipeline.config.json"), "utf8"));
    config.project_map = { roots: ["src"], extensions: [".ts"], out: "docs/project-map.md" };
    writeFileSync(join(root, "pipeline.config.json"), JSON.stringify(config));
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "test-config.json"), "{}");
    writeFileSync(join(root, "src", "app.ts"), "export const app = 1;\n");
    writeFileSync(join(root, "docs", "project-map.md"), "src/app.ts\n");
    let result = run(root, "map-coverage.mjs");
    assert.equal(result.status, 0, result.output);
    writeFileSync(join(root, "src", "missing.ts"), "export const missing = 1;\n");
    result = run(root, "map-coverage.mjs");
    assert.notEqual(result.status, 0);
    assert.match(result.output, /missing.ts/);
  } finally { destroySandbox(root); }
});
