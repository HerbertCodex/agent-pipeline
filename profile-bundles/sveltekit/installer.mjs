import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { assessCompatibility } from "../../scripts/adapter-compatibility.mjs";
import { runStep } from "../../scripts/setup-runner.mjs";

const json = (path) => JSON.parse(readFileSync(path, "utf8"));

const TOOLING_FILES = {
  "scripts/smoke.mjs": "scripts/smoke.mjs",
  "eslint.design-limits.config.js": "eslint.design-limits.config.js",
  "e2e/a11y.e2e.ts": "e2e/a11y.e2e.ts",
  ".gitleaks.toml": ".gitleaks.toml",
  "knip.json": "knip.json",
};

const PROBE = "pipeline-install-probe";

export function detect(root) {
  if (!existsSync(join(root, "package.json")) || !existsSync(join(root, "svelte.config.js"))) return false;
  const pkg = json(join(root, "package.json"));
  return Boolean(pkg.dependencies?.["@sveltejs/kit"] ?? pkg.devDependencies?.["@sveltejs/kit"]);
}

/**
 * Merges the declared gate scripts and dev dependencies into the host manifest.
 *
 * Everything the host already owns is kept and reported; a script name used
 * for a different command is a refusal, never a silent override. Returns the
 * applied changes, the kept declarations and the next manifest; the input is
 * not mutated.
 */
export function mergePackageJson(pkg, setup) {
  const next = structuredClone(pkg);
  const applied = [];
  const kept = [];
  for (const dependency of setup.dev_dependencies ?? []) {
    const declared = next.dependencies?.[dependency.name] ?? next.devDependencies?.[dependency.name];
    if (declared != null) {
      kept.push(`${dependency.name} already declared (${declared}); kept`);
      continue;
    }
    next.devDependencies = { ...next.devDependencies, [dependency.name]: dependency.range };
    applied.push({ id: `add-${dependency.name}`, change: `devDependencies.${dependency.name} = ${dependency.range}` });
  }
  for (const [name, command] of Object.entries(setup.scripts ?? {})) {
    const existing = next.scripts?.[name];
    if (existing === command) continue;
    if (existing != null) throw new Error(`package.json script "${name}" already runs "${existing}"; setup will not override it. Rename the gate script or remove yours, then rerun setup.`);
    next.scripts = { ...next.scripts, [name]: command };
    applied.push({ id: `script-${name}`, change: `scripts["${name}"] = ${command}` });
  }
  return { applied, kept, pkg: next };
}

/**
 * Adds the pipeline ignores to the official scaffold's eslint.config.js.
 *
 * The insertion is anchored on the scaffold's `includeIgnoreFile(gitignorePath),`
 * entry: a config whose shape is not recognized is refused, because guessing an
 * insertion point in an unknown file is how a gate starts linting the pipeline
 * itself — or stops linting the project. Already carrying the ignores is a
 * no-op, so a rerun changes nothing.
 */
export function editEslintConfig(source) {
  if (source.includes("agent-pipeline/**")) return { content: source, changed: false };
  const anchor = /^([ \t]*)includeIgnoreFile\(gitignorePath\),$/m;
  const match = anchor.exec(source);
  if (!match) throw new Error("eslint.config.js does not match the official scaffold shape (no includeIgnoreFile anchor); integrate the pipeline ignores by hand, then rerun setup.");
  const indent = match[1];
  const ignores = ["agent-pipeline/**", "pipeline/**", "playwright-report/**"].map((entry) => `'${entry}'`).join(", ");
  const block = `${indent}{\n${indent}\tignores: [${ignores}]\n${indent}},`;
  return { content: source.replace(anchor, `${match[0]}\n${block}`), changed: true };
}

/**
 * Widens the scaffold's Playwright test match to cover the a11y spec.
 *
 * The default match only sees *.test.ts / *.spec.ts, and an explicit file
 * argument is filtered by testMatch too, so e2e/a11y.e2e.ts would run zero
 * tests (verified against Playwright 1.63 on 2026-09-10). The pattern keeps
 * the scaffold's own demo test matching: the manual installation matched only
 * *.e2e.ts and silently dropped it.
 */
export const PLAYWRIGHT_TEST_MATCH = "**/*.{e2e,test,spec}.{ts,js}";

export function editPlaywrightConfig(source) {
  if (source.includes("testMatch")) return { content: source, changed: false };
  const anchor = /testDir:\s*'e2e'/;
  if (!anchor.test(source)) throw new Error("playwright.config.ts does not match the official scaffold shape (no testDir 'e2e' anchor); set testMatch by hand, then rerun setup.");
  return { content: source.replace(anchor, `testDir: 'e2e',\n\ttestMatch: '${PLAYWRIGHT_TEST_MATCH}'`), changed: true };
}

/** Appends the ignore entries the file lacks; an existing entry is never duplicated. */
export function editPrettierIgnore(source, entries) {
  const lines = source.split(/\r?\n/);
  const missing = entries.filter((entry) => !lines.includes(entry));
  if (missing.length === 0) return { content: source, added: [] };
  const body = source.endsWith("\n") ? source : `${source}\n`;
  const header = "\n# Pipeline exclusions: generated targets and vendored directories are not this repository's style\n";
  return { content: `${body}${header}${missing.join("\n")}\n`, added: missing };
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
  return 0;
}

/**
 * Deliberately small engines grammar: `*`, exact versions, `>=`, `>`, `<=`,
 * `<`, `^`, `~`, conjunctions and `||` unions. Anything else is refused rather
 * than guessed — an engines range nobody parsed is not a check.
 */
export function nodeSatisfies(version, range) {
  const parsed = /^(?:v)?(\d+)\.(\d+)\.(\d+)$/.exec(version ?? "");
  if (!parsed) throw new Error(`Stable Node version required, received ${version}`);
  const actual = parsed.slice(1).map(Number);
  return String(range).split("||").some((alternative) =>
    alternative.trim().split(/\s+/).every((raw) => {
      const token = raw.trim();
      if (["", "*", "x"].includes(token)) return true;
      const match = /^(>=|<=|>|<|\^|~|=)?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(token);
      if (!match) throw new Error(`Unsupported engines comparator "${token}": verify it by hand, then extend the grammar deliberately.`);
      const [, op = "=", major, minor, patch] = match;
      const bound = [Number(major), minor == null ? null : Number(minor), patch == null ? null : Number(patch)];
      const cmp = compareVersions(actual, bound.map((part) => part ?? 0));
      if (op === ">=") return cmp >= 0;
      if (op === "<=") return cmp <= 0;
      if (op === ">") return cmp > 0;
      if (op === "<") return cmp < 0;
      if (op === "=") return bound[1] == null ? actual[0] === bound[0] : bound[2] == null ? actual[0] === bound[0] && actual[1] === bound[1] : cmp === 0;
      if (op === "^") return actual[0] === bound[0] && cmp >= 0;
      if (op === "~") return actual[0] === bound[0] && (bound[1] == null || actual[1] === bound[1]) && cmp >= 0;
      throw new Error(`Unsupported engines comparator "${token}".`);
    }));
}

function npmView(name, range) {
  const output = execFileSync("npm", ["view", `${name}@${range}`, "version", "engines", "deprecated", "--json"], { encoding: "utf8", timeout: 30000 });
  return JSON.parse(output);
}

/**
 * Checks each setup dependency against the registry before it is installed:
 * the resolved release must exist, must not be deprecated and must admit the
 * running Node. `view` is injectable so the unit tests never touch the network.
 */
export function registryAudit(dependencies, view = npmView) {
  const resolved = [];
  for (const dependency of dependencies) {
    const metadata = [].concat(view(dependency.name, dependency.range) ?? []).filter((entry) => entry?.version);
    if (metadata.length === 0) throw new Error(`Registry returned no ${dependency.name} release inside ${dependency.range}.`);
    const latest = metadata.at(-1);
    if (latest.deprecated) throw new Error(`${dependency.name}@${latest.version} is deprecated (${latest.deprecated}); the manifest needs a reviewed range, not a silent install.`);
    if (latest.engines?.node && !nodeSatisfies(process.versions.node, latest.engines.node)) {
      throw new Error(`${dependency.name}@${latest.version} requires Node ${latest.engines.node}, outside the running ${process.versions.node}.`);
    }
    resolved.push({ name: dependency.name, version: latest.version, engines_node: latest.engines?.node ?? null });
  }
  return resolved;
}

function validateDesignSystem(value) {
  const ok = typeof value?.tokens === "string" && value.tokens.length > 0
    && typeof value?.primitives === "string" && value.primitives.length > 0
    && typeof value?.direction?.genre === "string" && value.direction.genre.trim().length > 0
    && typeof value?.direction?.because === "string" && value.direction.because.trim().length > 0
    && typeof value?.decided_at === "string" && value.decided_at.length > 0;
  if (!ok) throw new Error("pipeline.bootstrap.json design_system is incomplete: tokens, primitives, direction { genre, because } and decided_at are all required.");
  return value;
}

/** Inspects the existing scaffold; host edits are computed, never applied, at this stage. */
export function plan(root, defaults) {
  const pkgPath = join(root, "package.json");
  if (!existsSync(pkgPath)) throw new Error("SvelteKit preset needs package.json.");
  const pkg = json(pkgPath);
  if (pkg.workspaces) throw new Error("SvelteKit workspaces and monorepos need a dedicated adapter; no files were written.");
  for (const path of ["svelte.config.js", "playwright.config.ts", "eslint.config.js", ".prettierignore", "tsconfig.json", "src/routes/+page.svelte"]) {
    if (!existsSync(join(root, path))) throw new Error(`SvelteKit preset needs ${path}.`);
  }
  if (!existsSync(join(root, "vite.config.ts")) && !existsSync(join(root, "vite.config.js"))) throw new Error("SvelteKit preset needs vite.config.ts.");
  if (!readFileSync(join(root, "svelte.config.js"), "utf8").includes("@sveltejs/adapter-node")) {
    throw new Error("SvelteKit preset needs @sveltejs/adapter-node: the smoke gate starts the built Node server.");
  }
  if (!existsSync(join(root, "package-lock.json")) || ["pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb"].some((file) => existsSync(join(root, file)))) {
    throw new Error("SvelteKit preset supports npm with package-lock.json only; choose one consistent package manager and lockfile before setup.");
  }
  for (const name of ["check", "lint", "build", "test:unit", "test:e2e"]) {
    if (typeof pkg.scripts?.[name] !== "string" || pkg.scripts[name].trim().length === 0) throw new Error(`SvelteKit preset needs the official "${name}" script.`);
  }
  const manifest = json(new URL("./compatibility.json", import.meta.url));
  const required = Object.keys(manifest.supported[0].packages);
  const dependencies = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const name of required) if (!dependencies[name]) throw new Error(`SvelteKit preset needs an existing ${name} dependency.`);
  const installed = { node: process.versions.node, manager: "npm", required, packages: {} };
  for (const name of required) {
    const path = join(root, "node_modules", name, "package.json");
    if (existsSync(path)) installed.packages[name] = json(path).version;
  }
  const compatibility = assessCompatibility(manifest, installed);
  const stackCompatible = compatibility.cases.some((entry) => entry.mismatches.every((message) => message.startsWith("node ")));
  if (compatibility.status === "unsupported" && !stackCompatible) {
    throw new Error(`Unsupported SvelteKit toolchain for adapter ${manifest.adapter_version}: ${compatibility.cases.flatMap((entry) => entry.mismatches).join("; ")}. See profile-bundles/sveltekit/compatibility.json.`);
  }
  const projectTypes = ["frontend", "fullstack"];
  let architecture = {
    id: "custom",
    project_type: "fullstack",
    note: "Preserve the existing SvelteKit layout (routes, lib, static). This installation does not redesign application boundaries; future architecture changes require a recorded decision.",
  };
  let designSystem = null;
  const bootstrapPath = join(root, "pipeline.bootstrap.json");
  if (existsSync(bootstrapPath)) {
    const record = json(bootstrapPath);
    if (record.architecture) {
      if (!projectTypes.includes(record.architecture.project_type)) {
        throw new Error(`The SvelteKit adapter installs projects with screens (${projectTypes.join(" or ")}); the bootstrap declares ${record.architecture.project_type}.`);
      }
      architecture = record.architecture;
    }
    if (record.design_system != null) designSystem = validateDesignSystem(record.design_system);
  }
  if (designSystem == null) {
    throw new Error(
      "This project has screens: apply-profile requires a decided design_system and setup will not invent one. "
      + "Record design_system { tokens, primitives, direction: { genre, because }, decided_at } in pipeline.bootstrap.json "
      + "— render-design-system.mjs lays out the decision — then rerun setup.",
    );
  }
  const profile = "sveltekit";
  const profileDir = `${defaults.profiles_dir}/${profile}`;
  const commands = {
    check: "npm run check",
    lint: "npm run lint",
    build: "npm run build",
    test_unit: "npm run test:unit -- --run",
    test_e2e: "npm run test:e2e",
    accessibility: "npm run test:a11y",
    dead_code: "npm run check:dead-code",
    design_limits: "npm run check:design-limits",
    smoke: "npm run test:smoke",
    secrets_scan: "npm run scan:secrets",
    audit: "npm audit --audit-level=high",
  };
  for (const key of ["sast", "duplication", "project_map", "map_coverage", "tracker_sync"]) commands[key] = defaults.commands[key];
  const policy = json(new URL("./file-policy.json", import.meta.url));
  const config = {
    ...defaults, profile, commands, file_policy: policy,
    agent_runtime: { ...defaults.agent_runtime, workspace_paths: ["node_modules"], dependency_inputs: ["package.json", "package-lock.json"] },
    decisions_dir: "docs/decisions", default_mode: "pipeline",
    architecture,
    design_system: designSystem,
    setup: { adapter: profile, adapter_version: manifest.adapter_version, format: 1, package_manager: "npm", report: "pipeline/setup-report.json" },
    project_map: { ...defaults.project_map, roots: ["src"], extensions: [".ts", ".svelte"], skip: "(?:^|/)(?:dist|build|coverage)/" },
    duplication: { roots: ["src", "e2e"], min_lines: 6 },
    test_suites: { unit: { gate: "test_unit", replay: "per_issue" }, e2e: { gate: "test_e2e", replay: "closure" } },
    closure_gates: ["audit", "test_e2e"],
    human_review_paths: [
      "pipeline.config.json", "pipeline/**", "agent-pipeline/**", "package.json", "*lock*", ".github/**",
      "src/hooks.server.ts", "src/lib/server/**",
      "scripts/smoke.mjs", "eslint.design-limits.config.js", "knip.json", ".gitleaks.toml", "e2e/a11y.e2e.ts",
    ],
  };
  const files = {};
  for (const [destination, source] of Object.entries(TOOLING_FILES)) {
    files[destination] = readFileSync(new URL(`./tooling/${source}`, import.meta.url), "utf8");
  }
  files[`${profileDir}/invariants.md`] = readFileSync(new URL("./invariants.md", import.meta.url), "utf8");
  files[`${profileDir}/pitfalls.md`] = "# Project pitfalls\n\nNo project-specific findings recorded during installation.\n";
  files[config.project_context] = `# Project context

<!-- agent:summary -->
Existing SvelteKit project. Product scope is defined separately through Product.
<!-- /agent -->

<!-- agent:commands -->
Read the command table in the compiled role brief. Installed package manager: npm.
<!-- /agent -->

<!-- agent:context -->
The setup preset preserves the existing application. Design bounds are fixed preset policy, never automatically relaxed. The map and static security scan are heuristic. Secrets scanning detects the declared token formats and private keys, not all secrets. No coverage threshold, mutation testing, documentation enforcement, visual regression or CI configuration is claimed. Filesystem policies detect scope violations unless the harness enforces them.
<!-- /agent -->
`;
  const prettierEntries = [
    "agent-pipeline", "pipeline", "build", "test-results", "playwright-report",
    "pipeline.bootstrap.json", "pipeline.config.json", "AGENTS.md", ".github/workflows/ci.yml",
    config.project_map.out, config.issue_tracker.root,
  ];
  const edits = {};
  const applied = [];
  const merge = mergePackageJson(pkg, manifest.setup);
  if (merge.applied.length > 0) {
    edits["package.json"] = `${JSON.stringify(merge.pkg, null, 2)}\n`;
    applied.push(...merge.applied);
  }
  const eslint = editEslintConfig(readFileSync(join(root, "eslint.config.js"), "utf8"));
  if (eslint.changed) {
    edits["eslint.config.js"] = eslint.content;
    applied.push({ id: "eslint-ignores", change: "eslint.config.js: ignore agent-pipeline/**, pipeline/**, playwright-report/**" });
  }
  const playwright = editPlaywrightConfig(readFileSync(join(root, "playwright.config.ts"), "utf8"));
  if (playwright.changed) {
    edits["playwright.config.ts"] = playwright.content;
    applied.push({ id: "playwright-test-match", change: `playwright.config.ts: testMatch '${PLAYWRIGHT_TEST_MATCH}'` });
  }
  const prettier = editPrettierIgnore(readFileSync(join(root, ".prettierignore"), "utf8"), prettierEntries);
  if (prettier.added.length > 0) {
    edits[".prettierignore"] = prettier.content;
    applied.push({ id: "prettier-ignores", change: `.prettierignore: ${prettier.added.join(", ")}` });
  }
  const remediation = applied.length > 0
    ? { applied, kept: merge.kept, files: edits, install: edits["package.json"] ? { command: "npm", args: ["install"] } : null }
    : null;
  // What the toolchain actually was when the gates were proven. Cleared
  // calibration is a claim; this is what it claims about.
  const detected = { node: installed.node, manager: "npm", packages: installed.packages };
  const missing = manifest.setup.dev_dependencies.filter((dependency) => dependencies[dependency.name] == null);
  return { config, files, required, manager: "npm", compatibilityManifest: manifest, compatibility, remediation, detected, project_types: projectTypes, missing_dev_dependencies: missing, ignored: [] };
}

const defaultIo = {
  exec: (command, args, options = {}) => execFileSync(command, args, { encoding: "utf8", ...options }),
  view: npmView,
};

/** Fails before any write: manager, secrets binary, installed dependencies, registry, contract. */
export function prerequisites(root, planned, io = defaultIo) {
  let managerVersion;
  try { managerVersion = io.exec("npm", ["--version"], { cwd: root }).trim(); }
  catch { throw new Error("Package manager npm is unavailable."); }
  try { io.exec("gitleaks", ["version"], { cwd: root }); }
  catch { throw new Error("The secrets_scan gate needs a gitleaks binary on PATH. Its built-in rule set is not trusted; .gitleaks.toml carries the explicit rules it must load."); }
  for (const name of planned.required) {
    try { json(join(root, "node_modules", name, "package.json")); }
    catch { throw new Error(`Dependency ${name} is not installed. Install the host dependencies with npm, then rerun setup.`); }
  }
  const registry = registryAudit(planned.missing_dev_dependencies ?? [], io.view);
  const compatibility = assessCompatibility(planned.compatibilityManifest, { ...planned.compatibility.installed, manager_version: managerVersion });
  if (compatibility.status !== "compatible") {
    throw new Error(`Unsupported or unverified SvelteKit toolchain: ${compatibility.cases.flatMap((entry) => [...entry.mismatches, ...entry.missing]).join("; ")}`);
  }
  return { ...compatibility, registry };
}

/**
 * Proves that every gate the preset adds really refuses a defect.
 *
 * Each probe plants one deliberate defect, requires a nonzero exit from the
 * real gate command, and restores the host in `finally`. A gate that accepts
 * its defect stops the installation: a green check that measures nothing is
 * worse than a red one. `run` is injectable so the probes can be exercised
 * without a real toolchain.
 */
export async function prove(root, planned, run = runStep) {
  const config = planned.config;
  const proofs = [];
  const gate = (name) => {
    const command = config.commands[name];
    if (typeof command !== "string") throw new Error(`Cannot prove gate ${name}: no command declared.`);
    return command;
  };
  const absent = (path) => { if (existsSync(join(root, path))) throw new Error(`Probe path already exists: ${path}`); };
  const plantFile = (path, content) => () => {
    absent(path);
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
    return () => rmSync(join(root, path), { force: true });
  };
  async function refused(name, defect, plant) {
    const restore = plant();
    const started = performance.now();
    try {
      const result = await run(`negative proof: ${name} (${defect})`, gate(name), [], { shell: true, cwd: root });
      if (result.timed_out || result.interrupted || result.error || !Number.isInteger(result.code) || result.code === 0) {
        throw new Error(`${name} accepted its deliberate defect: ${defect}`);
      }
      proofs.push({ name: `negative proof: ${name} (${defect})`, gate: name, refused: true, duration_ms: Math.round(performance.now() - started) });
    } finally {
      restore();
    }
  }

  await refused("dead_code", "unused file", plantFile(`src/lib/${PROBE}.ts`, "export const pipelineInstallProbe = 1;\n"));
  await refused("dead_code", "unused export", () => {
    absent(`src/lib/${PROBE}.ts`);
    absent(`src/routes/${PROBE}/+page.ts`);
    writeFileSync(join(root, `src/lib/${PROBE}.ts`), "export const pipelineInstallProbeUnused = 1;\n");
    mkdirSync(join(root, `src/routes/${PROBE}`), { recursive: true });
    writeFileSync(join(root, `src/routes/${PROBE}/+page.ts`), 'import "$lib/pipeline-install-probe.js";\n');
    return () => {
      rmSync(join(root, `src/routes/${PROBE}`), { recursive: true, force: true });
      rmSync(join(root, `src/lib/${PROBE}.ts`), { force: true });
    };
  });
  await refused("dead_code", "unused dependency", () => {
    const path = join(root, "package.json");
    const original = readFileSync(path, "utf8");
    const pkg = JSON.parse(original);
    pkg.dependencies = { "pipeline-install-probe-unused": "1.0.0", ...pkg.dependencies };
    writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
    return () => writeFileSync(path, original);
  });
  await refused("design_limits", "five parameters", plantFile(
    `src/lib/${PROBE}.ts`,
    "export function pipelineInstallProbe(a, b, c, d, e) {\n\treturn a;\n}\n",
  ));
  {
    const page = join(root, "src/routes/+page.svelte");
    const aside = join(root, `src/routes/+page.svelte.${PROBE}`);
    if (!existsSync(page)) throw new Error("The smoke probe needs src/routes/+page.svelte.");
    absent(`src/routes/+page.svelte.${PROBE}`);
    renameSync(page, aside);
    const started = performance.now();
    try {
      const build = await run("negative proof: smoke (build without root route)", gate("build"), [], { shell: true, cwd: root });
      if (build.code !== 0 || build.timed_out || build.interrupted || build.error) {
        throw new Error("The build failed without the root route; the smoke probe proves nothing.");
      }
      const result = await run("negative proof: smoke (root route missing)", gate("smoke"), [], { shell: true, cwd: root });
      if (result.timed_out || result.interrupted || result.error || !Number.isInteger(result.code) || result.code === 0) {
        throw new Error("smoke accepted its deliberate defect: root route missing");
      }
      proofs.push({ name: "negative proof: smoke (root route missing)", gate: "smoke", refused: true, duration_ms: Math.round(performance.now() - started) });
    } finally {
      renameSync(aside, page);
    }
    const rebuild = await run("rebuild the healthy application after the smoke probe", gate("build"), [], { shell: true, cwd: root });
    if (rebuild.code !== 0 || rebuild.timed_out || rebuild.interrupted || rebuild.error) {
      throw new Error("The rebuild after the smoke probe failed; check the host before rerunning setup.");
    }
  }
  await refused("accessibility", "image without alt text", () => {
    const path = join(root, "src/routes/+page.svelte");
    const original = readFileSync(path, "utf8");
    writeFileSync(path, `${original}<img src="${PROBE}.png" />\n`);
    return () => writeFileSync(path, original);
  });
  await refused("secrets_scan", "planted token", plantFile(`${PROBE}.txt`, `token = "${"ghp_" + "a".repeat(36)}"\n`));
  return proofs;
}
