import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createSandbox, destroySandbox, run } from "./harness.mjs";
import { materializeProfile } from "../profile-bundles/frontend-typescript/materialize.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const bundle = join(here, "..", "profile-bundles", "frontend-typescript");
const packageScript = (name) => ["npm", "run", name].join(" ");

function manifest() {
  return JSON.parse(readFileSync(join(bundle, "profile.json"), "utf8"));
}

describe("frontend TypeScript reference profile: measurable structure", () => {
  test("stays framework-neutral while naming the required quality surfaces", () => {
    const profile = manifest();
    const commands = new Set(Object.keys(profile.commands));

    assert.equal(profile.project_type, "frontend");
    for (const key of [
      "check",
      "lint",
      "build",
      "test_unit",
      "test_e2e",
      "coverage",
      "accessibility",
      "architecture",
      "design_tokens",
      "css_ownership",
      "visual_regression",
      "dead_code",
      "duplication",
      "design_limits",
      "audit",
      "secrets_scan",
      "smoke",
      "project_map",
    ]) {
      assert.ok(commands.has(key), `the frontend profile has no ${key} gate`);
    }
    const serialized = JSON.stringify(profile);
    assert.doesNotMatch(serialized, /react|vue|svelte|angular|solid/i);
  });

  test("requires calibration instead of trusting thresholds from another codebase", () => {
    assert.equal(manifest().calibration_required, true);
  });

  test("binds every invariant to a command that can refuse it", () => {
    const profile = manifest();
    const invariants = readFileSync(join(bundle, "invariants.md"), "utf8")
      .split("\n")
      .filter((line) => line.startsWith("- "));

    assert.ok(invariants.length >= 8);
    for (const invariant of invariants) {
      const gate = invariant.match(/\(`([a-z0-9_]+)`\)\s*$/)?.[1];
      assert.ok(gate != null, `invariant names no gate: ${invariant}`);
      assert.equal(typeof profile.commands[gate], "string", `invariant names undeclared gate ${gate}`);
    }
  });

  test("keeps coding agents away from policy files and limits Product to Sudocode", () => {
    const policy = manifest().file_policy;
    const denied = policy.implementer.deny.join("\n");

    assert.match(denied, /package\.json/);
    assert.match(denied, /agent-pipeline/);
    assert.match(denied, /pipeline\.config\.json/);
    assert.match(denied, /AGENTS\.md/);
    assert.deepEqual(policy.qa.allow, []);
    assert.deepEqual(policy.product.allow, [".sudocode/**"]);
    assert.ok(policy.orchestrator.allow.includes(".sudocode/**"));
  });

  test("maps production and test code before allowing a new export", () => {
    const map = manifest().project_map;

    assert.ok(map.roots.includes("src"));
    assert.ok(map.roots.some((root) => /test|e2e/.test(root)));
    assert.equal(typeof map.regenerate, "string");
    assert.match(manifest().commands.project_map, /--check/);
  });

  test("imports through the same profile mechanism as a project-owned bundle", () => {
    const root = createSandbox();
    try {
      const host = join(root, "host");
      mkdirSync(join(host, "agent-pipeline"), { recursive: true });
      const result = run(root, "import-profile.mjs", [bundle, host]);
      const config = JSON.parse(readFileSync(join(host, "pipeline.config.json"), "utf8"));

      assert.equal(result.status, 0, result.output);
      assert.equal(config.profile, "frontend-typescript");
      assert.match(config.commands.accessibility, /test:a11y/);
      assert.ok(
        existsSync(join(host, "pipeline", "profiles", "frontend-typescript", "invariants.md")),
      );
    } finally {
      destroySandbox(root);
    }
  });
});

describe("frontend TypeScript profile materialization", () => {
  function host({ frontend = true } = {}) {
    const root = createSandbox();
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "main.tsx"), "export const App = () => null;\n");
    writeFileSync(join(root, "tsconfig.json"), "{}\n");
    writeFileSync(join(root, "package-lock.json"), "{}\n");
    if (frontend) writeFileSync(join(root, "index.html"), '<div id="root"></div>\n');
    writeFileSync(join(root, "package.json"), JSON.stringify({
      name: "catalog-ui",
      scripts: {
        typecheck: "tsc --noEmit",
        lint: "eslint .",
        build: "vite build",
        test: "vitest run",
        "test:e2e": "playwright test",
        "test:a11y": "playwright test tests/a11y.spec.ts",
        "test:visual": "playwright test tests/visual.spec.ts",
      },
      dependencies: frontend ? { react: "19.1.1" } : {},
      devDependencies: { typescript: "5.9.3", vite: "7.1.4", vitest: "3.2.4" },
    }, null, 2));
    return root;
  }

  test("creates a technology-named bundle from commands the host actually carries", () => {
    const root = host();
    try {
      const output = join(root, "candidate");
      const result = materializeProfile(root, output);
      const profile = JSON.parse(readFileSync(join(output, "profile.json"), "utf8"));

      assert.equal(result.name, "frontend-react-vite");
      assert.equal(profile.source_profile, "frontend-typescript");
      assert.equal(profile.calibration_required, true);
      assert.equal(profile.commands.check, packageScript("typecheck"));
      assert.equal(profile.commands.test_unit, packageScript("test"));
      assert.equal(profile.commands.test_e2e, packageScript("test:e2e"));
      assert.equal(profile.commands.accessibility, packageScript("test:a11y"));
      assert.equal(profile.commands.visual_regression, packageScript("test:visual"));
      assert.equal(profile.commands.mutation, undefined);
      assert.deepEqual(profile.project_map.roots, ["src"]);
      assert.equal(profile.project_map.regenerate, "node agent-pipeline/scripts/project-map.mjs");
      assert.equal(profile.commands.project_map, undefined);
      assert.deepEqual(profile.detected.technologies.map((entry) => entry.name), [
        "react",
        "vite",
        "vitest",
        "typescript",
      ]);
      assert.ok(profile.capabilities.missing_required.includes("secrets_scan"));
      assert.ok(profile.capabilities.missing_required.includes("design_limits"));
      assert.ok(!profile.capabilities.missing_required.includes("accessibility"));
      assert.ok(!profile.capabilities.optional_not_detected.includes("dead_code"));
      assert.match(readFileSync(join(output, "DISCOVERY.md"), "utf8"), /secrets_scan|design_limits/);
    } finally {
      destroySandbox(root);
    }
  });

  test("does not invent optional gates whose scripts are absent", () => {
    const root = host();
    try {
      const pkgPath = join(root, "package.json");
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      pkg.scripts["test:e2e"] = "echo not implemented";
      delete pkg.scripts["test:a11y"];
      delete pkg.scripts["test:visual"];
      writeFileSync(pkgPath, JSON.stringify(pkg));
      const output = join(root, "candidate");
      materializeProfile(root, output);
      const profile = JSON.parse(readFileSync(join(output, "profile.json"), "utf8"));

      assert.equal(profile.commands.test_e2e, undefined);
      assert.equal(profile.commands.accessibility, undefined);
      assert.equal(profile.commands.visual_regression, undefined);
      assert.ok(profile.capabilities.missing_required.includes("accessibility"));
      assert.ok(profile.capabilities.optional_not_detected.includes("test_e2e"));
    } finally {
      destroySandbox(root);
    }
  });

  test("reuses a project-owned map only when its writer exists", () => {
    const root = host();
    try {
      const pkgPath = join(root, "package.json");
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      pkg.scripts["project-map"] = "tsx tools/project-map.ts";
      pkg.scripts["project-map:check"] = "tsx tools/project-map.ts --check";
      writeFileSync(pkgPath, JSON.stringify(pkg));
      const output = join(root, "candidate");
      materializeProfile(root, output);
      const profile = JSON.parse(readFileSync(join(output, "profile.json"), "utf8"));

      assert.equal(profile.commands.project_map, packageScript("project-map:check"));
      assert.equal(profile.project_map.regenerate, packageScript("project-map"));
    } finally {
      destroySandbox(root);
    }
  });

  test("imports the materialized bundle through the existing profile mechanism", () => {
    const root = host();
    try {
      const output = join(root, "candidate");
      materializeProfile(root, output);
      const installHost = join(root, "installed");
      mkdirSync(join(installHost, "agent-pipeline"), { recursive: true });
      const result = run(root, "import-profile.mjs", [output, installHost]);
      const config = JSON.parse(readFileSync(join(installHost, "pipeline.config.json"), "utf8"));

      assert.equal(result.status, 0, result.output);
      assert.equal(config.profile, "frontend-react-vite");
      assert.equal(config.commands.check, packageScript("typecheck"));
      assert.equal(config.commands.project_map, "node agent-pipeline/scripts/project-map.mjs --check");
      assert.equal(config.project_map.regenerate, "node agent-pipeline/scripts/project-map.mjs");
    } finally {
      destroySandbox(root);
    }
  });

  test("refuses a TypeScript service with no front-end evidence", () => {
    const root = host({ frontend: false });
    try {
      const output = join(root, "candidate");
      assert.throws(() => materializeProfile(root, output), /front-end evidence/);
      assert.equal(existsSync(output), false);
    } finally {
      destroySandbox(root);
    }
  });
});
