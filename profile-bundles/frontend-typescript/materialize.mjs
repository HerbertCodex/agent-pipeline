import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";

const reference = JSON.parse(readFileSync(new URL("./profile.json", import.meta.url), "utf8"));
const core = JSON.parse(readFileSync(new URL("../../templates/pipeline.config.template.json", import.meta.url), "utf8"));

const TECHNOLOGIES = [
  ["next", ["next"]],
  ["nuxt", ["nuxt"]],
  ["angular", ["@angular/core"]],
  ["sveltekit", ["@sveltejs/kit"]],
  ["svelte", ["svelte"]],
  ["solid", ["solid-js"]],
  ["vue", ["vue"]],
  ["react", ["react"]],
  ["preact", ["preact"]],
  ["astro", ["astro"]],
  ["vite", ["vite"]],
  ["vitest", ["vitest"]],
  ["typescript", ["typescript"]],
  ["jest", ["jest"]],
  ["playwright", ["@playwright/test"]],
  ["cypress", ["cypress"]],
];
const FRONTEND_TECHNOLOGIES = new Set(["next", "nuxt", "angular", "sveltekit", "svelte", "solid", "vue", "react", "preact", "astro"]);
const BUILD_TECHNOLOGIES = new Set(["vite"]);

const SCRIPT_CANDIDATES = {
  check: ["check", "typecheck", "type-check"],
  lint: ["lint"],
  format: ["format:check", "format-check"],
  build: ["build"],
  test_unit: ["test:unit", "test"],
  test_e2e: ["test:e2e", "e2e"],
  coverage: ["test:coverage", "coverage"],
  mutation: ["test:mutation", "mutation"],
  smoke: ["test:smoke", "smoke"],
  accessibility: ["test:a11y", "test:accessibility", "a11y"],
  architecture: ["check:architecture", "architecture"],
  design_system: ["check:design-system"],
  design_tokens: ["check:tokens"],
  visual_regression: ["test:visual", "test:visual-regression"],
  dead_code: ["check:dead-code"],
  duplication: ["check:duplication"],
  design_limits: ["check:design-limits"],
  comment_policy: ["check:comments"],
  sast: ["check:security"],
  secrets_scan: ["scan:secrets", "check:secrets"],
  audit: ["audit"],
};

const REQUIRED = [
  "check",
  "lint",
  "build",
  "test_unit",
  "audit",
  "secrets_scan",
  "project_map",
  "design_limits",
  "smoke",
  "duplication",
  "accessibility",
];
const OPTIONAL = [
  "format",
  "test_e2e",
  "coverage",
  "mutation",
  "architecture",
  "design_system",
  "design_tokens",
  "visual_regression",
  "dead_code",
  "comment_policy",
  "sast",
];

/** Reads JSON and reports which input could not be used. */
function json(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${label} unreadable: ${error.message}`);
  }
}

/** Returns the package-manager identity proved by one lockfile or packageManager. */
function packageManager(root, pkg) {
  const locks = [
    ["package-lock.json", "npm"],
    ["npm-shrinkwrap.json", "npm"],
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"],
  ].filter(([file]) => existsSync(join(root, file)));
  const managers = [...new Set(locks.map(([, manager]) => manager))];
  const declared = typeof pkg.packageManager === "string" ? pkg.packageManager.split("@")[0] : null;
  if (managers.length > 1 || (declared && managers.length === 1 && declared !== managers[0])) {
    throw new Error("package-manager evidence conflicts; keep one lockfile and one matching packageManager declaration");
  }
  const name = declared ?? managers[0];
  if (!name) throw new Error("package manager unproved: add a lockfile or packageManager declaration");
  return { name, declaration: pkg.packageManager ?? null, lockfiles: locks.map(([file]) => file) };
}

/** Maps a manager to a high-severity dependency audit when its CLI contract is known. */
function auditCommand(manager) {
  if (manager.name === "npm") return "npm audit --audit-level=high";
  if (manager.name === "pnpm") return "pnpm audit --audit-level high";
  if (manager.name === "yarn") {
    if (/^yarn@1\./.test(manager.declaration ?? "")) return "yarn audit --level high";
    if (/^yarn@(?:[2-9]|[1-9][0-9])\./.test(manager.declaration ?? "")) return "yarn npm audit --severity high";
  }
  return null;
}

/** Rejects the default placeholder many empty package manifests carry. */
function effectiveScript(value) {
  return typeof value === "string" && value.trim().length > 0 && !/no test specified|not implemented|exit 1/i.test(value);
}

/** Selects canonical pipeline gates from scripts that really exist in the host. */
function commandsFrom(pkg, manager) {
  const commands = {};
  const selectedScripts = {};
  for (const [gate, candidates] of Object.entries(SCRIPT_CANDIDATES)) {
    const script = candidates.find((name) => effectiveScript(pkg.scripts?.[name]));
    if (!script) continue;
    commands[gate] = `${manager.name} run ${script}`;
    selectedScripts[gate] = script;
  }
  const audit = auditCommand(manager);
  if (audit && !commands.audit) commands.audit = audit;

  let projectMapRegenerate = core.project_map.regenerate;
  if (effectiveScript(pkg.scripts?.["project-map"])) {
    projectMapRegenerate = `${manager.name} run project-map`;
    if (effectiveScript(pkg.scripts?.["project-map:check"])) {
      commands.project_map = `${manager.name} run project-map:check`;
      selectedScripts.project_map = "project-map:check";
    } else {
      commands.project_map = `${manager.name} run project-map -- --check`;
      selectedScripts.project_map = "project-map (--check)";
    }
  }
  return { commands, selectedScripts, projectMapRegenerate };
}

/** Reads declared and installed versions for recognizable front-end technologies. */
function technologiesIn(root, pkg) {
  const dependencies = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}), ...(pkg.peerDependencies ?? {}) };
  const found = [];
  for (const [name, packages] of TECHNOLOGIES) {
    const packageName = packages.find((candidate) => Object.hasOwn(dependencies, candidate));
    if (!packageName) continue;
    let installed = null;
    const installedPath = join(root, "node_modules", packageName, "package.json");
    if (existsSync(installedPath)) installed = json(installedPath, `${packageName} package`).version ?? null;
    found.push({ name, package: packageName, declared: dependencies[packageName], installed });
  }
  return found;
}

/** Names the generated profile from the framework and build tool actually observed. */
function profileName(technologies) {
  const framework = technologies.find((entry) => FRONTEND_TECHNOLOGIES.has(entry.name));
  const build = technologies.find((entry) => BUILD_TECHNOLOGIES.has(entry.name));
  const parts = [framework?.name, build?.name].filter((name, index, all) => name && all.indexOf(name) === index);
  return `frontend-${parts.join("-") || "typescript"}`;
}

/** Keeps policy paths only for source roots the host currently carries. */
function actualPolicy(root) {
  const conditional = new Set(["src", "test", "tests", "e2e", "public", "mockups"]);
  const keep = (pattern) => {
    const first = pattern.split("/")[0];
    return !conditional.has(first) || existsSync(join(root, first));
  };
  return Object.fromEntries(Object.entries(reference.file_policy).map(([role, policy]) => [role, {
    ...policy,
    allow: (policy.allow ?? []).filter(keep),
    deny: (policy.deny ?? []).filter(keep),
  }]));
}

/** Retains only invariants backed by an active host or core command. */
function activeInvariants(active) {
  return readFileSync(new URL("./invariants.md", import.meta.url), "utf8")
    .split("\n")
    .filter((line) => {
      const gate = line.match(/\(`([a-z0-9_]+)`\)\s*$/)?.[1];
      return gate == null || active.has(gate);
    })
    .join("\n")
    .replace(/\n*$/, "\n");
}

/** Produces the review note kept beside a materialized profile. */
function discovery(profile, targetFromRoot) {
  const technologies = profile.detected.technologies
    .map((entry) => `- ${entry.name}: declared ${entry.declared}${entry.installed ? `, installed ${entry.installed}` : ""}`)
    .join("\n") || "- No named framework or tool package detected; browser entry-point evidence was used.";
  const missing = profile.capabilities.missing_required.map((gate) => `- \`${gate}\``).join("\n") || "- None.";
  const optional = profile.capabilities.optional_not_detected.map((gate) => `- \`${gate}\``).join("\n") || "- None.";
  return `# Materialized front-end profile

Source contract: \`frontend-typescript\`  
Host package: \`${profile.detected.package}\`  
Package manager: \`${profile.detected.package_manager.name}\`

## Observed technologies

${technologies}

## Required before calibration can be cleared

${missing}

These gates were not fabricated. Configure them with real project tools, execute
them, and prove their refusal before clearing \`calibration_required\`.

## Optional capabilities not detected

${optional}

Their absence does not add a placeholder command. Enable one only when the project
needs it and carries a real implementation.

## Import

Review this bundle, then run:

\`\`\`sh
node agent-pipeline/scripts/import-profile.mjs ${targetFromRoot}
\`\`\`
`;
}

/**
 * Materializes the generic TypeScript front-end contract against one host.
 *
 * The host is inspected but not changed. The output remains uncalibrated and
 * can be reviewed before the existing profile importer writes project files.
 */
export function materializeProfile(host = ".", target) {
  if (!target) throw new Error("output directory missing");
  const root = resolve(host);
  const output = resolve(target);
  if (existsSync(output)) throw new Error(`output already exists: ${output}`);
  if (!existsSync(join(root, "package.json")) || !existsSync(join(root, "tsconfig.json"))) {
    throw new Error("TypeScript front-end profile needs package.json and tsconfig.json");
  }
  const pkg = json(join(root, "package.json"), "package.json");
  const technologies = technologiesIn(root, pkg);
  const browserEntry = existsSync(join(root, "index.html"));
  if (!browserEntry && !technologies.some((entry) => FRONTEND_TECHNOLOGIES.has(entry.name))) {
    throw new Error("front-end evidence missing: no browser entry point or recognized front-end package");
  }
  const manager = packageManager(root, pkg);
  const selected = commandsFrom(pkg, manager);
  const roots = reference.project_map.roots.filter((path) => existsSync(join(root, path)));
  if (roots.length === 0) throw new Error("source roots missing: none of src, test, tests or e2e exists");
  const active = new Set([...Object.keys(core.commands ?? {}), ...Object.keys(selected.commands)]);
  const missingRequired = REQUIRED.filter((gate) => !active.has(gate));
  const optionalNotDetected = OPTIONAL.filter((gate) => !active.has(gate));
  const name = profileName(technologies);
  const profile = {
    name,
    project_type: "frontend",
    source_profile: reference.name,
    calibration_required: true,
    detected: {
      package: pkg.name ?? "unnamed",
      package_manager: manager,
      technologies,
      scripts: selected.selectedScripts,
    },
    capabilities: {
      active: [...active].sort(),
      missing_required: missingRequired,
      optional_not_detected: optionalNotDetected,
    },
    commands: selected.commands,
    project_map: {
      ...reference.project_map,
      roots,
      regenerate: selected.projectMapRegenerate,
    },
    doc_policy: { ...reference.doc_policy, roots },
    comment_policy: { ...reference.comment_policy, roots },
    file_policy: actualPolicy(root),
  };
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, "profile.json"), `${JSON.stringify(profile, null, 2)}\n`);
  writeFileSync(join(output, "invariants.md"), activeInvariants(active));
  writeFileSync(join(output, "DISCOVERY.md"), discovery(profile, relative(root, output) || "."));
  return { name, output, missing_required: missingRequired, commands: selected.commands };
}

function main() {
  const [target, host = "."] = process.argv.slice(2);
  if (!target) {
    console.error("usage: materialize.mjs <output-dir> [host-dir]");
    process.exitCode = 1;
    return;
  }
  try {
    const result = materializeProfile(host, target);
    console.log(`written: ${result.output} (profile ${result.name}, ${Object.keys(result.commands).length} observed command(s))`);
    if (result.missing_required.length) console.log(`missing required gates: ${result.missing_required.join(", ")}`);
    console.log("Review DISCOVERY.md, configure the missing gates, and keep calibration_required true until their proofs pass.");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith("materialize.mjs")) main();
