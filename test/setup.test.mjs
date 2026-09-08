import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { plan as adapterPlan } from "../profile-bundles/nest/installer.mjs";
import { inRange } from "../scripts/adapter-compatibility.mjs";

const roots = [];
const compatibilityManifest = JSON.parse(readFileSync(new URL("../profile-bundles/nest/compatibility.json", import.meta.url), "utf8"));
const supportedRuntime = compatibilityManifest.supported.some((entry) => inRange(process.versions.node, entry.node));
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
function project() {
  const root = mkdtempSync(join(tmpdir(), "pipeline-setup-"));
  roots.push(root);
  symlinkSync(resolve("."), join(root, "agent-pipeline"), "dir");
  mkdirSync(join(root, "src"));
  mkdirSync(join(root, "test"));
  writeFileSync(join(root, "src/main.ts"), "export const bootstrap = () => {};\n");
  writeFileSync(join(root, "nest-cli.json"), JSON.stringify({ sourceRoot: "src" }));
  writeFileSync(join(root, "tsconfig.json"), "{}");
  writeFileSync(join(root, "eslint.config.mjs"), "export default [];\n");
  writeFileSync(join(root, "package-lock.json"), "{}");
  writeFileSync(join(root, "package.json"), JSON.stringify({
    name: "app", dependencies: { "@nestjs/core": "^11.0.0", "@nestjs/common": "^11.0.0" },
    devDependencies: { typescript: "^5.0.0", eslint: "^9.0.0", jest: "^29.0.0", "@nestjs/cli": "^11.0.0" },
    scripts: { build: "nest build", lint: 'eslint "{src,test}/**/*.ts" --fix', test: "jest", "test:e2e": "jest --config ./test/jest-e2e.json" },
  }));
  return root;
}
function setup(root, args = [], env = process.env) {
  const result = spawnSync(process.execPath, [resolve("scripts/setup.mjs"), ...args], { cwd: root, encoding: "utf8", env });
  return { ...result, output: `${result.stdout}${result.stderr}` };
}

test("setup detects Nest and previews a complete plan without changing the host", () => {
  const root = project();
  const original = readFileSync(join(root, "package.json"), "utf8");
  const result = setup(root, ["--dry-run", "--runtime", "claude-code"]);
  assert.equal(result.status, 0, result.output);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.adapter, "nest");
  assert.equal(plan.config.agent_runtime.prompt_adapter, "claude-code");
  assert.equal(plan.config.prompts_dir, ".claude/agents");
  assert.equal(plan.config.setup.package_manager, "npm");
  for (const key of ["check", "lint", "build", "test_unit", "test_e2e", "smoke", "design_limits", "secrets_scan", "audit", "duplication", "project_map"]) {
    assert.equal(typeof plan.config.commands[key], "string", key);
  }
  assert.ok(plan.files.includes("AGENTS.md"));
  assert.equal(readFileSync(join(root, "package.json"), "utf8"), original);
  assert.equal(existsSync(join(root, "pipeline.config.json")), false);
});

test("setup retains explicit bootstrap architecture decisions", () => {
  const root = project();
  const architecture = { id: "custom", project_type: "backend", note: "Existing module boundaries" };
  writeFileSync(join(root, "pipeline.bootstrap.json"), JSON.stringify({ architecture, format: 1 }));
  writeFileSync(join(root, "pipeline.config.json"), JSON.stringify({ architecture, bootstrap: "pipeline.bootstrap.json" }));
  const result = setup(root, ["--dry-run"]);
  assert.equal(result.status, 0, result.output);
  assert.deepEqual(JSON.parse(result.stdout).config.architecture, architecture);
});

test("setup refuses unsupported layouts and missing tools before writing configuration", () => {
  const root = project();
  let result = setup(root);
  assert.notEqual(result.status, 0);
  assert.equal(existsSync(join(root, "pipeline.config.json")), false);
  writeFileSync(join(root, "nest-cli.json"), JSON.stringify({ monorepo: true }));
  result = setup(root, ["--dry-run"]);
  assert.notEqual(result.status, 0);
  assert.match(result.output, /monorepo/);
});

test("setup refuses an existing configured pipeline instead of replacing its policy", () => {
  const root = project();
  const original = '{"profile":"mine","commands":{"check":"custom"}}';
  writeFileSync(join(root, "pipeline.config.json"), original);
  const result = setup(root, ["--dry-run"]);
  assert.notEqual(result.status, 0);
  assert.equal(readFileSync(join(root, "pipeline.config.json"), "utf8"), original);
});

test("setup rejects unknown options and ambiguous package managers", () => {
  const root = project();
  assert.notEqual(setup(root, ["--unknown"]).status, 0);
  writeFileSync(join(root, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
  const result = setup(root, ["--dry-run"]);
  assert.notEqual(result.status, 0);
  assert.match(result.output, /package manager|lockfile/);
});

test("setup keeps pre-existing agent instructions and refuses redirected output paths", () => {
  const root = project();
  writeFileSync(join(root, "AGENTS.md"), "Existing policy\n");
  let result = setup(root, ["--dry-run"]);
  assert.notEqual(result.status, 0);
  assert.match(result.output, /already exists/);
  assert.equal(readFileSync(join(root, "AGENTS.md"), "utf8"), "Existing policy\n");
  rmSync(join(root, "AGENTS.md"));
  symlinkSync(tmpdir(), join(root, "pipeline"), "dir");
  result = setup(root, ["--dry-run"]);
  assert.notEqual(result.status, 0);
  assert.match(result.output, /symlink/);
});

test("setup rejects a changed bootstrap decision and custom runner flags", () => {
  const root = project();
  writeFileSync(join(root, "pipeline.bootstrap.json"), JSON.stringify({ format: 1, architecture: { id: "custom" } }));
  writeFileSync(join(root, "pipeline.config.json"), JSON.stringify({ bootstrap: "pipeline.bootstrap.json", architecture: { id: "feature-modules" } }));
  assert.match(setup(root, ["--dry-run"]).output, /differs from the recorded decision/);
  rmSync(join(root, "pipeline.config.json"));
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  pkg.scripts.test = "jest --config custom.json";
  writeFileSync(join(root, "package.json"), JSON.stringify(pkg));
  const result = setup(root, ["--dry-run"]);
  assert.notEqual(result.status, 0);
  assert.match(result.output, /Custom unit-test flags/);
});

test("repeated setup refuses modified generated policy before overwriting any file", () => {
  const root = project();
  const preview = setup(root, ["--dry-run"]);
  assert.equal(preview.status, 0, preview.output);
  const { config } = JSON.parse(preview.stdout);
  writeFileSync(join(root, "pipeline.config.json"), JSON.stringify(config));
  const profile = join(root, config.profiles_dir, config.profile);
  for (const dir of [profile, ...[config.prompts_dir, config.skills_dir, config.briefs_dir].map((path) => join(root, path))]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(root, config.rules_path), "{}");
  writeFileSync(join(root, "AGENTS.md"), "customized");
  const hash = (text) => createHash("sha256").update(text).digest("hex");
  writeFileSync(join(profile, "setup-targets.json"), JSON.stringify({ "AGENTS.md": hash("original"), [config.rules_path]: hash("{}") }));
  const result = setup(root, ["--dry-run"]);
  assert.notEqual(result.status, 0);
  assert.match(result.output, /Generated policy changed/);
  assert.equal(readFileSync(join(root, "AGENTS.md"), "utf8"), "customized");
});

test("setup refuses installed versions outside the contract before creating files", () => {
  const root = project();
  mkdirSync(join(root, "node_modules/@nestjs/core"), { recursive: true });
  writeFileSync(join(root, "node_modules/@nestjs/core/package.json"), '{"version":"99.0.0"}');
  const result = setup(root);
  assert.notEqual(result.status, 0);
  assert.match(result.output, /Unsupported Nest toolchain/);
  assert.equal(existsSync(join(root, "pipeline.config.json")), false);
});

function installedFixture() {
  const root = project();
  const config = JSON.parse(setup(root, ["--dry-run"]).stdout).config;
  const planned = adapterPlan(root, JSON.parse(readFileSync(resolve("templates/pipeline.config.template.json"), "utf8")));
  const baseConfig = structuredClone(config);
  baseConfig.setup.adapter_version = "0.9.0";
  baseConfig.setup.fingerprint = "previous-version";
  const files = structuredClone(planned.files);
  const toolPath = `${config.profiles_dir}/${config.profile}/tools/design.mjs`;
  files[toolPath] = "// previous adapter tool\n";
  function put(path, value) {
    const full = join(root, path);
    mkdirSync(resolve(full, ".."), { recursive: true });
    writeFileSync(full, typeof value === "string" ? value : JSON.stringify(value));
  }
  for (const [path, body] of Object.entries(files)) put(path, body);
  const profile = `${config.profiles_dir}/${config.profile}`;
  put(`${profile}/setup-baseline.json`, { format: 1, config: baseConfig, files });
  put(`${profile}/profile.json`, { setup_adapter: "nest", fingerprint: "previous-version", calibration_required: false });
  for (const path of [config.prompts_dir, config.skills_dir, config.briefs_dir]) mkdirSync(join(root, path), { recursive: true });
  put("AGENTS.md", "previous generated policy");
  put(config.rules_path, "{}");
  put(config.project_map.out, "previous generated map");
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  put(`${profile}/setup-targets.json`, { "AGENTS.md": hash("previous generated policy"), [config.rules_path]: hash("{}") });
  put("pipeline.config.json", baseConfig);
  return { root, config: baseConfig, files, toolPath, put };
}

test("update defaults to a read-only diff and retains independent local changes", () => {
  const { root, config, toolPath, put } = installedFixture();
  config.smoke.path = "/health";
  put("pipeline.config.json", config);
  const result = setup(root, ["--update"]);
  assert.equal(result.status, 0, result.output);
  const preview = JSON.parse(result.stdout);
  assert.equal(preview.config.smoke.path, "/health");
  assert.equal(preview.update.from, "0.9.0");
  assert.equal(preview.update.to, "1.2.0");
  assert.ok(preview.update.changes.some((item) => item.path === toolPath));
  assert.equal(readFileSync(join(root, toolPath), "utf8"), "// previous adapter tool\n");
  assert.equal(JSON.parse(readFileSync(join(root, "pipeline.config.json"), "utf8")).setup.adapter_version, "0.9.0");
});

test("update refuses conflicting tool edits and legacy installations without a baseline", () => {
  const { root, toolPath, put } = installedFixture();
  put(toolPath, "// locally changed tool\n");
  const result = setup(root, ["--update", "--apply"]);
  assert.notEqual(result.status, 0);
  assert.match(result.output, /Update conflicts/);
  assert.equal(readFileSync(join(root, toolPath), "utf8"), "// locally changed tool\n");
  rmSync(join(root, "pipeline/profiles/nest/setup-baseline.json"));
  assert.match(setup(root, ["--update"]).output, /No versioned setup baseline/);
  assert.notEqual(setup(root, ["--apply"]).status, 0);
});

test("a failed update restores managed files and retains the previous adapter baseline", { skip: !supportedRuntime }, () => {
  const { root, config, toolPath, put } = installedFixture();
  config.commands.check = 'node -e "console.error(\'fixture gate refusal\'); process.exit(1)"';
  put("pipeline.config.json", config);
  const original = readFileSync(join(root, "pipeline.config.json"), "utf8");
  const versions = { "@nestjs/core": "11.2.3", "@nestjs/common": "11.2.3", "@nestjs/cli": "11.0.24", typescript: "5.9.3", jest: "30.5.1", eslint: "9.39.5" };
  for (const [name, version] of Object.entries(versions)) put(`node_modules/${name}/package.json`, { version });
  put(".sudocode/issues.jsonl", "");
  put(".sudocode/specs.jsonl", "");
  put("fixture-bin/sudocode", "#!/bin/sh\nexit 0\n");
  chmodSync(join(root, "fixture-bin/sudocode"), 0o755);
  assert.equal(spawnSync("git", ["init", "-q"], { cwd: root }).status, 0);
  const result = setup(root, ["--update", "--apply"], { ...process.env, PATH: `${join(root, "fixture-bin")}:${process.env.PATH}` });
  assert.notEqual(result.status, 0);
  assert.match(result.output, /fixture gate refusal/);
  assert.equal(readFileSync(join(root, "pipeline.config.json"), "utf8"), original);
  assert.equal(readFileSync(join(root, toolPath), "utf8"), "// previous adapter tool\n");
  assert.equal(readFileSync(join(root, config.project_map.out), "utf8"), "previous generated map");
  assert.equal(JSON.parse(readFileSync(join(root, config.setup.report), "utf8")).rolled_back, true);
});
