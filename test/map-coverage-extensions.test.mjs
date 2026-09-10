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

test("map coverage accepts a skip list of glob patterns, the shape the frontend bundles ship", () => {
  const root = createSandbox();
  try {
    const config = JSON.parse(readFileSync(join(root, "pipeline.config.json"), "utf8"));
    config.project_map = { roots: ["src"], out: "docs/project-map.md", skip: ["**/generated/**"] };
    writeFileSync(join(root, "pipeline.config.json"), JSON.stringify(config));
    mkdirSync(join(root, "src", "generated"), { recursive: true });
    writeFileSync(join(root, "src", "app.ts"), "export const app = 1;\n");
    writeFileSync(join(root, "src", "generated", "b.ts"), "export const b = 2;\n");
    writeFileSync(join(root, "docs", "project-map.md"), "src/app.ts\n");
    const result = run(root, "map-coverage.mjs");
    assert.equal(result.status, 0, `a skip list must not crash the walk: ${result.output}`);
  } finally { destroySandbox(root); }
});

test("map coverage still honours a skip given as a regex string", () => {
  const root = createSandbox();
  try {
    const config = JSON.parse(readFileSync(join(root, "pipeline.config.json"), "utf8"));
    config.project_map = { roots: ["src"], out: "docs/project-map.md", skip: "generated" };
    writeFileSync(join(root, "pipeline.config.json"), JSON.stringify(config));
    mkdirSync(join(root, "src", "generated"), { recursive: true });
    writeFileSync(join(root, "src", "app.ts"), "export const app = 1;\n");
    writeFileSync(join(root, "src", "generated", "b.ts"), "export const b = 2;\n");
    writeFileSync(join(root, "docs", "project-map.md"), "src/app.ts\n");
    const result = run(root, "map-coverage.mjs");
    assert.equal(result.status, 0, result.output);
  } finally { destroySandbox(root); }
});
