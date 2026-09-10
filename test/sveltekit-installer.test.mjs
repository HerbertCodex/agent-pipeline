import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  detect,
  plan,
  prerequisites,
  mergePackageJson,
  editEslintConfig,
  editPlaywrightConfig,
  editPrettierIgnore,
  nodeSatisfies,
  registryAudit,
} from "../profile-bundles/sveltekit/installer.mjs";
import { inRange } from "../scripts/adapter-compatibility.mjs";
import { chdirToFramework } from "./framework-root.mjs";

chdirToFramework();

const roots = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

const npmRun = (name) => ["npm", "run", name].join(" ");
const defaults = () => JSON.parse(readFileSync(resolve("templates/pipeline.config.template.json"), "utf8"));
const compatibilityManifest = JSON.parse(readFileSync(new URL("../profile-bundles/sveltekit/compatibility.json", import.meta.url), "utf8"));
const supportedRuntime = compatibilityManifest.supported.some((entry) => inRange(process.versions.node, entry.node));

// Versions resolved by the official sv@0.17.0 scaffold, recorded in VALIDATION.md.
const HOST_DEPS = {
  "@sveltejs/kit": "2.70.3",
  svelte: "5.57.0",
  vite: "8.2.2",
  typescript: "6.0.3",
  vitest: "4.1.11",
  "@playwright/test": "1.63.0",
  eslint: "10.10.0",
  prettier: "3.9.6",
  "svelte-check": "4.7.6",
  "@sveltejs/adapter-node": "5.5.7",
};

const ESLINT_SCAFFOLD = `import prettier from 'eslint-config-prettier';
import path from 'node:path';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import { defineConfig, includeIgnoreFile } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';

const gitignorePath = path.resolve(import.meta.dirname, '.gitignore');

export default defineConfig(
	includeIgnoreFile(gitignorePath),
	js.configs.recommended,
	ts.configs.recommended,
	svelte.configs.recommended,
	prettier,
	svelte.configs.prettier
);
`;

const PLAYWRIGHT_SCAFFOLD = `import { defineConfig } from '@playwright/test';

export default defineConfig({
	webServer: { command: '${npmRun("build")} && ${npmRun("preview")}', port: 4173 },
	testDir: 'e2e'
});
`;

const DESIGN_SYSTEM = {
  tokens: "src/lib/ui/tokens.css",
  primitives: "own",
  direction: { genre: "minimal reader", because: "the product is a reading tool and chrome would compete with the text" },
  decided_at: "2026-09-10",
};

function scaffold({ bootstrap = true, designSystem = true, versions = HOST_DEPS, installed = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "sveltekit-installer-"));
  roots.push(root);
  mkdirSync(join(root, "src/routes"), { recursive: true });
  mkdirSync(join(root, "src/lib"), { recursive: true });
  mkdirSync(join(root, "e2e"), { recursive: true });
  writeFileSync(join(root, "src/routes/+page.svelte"), "<h1>Home</h1>\n");
  writeFileSync(join(root, "src/lib/index.ts"), "export const place = 'holder';\n");
  writeFileSync(join(root, "e2e/demo.test.ts"), "import { test } from '@playwright/test';\ntest('demo', async () => {});\n");
  writeFileSync(join(root, "svelte.config.js"), "import adapter from '@sveltejs/adapter-node';\n\nexport default { kit: { adapter: adapter() } };\n");
  writeFileSync(join(root, "vite.config.ts"), "import { sveltekit } from '@sveltejs/kit/vite';\nimport { defineConfig } from 'vite';\n\nexport default defineConfig({ plugins: [sveltekit()] });\n");
  writeFileSync(join(root, "playwright.config.ts"), PLAYWRIGHT_SCAFFOLD);
  writeFileSync(join(root, "eslint.config.js"), ESLINT_SCAFFOLD);
  writeFileSync(join(root, ".prettierignore"), "# Package Managers\npackage-lock.json\n\n# Miscellaneous\n/static/\n");
  writeFileSync(join(root, "package-lock.json"), "{}\n");
  writeFileSync(join(root, "tsconfig.json"), "{}\n");
  writeFileSync(join(root, "package.json"), JSON.stringify({
    name: "app",
    private: true,
    version: "0.0.1",
    type: "module",
    scripts: {
      dev: "vite dev",
      build: "vite build",
      preview: "vite preview",
      prepare: "svelte-kit sync || echo ''",
      check: "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json",
      lint: "prettier --check . && eslint .",
      "test:unit": "vitest",
      "test:e2e": "playwright test",
    },
    devDependencies: Object.fromEntries(Object.entries(versions).map(([name, version]) => [name, `^${version}`])),
  }, null, 2));
  if (bootstrap) {
    const record = { format: 1, product: "A reading tool", architecture: { project_type: "fullstack", id: "feature-modules" } };
    if (designSystem) record.design_system = DESIGN_SYSTEM;
    writeFileSync(join(root, "pipeline.bootstrap.json"), JSON.stringify(record, null, 2));
  }
  if (installed) {
    for (const [name, version] of Object.entries(versions)) {
      mkdirSync(join(root, "node_modules", name), { recursive: true });
      writeFileSync(join(root, "node_modules", name, "package.json"), JSON.stringify({ version }));
    }
  }
  return root;
}

function setup(root, args = [], env = process.env) {
  const result = spawnSync(process.execPath, [resolve("scripts/setup.mjs"), ...args], { cwd: root, encoding: "utf8", env });
  return { ...result, output: `${result.stdout}${result.stderr}` };
}

describe("SvelteKit adapter detection and contract admission", () => {
  test("detects the official scaffold and ignores other stacks", () => {
    assert.equal(detect(scaffold()), true);
    const other = mkdtempSync(join(tmpdir(), "sveltekit-installer-"));
    roots.push(other);
    writeFileSync(join(other, "package.json"), JSON.stringify({ name: "app" }));
    assert.equal(detect(other), false);
  });

  test("refuses layouts outside the contract before any write", () => {
    let root = scaffold();
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    pkg.workspaces = ["packages/*"];
    writeFileSync(join(root, "package.json"), JSON.stringify(pkg));
    assert.throws(() => plan(root, defaults()), /workspaces|monorepo/i);

    root = scaffold();
    writeFileSync(join(root, "svelte.config.js"), "import adapter from '@sveltejs/adapter-auto';\n\nexport default { kit: { adapter: adapter() } };\n");
    assert.throws(() => plan(root, defaults()), /adapter-node/);

    root = scaffold();
    writeFileSync(join(root, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
    assert.throws(() => plan(root, defaults()), /lockfile|package manager/i);

    root = scaffold();
    rmSync(join(root, "src/routes/+page.svelte"));
    assert.throws(() => plan(root, defaults()), /\+page\.svelte/);

    root = scaffold();
    rmSync(join(root, "package.json"));
    assert.throws(() => plan(root, defaults()), /package\.json/);
  });

  test("refuses a project with screens whose design system is undecided", () => {
    assert.throws(() => plan(scaffold({ designSystem: false }), defaults()), /design_system/);
    assert.throws(() => plan(scaffold({ bootstrap: false }), defaults()), /design_system/);
  });

  test("refuses an installed toolchain outside the compatibility manifest", () => {
    const root = scaffold({ installed: true, versions: { ...HOST_DEPS, "@sveltejs/kit": "99.0.0" } });
    assert.throws(() => plan(root, defaults()), /[Uu]nsupported/);
  });

  test("refuses a bootstrap architecture without screens", () => {
    const root = scaffold();
    const record = JSON.parse(readFileSync(join(root, "pipeline.bootstrap.json"), "utf8"));
    record.architecture = { project_type: "backend", id: "feature-modules" };
    writeFileSync(join(root, "pipeline.bootstrap.json"), JSON.stringify(record));
    assert.throws(() => plan(root, defaults()), /frontend|fullstack|screens/i);
  });
});

describe("SvelteKit adapter plan", () => {
  test("plans the gate commands, the tooling files and the calibration evidence", () => {
    const planned = plan(scaffold(), defaults());
    const { commands } = planned.config;
    assert.equal(commands.check, npmRun("check"));
    assert.equal(commands.lint, npmRun("lint"));
    assert.equal(commands.build, npmRun("build"));
    assert.equal(commands.test_unit, `${npmRun("test:unit")} -- --run`);
    assert.equal(commands.test_e2e, npmRun("test:e2e"));
    assert.equal(commands.dead_code, npmRun("check:dead-code"));
    assert.equal(commands.design_limits, npmRun("check:design-limits"));
    assert.equal(commands.accessibility, npmRun("test:a11y"));
    assert.equal(commands.smoke, npmRun("test:smoke"));
    assert.equal(commands.secrets_scan, npmRun("scan:secrets"));
    assert.match(commands.sast, /agent-pipeline\/scripts\/sast\.mjs/);
    assert.match(commands.duplication, /agent-pipeline\/scripts\/duplication\.mjs/);

    for (const path of ["scripts/smoke.mjs", "eslint.design-limits.config.js", "e2e/a11y.e2e.ts", ".gitleaks.toml", "knip.json"]) {
      assert.equal(typeof planned.files[path], "string", `the plan does not place ${path}`);
    }
    assert.equal(typeof planned.files["pipeline/profiles/sveltekit/invariants.md"], "string");

    assert.deepEqual(planned.config.file_policy.implementer.allow, ["src/**", "e2e/**", "static/**", "mockups/**"]);
    assert.deepEqual(planned.config.architecture, { project_type: "fullstack", id: "feature-modules" });
    assert.deepEqual(planned.config.design_system, DESIGN_SYSTEM);
    assert.deepEqual(planned.config.project_map.extensions, [".ts", ".svelte"]);
    assert.equal(planned.config.setup.adapter, "sveltekit");
    assert.equal(planned.config.setup.report, "pipeline/setup-report.json");
    assert.deepEqual(planned.project_types, ["frontend", "fullstack"]);
    assert.equal(planned.detected.manager, "npm");
    assert.ok("packages" in planned.detected);
  });
});

describe("package.json merge", () => {
  const setupBlock = () => structuredClone(compatibilityManifest.setup);

  test("adds the gate scripts and dev dependencies without touching what the host owns", () => {
    const pkg = {
      name: "app",
      scripts: { build: "vite build", check: "svelte-kit sync && svelte-check" },
      devDependencies: { "@sveltejs/kit": "^2.70.3" },
    };
    const { applied, pkg: next } = mergePackageJson(pkg, setupBlock());
    assert.equal(next.devDependencies.knip, "^6.35.1");
    assert.equal(next.devDependencies["@axe-core/playwright"], "^4.13.0");
    assert.equal(next.scripts["check:dead-code"], "knip");
    assert.equal(next.scripts["check:design-limits"], "eslint --config eslint.design-limits.config.js .");
    assert.equal(next.scripts["test:a11y"], "playwright test e2e/a11y.e2e.ts");
    assert.equal(next.scripts["test:smoke"], "node scripts/smoke.mjs");
    assert.equal(next.scripts["scan:secrets"], "gitleaks dir . --redact");
    assert.equal(next.scripts.build, "vite build");
    assert.equal(next.devDependencies["@sveltejs/kit"], "^2.70.3");
    assert.equal(pkg.scripts["check:dead-code"], undefined, "the input manifest is mutated");
    assert.ok(applied.length >= 7);
  });

  test("refuses a script name the host already uses for something else", () => {
    const pkg = { scripts: { "check:dead-code": "node my-own-dead-code.mjs" } };
    assert.throws(() => mergePackageJson(pkg, setupBlock()), /check:dead-code/);
    assert.throws(() => mergePackageJson(pkg, setupBlock()), /will not override/i);
  });

  test("keeps and reports a setup dependency the host already declares", () => {
    const pkg = { devDependencies: { knip: "^6.30.0" } };
    const { kept, pkg: next } = mergePackageJson(pkg, setupBlock());
    assert.equal(next.devDependencies.knip, "^6.30.0", "the host's own range is replaced");
    assert.ok(kept.some((entry) => entry.includes("knip")));
  });

  test("a second merge over the merged manifest changes nothing", () => {
    const first = mergePackageJson({ scripts: { build: "vite build" } }, setupBlock());
    const second = mergePackageJson(first.pkg, setupBlock());
    assert.deepEqual(second.applied, []);
    assert.deepEqual(second.pkg, first.pkg);
  });
});

describe("formatter and linter ignore entries", () => {
  test("inserts pipeline ignores into the scaffold eslint config exactly once", () => {
    const first = editEslintConfig(ESLINT_SCAFFOLD);
    assert.equal(first.changed, true);
    assert.match(first.content, /'agent-pipeline\/\*\*'/);
    assert.match(first.content, /'pipeline\/\*\*'/);
    assert.ok(first.content.indexOf("includeIgnoreFile(gitignorePath),") < first.content.indexOf("agent-pipeline/**"));
    const second = editEslintConfig(first.content);
    assert.equal(second.changed, false);
    assert.equal(second.content, first.content);
  });

  test("refuses an eslint config whose shape it does not recognize", () => {
    assert.throws(() => editEslintConfig("export default {};\n"), /scaffold|recognize|anchor/i);
  });

  test("adds the e2e test match to the scaffold playwright config exactly once", () => {
    const first = editPlaywrightConfig(PLAYWRIGHT_SCAFFOLD);
    assert.equal(first.changed, true);
    assert.match(first.content, /testMatch/);
    assert.match(first.content, /testDir: 'e2e'/);
    assert.match(first.content, /\{e2e,test,spec\}/, "the scaffold's own demo test must keep matching alongside *.e2e.ts");
    const second = editPlaywrightConfig(first.content);
    assert.equal(second.changed, false);
    assert.throws(() => editPlaywrightConfig("export default {};\n"), /scaffold|recognize|testDir/i);
  });

  test("extends the prettier ignore list only with the missing entries", () => {
    const entries = ["agent-pipeline", "pipeline", "build", "AGENTS.md", "docs/project-map.md"];
    const first = editPrettierIgnore("# Package Managers\npackage-lock.json\npipeline\n", entries);
    assert.deepEqual(first.added, ["agent-pipeline", "build", "AGENTS.md", "docs/project-map.md"]);
    assert.equal(first.content.split("\n").filter((line) => line === "pipeline").length, 1, "an existing entry is duplicated");
    const second = editPrettierIgnore(first.content, entries);
    assert.deepEqual(second.added, []);
    assert.equal(second.content, first.content);
  });
});

describe("registry audit of setup dependencies", () => {
  const dependencies = [
    { name: "knip", range: "^6.35.1" },
    { name: "@axe-core/playwright", range: "^4.13.0" },
  ];

  test("records the resolved versions of clean dependencies", () => {
    const view = (name) => (name === "knip"
      ? [{ version: "6.30.0" }, { version: "6.35.1", engines: { node: ">=18.0.0" } }]
      : { version: "4.13.0" });
    const resolved = registryAudit(dependencies, view);
    assert.deepEqual(resolved.map((entry) => [entry.name, entry.version]), [["knip", "6.35.1"], ["@axe-core/playwright", "4.13.0"]]);
  });

  test("refuses a deprecated setup dependency", () => {
    const view = () => ({ version: "6.35.1", deprecated: "this version is broken" });
    assert.throws(() => registryAudit(dependencies, view), /deprecated/i);
  });

  test("refuses a setup dependency whose engines exclude the running Node", () => {
    const view = () => ({ version: "6.35.1", engines: { node: ">=99.0.0" } });
    assert.throws(() => registryAudit(dependencies, view), /engines|Node/i);
  });

  test("checks nothing when the host already declares every setup dependency", () => {
    const view = () => { throw new Error("registry must not be queried"); };
    assert.deepEqual(registryAudit([], view), []);
  });
});

describe("the engines range grammar", () => {
  test("admits the running Node only when the range really covers it", () => {
    assert.equal(nodeSatisfies("22.23.2", ">=18.0.0"), true);
    assert.equal(nodeSatisfies("22.23.2", ">=24.0.0"), false);
    assert.equal(nodeSatisfies("22.23.2", "^22.0.0"), true);
    assert.equal(nodeSatisfies("22.23.2", "^24.0.0"), false);
    assert.equal(nodeSatisfies("22.23.2", ">=18.0.0 <23.0.0"), true);
    assert.equal(nodeSatisfies("22.23.2", "^20.0.0 || ^22.0.0"), true);
    assert.equal(nodeSatisfies("22.23.2", "*"), true);
    assert.throws(() => nodeSatisfies("22.23.2", "lts/*"), /comparator|engines/i);
  });
});

describe("prerequisites", () => {
  function plannedFor(root, overrides = {}) {
    return {
      manager: "npm",
      required: Object.keys(HOST_DEPS),
      compatibilityManifest,
      compatibility: { installed: { node: "22.23.2", manager: "npm", packages: HOST_DEPS } },
      missing_dev_dependencies: structuredClone(compatibilityManifest.setup.dev_dependencies),
      ...overrides,
    };
  }
  const cleanView = (name) => (name === "knip" ? { version: "6.35.1", engines: { node: ">=18.0.0" } } : { version: "4.13.0" });
  const cleanExec = (command) => {
    if (command === "npm") return "11.19.1\n";
    if (command === "gitleaks") return "8.30.1\n";
    throw new Error(`unexpected executable: ${command}`);
  };

  test("passes with a compatible toolchain and records the registry resolution", () => {
    const root = scaffold({ installed: true });
    const compatibility = prerequisites(root, plannedFor(root), { exec: cleanExec, view: cleanView });
    assert.equal(compatibility.status, "compatible");
    assert.deepEqual(compatibility.registry.map((entry) => entry.name), ["knip", "@axe-core/playwright"]);
  });

  test("refuses a missing secrets scanner before any write", () => {
    const root = scaffold({ installed: true });
    const exec = (command) => {
      if (command === "gitleaks") throw new Error("ENOENT");
      return "11.19.1\n";
    };
    assert.throws(() => prerequisites(root, plannedFor(root), { exec, view: cleanView }), /gitleaks/);
  });

  test("refuses a host dependency that is not installed", () => {
    const root = scaffold({ installed: false });
    assert.throws(() => prerequisites(root, plannedFor(root), { exec: cleanExec, view: cleanView }), /not installed|Install the host dependencies/);
  });

  test("refuses a toolchain outside the manifest even with clean registries", () => {
    const root = scaffold({ installed: true });
    const planned = plannedFor(root);
    planned.compatibility.installed = { node: "24.20.0", manager: "npm", packages: HOST_DEPS };
    assert.throws(() => prerequisites(root, planned, { exec: cleanExec, view: cleanView }), /[Uu]nsupported|[Uu]nverified/);
  });
});

describe("setup.mjs wiring", () => {
  test("selects the SvelteKit adapter and previews the full plan without writing", () => {
    const root = scaffold();
    const original = readFileSync(join(root, "package.json"), "utf8");
    const result = setup(root, ["--dry-run"]);
    assert.equal(result.status, 0, result.output);
    const preview = JSON.parse(result.stdout);
    assert.equal(preview.adapter, "sveltekit");
    for (const path of ["scripts/smoke.mjs", "eslint.design-limits.config.js", "e2e/a11y.e2e.ts", ".gitleaks.toml", "knip.json"]) {
      assert.ok(preview.files.includes(path), `the preview does not place ${path}`);
    }
    assert.equal(preview.config.commands.dead_code, npmRun("check:dead-code"));
    assert.equal(readFileSync(join(root, "package.json"), "utf8"), original);
    assert.equal(existsSync(join(root, "pipeline.config.json")), false);
  });

  test("the dry run refuses an undecided design system before touching anything", () => {
    const root = scaffold({ designSystem: false });
    const result = setup(root, ["--dry-run"]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /design_system/);
    assert.equal(existsSync(join(root, "pipeline.config.json")), false);
  });

  test("the dry run refuses a tooling file the host already owns instead of overwriting it", () => {
    const root = scaffold();
    writeFileSync(join(root, "knip.json"), "// tuned here\n");
    const result = setup(root, ["--dry-run"]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /knip\.json/);
    assert.equal(readFileSync(join(root, "knip.json"), "utf8"), "// tuned here\n");
  });
});

function fakeBinaries(root, { refusing = false } = {}) {
  const npm = [
    "#!/bin/sh",
    'if [ "$1" = "--version" ]; then echo 11.19.1; exit 0; fi',
    'if [ "$1" = "view" ]; then echo \'{"version":"6.35.1","engines":{"node":">=18.0.0"}}\'; exit 0; fi',
    'if [ "$1" = "install" ] || [ "$1" = "audit" ]; then exit 0; fi',
    ...(refusing
      ? ['if [ "$1" = "run" ]; then echo "fixture gate refusal" >&2; exit 1; fi']
      : [
        'if [ "$1" = "run" ]; then',
        "  if [ -e src/lib/pipeline-install-probe.ts ]; then exit 1; fi",
        "  if [ -e src/routes/pipeline-install-probe ]; then exit 1; fi",
        "  if [ -e pipeline-install-probe.txt ]; then exit 1; fi",
        "  if grep -q pipeline-install-probe package.json; then exit 1; fi",
        '  if [ "$2" = "test:smoke" ] && [ ! -e src/routes/+page.svelte ]; then exit 1; fi',
        '  if [ "$2" = "test:a11y" ] && grep -q "<img" src/routes/+page.svelte; then exit 1; fi',
        "  exit 0",
        "fi",
      ]),
    "exit 0",
    "",
  ].join("\n");
  const sudocode = [
    "#!/bin/sh",
    'if [ "$1" = "--version" ]; then echo 0.2.0; exit 0; fi',
    'if [ "$1" = "init" ]; then mkdir -p .sudocode && touch .sudocode/issues.jsonl .sudocode/specs.jsonl; exit 0; fi',
    "exit 0",
    "",
  ].join("\n");
  const gitleaks = "#!/bin/sh\necho 8.30.1\n";
  mkdirSync(join(root, "fixture-bin"));
  for (const [name, body] of Object.entries({ npm, sudocode, gitleaks })) {
    writeFileSync(join(root, "fixture-bin", name), body);
    chmodSync(join(root, "fixture-bin", name), 0o755);
  }
}

function installedHost(options = {}) {
  const root = scaffold({ installed: true, ...options });
  symlinkSync(resolve("."), join(root, "agent-pipeline"), "dir");
  fakeBinaries(root, options);
  assert.equal(spawnSync("git", ["init", "-q"], { cwd: root }).status, 0);
  return root;
}
const hostEnv = (root) => ({ ...process.env, PATH: `${join(root, "fixture-bin")}:${process.env.PATH}` });

describe("a complete installation through setup.mjs", () => {
  test("writes a failed report with step durations when a gate refuses", { skip: !supportedRuntime }, () => {
    const root = installedHost({ refusing: true });
    const result = setup(root, [], hostEnv(root));
    assert.notEqual(result.status, 0);
    assert.match(result.output, /fixture gate refusal/);
    const report = JSON.parse(readFileSync(join(root, "pipeline/setup-report.json"), "utf8"));
    assert.equal(report.adapter, "sveltekit");
    assert.equal(report.status, "failed");
    assert.ok(report.steps.length >= 1);
    const refused = report.steps.find((step) => step.name === "check");
    assert.ok(refused, JSON.stringify(report.steps.map((step) => step.name)));
    assert.ok(Number.isInteger(refused.duration_ms));
    assert.notEqual(refused.code, 0);
    assert.match(report.error, /check/);
    // The gates refused after the host edits: the merge and the tooling placement are visible on disk.
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    assert.equal(pkg.scripts["check:dead-code"], "knip");
    assert.ok(existsSync(join(root, "scripts/smoke.mjs")));
  });

  test("installs, proves every new gate on purpose and reports the proofs", { skip: !supportedRuntime }, () => {
    const root = installedHost();
    const result = setup(root, [], hostEnv(root));
    assert.equal(result.status, 0, result.output);

    const report = JSON.parse(readFileSync(join(root, "pipeline/setup-report.json"), "utf8"));
    assert.equal(report.status, "ready");
    assert.equal(report.adapter, "sveltekit");
    const proofs = report.proofs ?? [];
    const refused = (gate, defect) => proofs.some((proof) => proof.gate === gate && proof.name.includes(defect) && proof.refused === true);
    assert.ok(refused("dead_code", "unused file"), JSON.stringify(proofs));
    assert.ok(refused("dead_code", "unused export"), JSON.stringify(proofs));
    assert.ok(refused("dead_code", "unused dependency"), JSON.stringify(proofs));
    assert.ok(refused("design_limits", "parameter"), JSON.stringify(proofs));
    assert.ok(refused("smoke", "root route"), JSON.stringify(proofs));
    assert.ok(refused("accessibility", "alt"), JSON.stringify(proofs));
    assert.ok(refused("secrets_scan", "token"), JSON.stringify(proofs));
    for (const proof of proofs) assert.ok(Number.isInteger(proof.duration_ms));

    // Probes are isolated: no probe file survives the installation.
    assert.equal(existsSync(join(root, "src/lib/pipeline-install-probe.ts")), false);
    assert.equal(existsSync(join(root, "src/routes/pipeline-install-probe")), false);
    assert.equal(existsSync(join(root, "pipeline-install-probe.txt")), false);
    assert.equal(readFileSync(join(root, "src/routes/+page.svelte"), "utf8"), "<h1>Home</h1>\n");

    const config = JSON.parse(readFileSync(join(root, "pipeline.config.json"), "utf8"));
    assert.equal(config.profile, "sveltekit");
    assert.equal(config.commands.dead_code, npmRun("check:dead-code"));
    assert.deepEqual(config.design_system, DESIGN_SYSTEM);

    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    assert.equal(pkg.devDependencies.knip, "^6.35.1");
    assert.equal(pkg.scripts.build, "vite build");
    assert.match(readFileSync(join(root, "eslint.config.js"), "utf8"), /agent-pipeline\/\*\*/);
    assert.match(readFileSync(join(root, "playwright.config.ts"), "utf8"), /testMatch/);
    const prettierIgnore = readFileSync(join(root, ".prettierignore"), "utf8");
    assert.match(prettierIgnore, /^AGENTS\.md$/m);
    assert.match(prettierIgnore, /^pipeline$/m);

    const profile = JSON.parse(readFileSync(join(root, "pipeline/profiles/sveltekit/profile.json"), "utf8"));
    assert.equal(profile.calibration_required, false);
    assert.equal(profile.detected.manager, "npm");

    // A rerun is idempotent and reports the files it kept rather than rewriting them.
    const rerun = setup(root, [], hostEnv(root));
    assert.equal(rerun.status, 0, rerun.output);
    const second = JSON.parse(readFileSync(join(root, "pipeline/setup-report.json"), "utf8"));
    assert.equal(second.status, "ready");
    assert.ok(second.kept_files.includes("knip.json"), JSON.stringify(second.kept_files));
    assert.ok(second.kept_files.includes("scripts/smoke.mjs"), JSON.stringify(second.kept_files));
  });
});
