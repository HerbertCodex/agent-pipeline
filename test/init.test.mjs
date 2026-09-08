import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import { run } from "./harness.mjs";

const roots = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

function bootstrap() {
  const root = mkdtempSync(join(tmpdir(), "pipeline-init-"));
  roots.push(root);
  const answers = join(root, "answers.json");
  writeFileSync(answers, JSON.stringify({
    product: "A lending API", constraints: ["private data"],
    stack: { imposed: false }, architecture: { project_type: "backend", id: "feature-modules" },
  }));
  return { root, answers };
}

describe("init", () => {
  test("writes an auditable bootstrap decision and incomplete configuration", () => {
    const { root, answers } = bootstrap();
    const result = run(root, "init.mjs", ["--answers", answers]);
    assert.equal(result.status, 0, result.output);
    const config = JSON.parse(readFileSync(join(root, "pipeline.config.json"), "utf8"));
    const decision = JSON.parse(readFileSync(join(root, "pipeline.bootstrap.json"), "utf8"));
    assert.deepEqual(config.architecture, { project_type: "backend", id: "feature-modules" });
    assert.equal(decision.framework_version, "0.2.0");
    assert.match(readFileSync(join(root, "docs", "decisions", "0000-bootstrap.md"), "utf8"), /A lending API/);
  });

  test("refuses to overwrite decisions already recorded", () => {
    const { root, answers } = bootstrap();
    assert.equal(run(root, "init.mjs", ["--answers", answers]).status, 0);
    assert.notEqual(run(root, "init.mjs", ["--answers", answers]).status, 0);
  });

  test("refuses an architecture that does not apply to the selected project type", () => {
    const { root, answers } = bootstrap();
    writeFileSync(answers, JSON.stringify({
      product: "A browser application", constraints: [],
      stack: { imposed: false }, architecture: { project_type: "frontend", id: "hexagonal" },
    }));
    const result = run(root, "init.mjs", ["--answers", answers]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /feature-modules.*feature-sliced.*mvvm.*mvi.*custom/);
  });
});
