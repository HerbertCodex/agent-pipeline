import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const framework = join(here, "..");
const guide = readFileSync(join(framework, "docs", "nouveau-profil.md"), "utf8");
const frontend = readFileSync(
  join(framework, "profile-bundles", "frontend-typescript", "README.md"),
  "utf8",
);
const template = readFileSync(
  join(framework, "templates", "pipeline.config.template.json"),
  "utf8",
);

describe("a new JavaScript or TypeScript project gets a real dead-code recommendation", () => {
  test("the bootstrap guide recommends Knip without silently installing it", () => {
    assert.match(guide, /JavaScript or TypeScript[\s\S]*Knip/i);
    assert.match(guide, /npm install --save-dev knip/);
    assert.match(guide, /operator[\s\S]*approv|approv[\s\S]*operator/i);
    assert.match(guide, /commands\.dead_code/);
    assert.match(guide, /check:dead-code/);
  });

  test("the recommendation is calibrated against the observed project", () => {
    assert.match(guide, /manifest[\s\S]*entry[\s\S]*project/i);
    assert.match(guide, /unused file[\s\S]*unused export[\s\S]*unused dependency/i);
    assert.match(guide, /false positive|false-positive/i);
    assert.match(guide, /do not copy|never copy/i);
  });

  test("the TypeScript reference profile carries the same operational choice", () => {
    assert.match(frontend, /Knip/);
    assert.match(frontend, /check:dead-code/);
    assert.match(frontend, /operator[\s\S]*approv|approv[\s\S]*operator/i);
    assert.match(frontend, /npm install --save-dev knip/);
  });

  test("non-JavaScript projects keep the dependency-free fallback", () => {
    assert.match(template, /agent-pipeline\/scripts\/dead-code\.mjs/);
    assert.doesNotMatch(template, /knip/i);
  });
});
