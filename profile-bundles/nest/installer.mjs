import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { assessCompatibility } from "../../scripts/adapter-compatibility.mjs";

const json = (path) => JSON.parse(readFileSync(path, "utf8"));

export function detect(root) {
  return existsSync(join(root, "nest-cli.json")) && existsSync(join(root, "package.json")) && Boolean(json(join(root, "package.json")).dependencies?.["@nestjs/core"]);
}

/**
 * Repairs what the audit gate would refuse in the official scaffold.
 *
 * The manifest declares each remediation with its advisories and its reason,
 * so the list shrinks when upstream publishes a fix instead of living as
 * adapter logic nobody revisits. Returns null when the host already carries
 * the repair: setup rewrites a manifest it did not need to touch.
 *
 * @param root - the host repository
 * @param pkg - its parsed package.json
 * @param manifest - the adapter compatibility manifest
 * @param manager - the package manager the host uses
 * @returns the applied remediations, the rewritten manifest and the install
 *   that makes an override reach the lockfile, or null when nothing applies
 */
export function remediate(root, pkg, manifest, manager) {
  const next = structuredClone(pkg);
  const applied = [];
  for (const entry of manifest.remediations ?? []) {
    if (entry.kind === "override") {
      if (next.overrides?.[entry.package] === entry.version) continue;
      next.overrides = { ...next.overrides, [entry.package]: entry.version };
      applied.push({ id: entry.id, change: `overrides.${entry.package} = ${entry.version}`, advisories: entry.advisories });
    } else if (entry.kind === "remove_dev_dependency") {
      if (!next.devDependencies?.[entry.package]) continue;
      const { [entry.package]: _removed, ...rest } = next.devDependencies;
      next.devDependencies = rest;
      const scripts = (entry.scripts ?? []).filter((name) => next.scripts?.[name]);
      for (const name of scripts) delete next.scripts[name];
      applied.push({ id: entry.id, change: `removed devDependency ${entry.package}${scripts.length ? ` and script ${scripts.join(", ")}` : ""}`, advisories: entry.advisories });
    } else throw new Error(`Unknown remediation kind: ${entry.kind}`);
  }
  if (applied.length === 0) return null;
  return { applied, package_json: `${JSON.stringify(next, null, 2)}\n`, install: { command: manager, args: ["install"] } };
}

/** Inspects the existing toolchain; only the declared audit remediations touch the host manifest. */
export function plan(root, defaults) {
  const pkg = json(join(root, "package.json"));
  const nest = json(join(root, "nest-cli.json"));
  if (nest.monorepo || nest.projects || pkg.workspaces) throw new Error("Nest monorepo/workspaces need a dedicated adapter; no files were written.");
  if ((nest.sourceRoot ?? "src") !== "src") throw new Error("This Nest preset requires sourceRoot src.");
  for (const path of ["tsconfig.json", "src/main.ts", "test"]) {
    if (!existsSync(join(root, path))) throw new Error(`Nest preset needs ${path}.`);
  }
  const dependencies = { ...pkg.dependencies, ...pkg.devDependencies };
  const testRunner = /^jest(?:\s|$)/.test(pkg.scripts?.test ?? "") ? "jest"
    : /^vitest(?:\s|$)/.test(pkg.scripts?.test ?? "") ? "vitest" : null;
  const linter = /^eslint(?:\s|$)/.test(pkg.scripts?.lint ?? "") ? "eslint"
    : /^oxlint(?:\s|$)/.test(pkg.scripts?.lint ?? "") ? "oxlint" : null;
  if (!testRunner || !linter) throw new Error("Nest preset supports existing Jest/Vitest and ESLint/Oxlint scripts; custom runners need an adapter.");
  if (!["jest", "vitest run"].includes(pkg.scripts.test)) throw new Error("Custom unit-test flags need an adapter so their configuration is preserved.");
  if (/--config|&&|\|\||;/.test(pkg.scripts.lint)) throw new Error("Custom lint configuration or chained commands need an adapter.");
  if (pkg.scripts?.build !== "nest build" || !pkg.scripts?.["test:e2e"]) throw new Error("Nest preset needs the standard build and test:e2e scripts.");
  const locks = [["package-lock.json", "npm"], ["pnpm-lock.yaml", "pnpm"], ["yarn.lock", "yarn"]]
    .filter(([file]) => existsSync(join(root, file))).map(([, name]) => name);
  const declared = pkg.packageManager?.split("@")[0];
  if (locks.length !== 1 || (declared && declared !== locks[0])) throw new Error("Choose one consistent package manager and lockfile before setup.");
  const manager = locks[0];
  if (manager === "yarn" && pkg.packageManager && !pkg.packageManager.startsWith("yarn@1.")) throw new Error("This preset supports Yarn Classic with node_modules; modern Yarn needs a dedicated audit adapter.");
  const required = ["@nestjs/core", "@nestjs/common", "@nestjs/cli", "typescript", linter, testRunner];
  for (const name of required) if (!dependencies[name]) throw new Error(`Nest preset needs an existing ${name} dependency.`);
  const compatibilityManifest = json(new URL("./compatibility.json", import.meta.url));
  const installed = { node: process.versions.node, manager, required, packages: {} };
  for (const name of required) {
    const path = join(root, "node_modules", name, "package.json");
    if (existsSync(path)) installed.packages[name] = json(path).version;
  }
  const compatibility = assessCompatibility(compatibilityManifest, installed);
  const stackCompatible = compatibility.cases.some((entry) => entry.mismatches.every((message) => message.startsWith("node ")));
  if (compatibility.status === "unsupported" && !stackCompatible) throw new Error(`Unsupported Nest toolchain for adapter ${compatibilityManifest.adapter_version}: ${compatibility.cases.flatMap((entry) => entry.mismatches).join("; ")}. See profile-bundles/nest/compatibility.json.`);
  const profile = "nest";
  const profileDir = `${defaults.profiles_dir}/${profile}`;
  const tool = `node ${profileDir}/tools/gate.mjs`;
  const commands = Object.fromEntries(["check", "lint", "build", "test_unit", "test_e2e", "smoke", "design_limits", "secrets_scan", "audit"].map((key) => [key, `${tool} ${key}`]));
  for (const key of ["sast", "duplication", "project_map", "map_coverage", "tracker_sync"]) commands[key] = defaults.commands[key];
  const policy = json(new URL("./file-policy.json", import.meta.url));
  const config = {
    ...defaults, profile, commands, file_policy: policy,
    agent_runtime: { ...defaults.agent_runtime, workspace_paths: ["node_modules"], dependency_inputs: ["package.json", manager === "npm" ? "package-lock.json" : manager === "pnpm" ? "pnpm-lock.yaml" : "yarn.lock"] },
    decisions_dir: "docs/decisions", default_mode: "pipeline",
    architecture: { id: "custom", project_type: "backend", note: "Preserve the existing Nest module layout. This installation does not redesign application boundaries; future architecture changes require a recorded decision." },
    setup: { adapter: "nest", adapter_version: compatibilityManifest.adapter_version, format: 1, package_manager: manager, test_runner: testRunner, linter, report: "pipeline/setup-report.json" },
    project_map: { ...defaults.project_map, roots: ["src", "test"], extensions: [".ts"], skip: "(?:^|/)(?:dist|node_modules)/" },
    duplication: { roots: ["src", "test"], min_lines: 6 },
    test_suites: { unit: { gate: "test_unit", replay: "per_issue" }, e2e: { gate: "test_e2e", replay: "closure" } },
    closure_gates: ["audit", "test_e2e"],
    design_limits: { complexity: 12, function_lines: 80, parameters: 5, nesting: 4 },
    smoke: { path: "/", status: 200, timeout_ms: 15000 },
    human_review_paths: ["pipeline.config.json", "pipeline/**", "agent-pipeline/**", "package.json", "*lock*", ".github/**", "src/**/auth/**", "src/**/migrations/**"],
  };
  const files = {};
  for (const name of readdirSync(new URL("./tools/", import.meta.url))) {
    files[`${profileDir}/tools/${name}`] = readFileSync(new URL(`./tools/${name}`, import.meta.url), "utf8");
  }
  files[`${profileDir}/invariants.md`] = readFileSync(new URL("./invariants.md", import.meta.url), "utf8");
  files[`${profileDir}/pitfalls.md`] = "# Project pitfalls\n\nNo project-specific findings recorded during installation.\n";
  files[config.project_context] = `# Project context\n\n<!-- agent:summary -->\nExisting Nest project. Product scope is defined separately through Product.\n<!-- /agent -->\n\n<!-- agent:commands -->\nRead the command table in the compiled role brief. Installed package manager: ${manager}.\n<!-- /agent -->\n\n<!-- agent:context -->\nThe setup preset preserves the existing application. Design bounds are fixed preset policy, never automatically relaxed. The map and static security scan are heuristic. No dead-code, mutation, coverage threshold or documentation enforcement is claimed. Secrets scanning detects common token formats and private keys, not all secrets. CI is not configured. Filesystem policies detect scope violations unless the harness enforces them.\n<!-- /agent -->\n`;
  const remediation = remediate(root, pkg, compatibilityManifest, manager);
  return { config, files, required, manager, compatibilityManifest, compatibility, remediation, ignored: ["node_modules/", "dist/", "coverage/"] };
}

export function prerequisites(root, planned) {
  let managerVersion;
  try { managerVersion = execFileSync(planned.manager, ["--version"], { cwd: root, encoding: "utf8" }).trim(); }
  catch { throw new Error(`Package manager ${planned.manager} is unavailable.`); }
  if (planned.manager === "yarn" && !managerVersion.startsWith("1.")) throw new Error("This preset supports Yarn Classic only.");
  for (const name of planned.required) {
    try { json(join(root, "node_modules", name, "package.json")); }
    catch { throw new Error(`Dependency ${name} is not installed. Install the host dependencies with ${planned.manager}, then rerun setup.`); }
  }
  const compatibility = assessCompatibility(planned.compatibilityManifest, { ...planned.compatibility.installed, manager_version: managerVersion });
  if (compatibility.status !== "compatible") throw new Error(`Unsupported or unverified Nest toolchain: ${compatibility.cases.flatMap((entry) => [...entry.mismatches, ...entry.missing]).join("; ")}`);
  return compatibility;
}
