import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, lstatSync, rmSync, renameSync } from "node:fs";
import { join, dirname, resolve, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { execFileSync } from "node:child_process";
import { runStep } from "./setup-runner.mjs";
import { mergeUpdate } from "./setup-migration.mjs";

const framework = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = process.cwd();
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;

function options(args) {
  const parsed = { runtime: null, dryRun: false, update: false, apply: false, timeoutMs: 120000, profile: null };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dry-run") parsed.dryRun = true;
    else if (arg === "--update") parsed.update = true;
    else if (arg === "--apply") parsed.apply = true;
    else if (arg === "--runtime") {
      parsed.runtime = args[++index];
      if (!["portable", "claude-code"].includes(parsed.runtime)) throw new Error("--runtime must be portable or claude-code");
    } else if (arg === "--profile") {
      parsed.profile = args[++index];
      if (!/^[a-z][a-z0-9-]*$/.test(parsed.profile ?? "")) throw new Error("--profile needs a shipped adapter name");
    } else if (arg === "--timeout-seconds") {
      parsed.timeoutMs = Number(args[++index]) * 1000;
      if (!Number.isSafeInteger(parsed.timeoutMs) || parsed.timeoutMs < 1) throw new Error("--timeout-seconds must be positive with millisecond precision");
    } else throw new Error("usage: setup.mjs [--dry-run] [--update [--apply]] [--profile name] [--runtime portable|claude-code] [--timeout-seconds seconds]");
  }
  if (parsed.apply && (!parsed.update || parsed.dryRun)) throw new Error("--apply requires --update and cannot accompany --dry-run");
  if (parsed.update && !parsed.apply) parsed.dryRun = true;
  return parsed;
}

/** Protects both existing policy and paths redirected through symlinks. */
function safeTarget(path) {
  const absolute = resolve(root, path);
  if (!absolute.startsWith(`${root}${sep}`)) throw new Error(`Setup target must stay inside the host: ${path}`);
  let current = absolute;
  while (current !== root) {
    if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error(`Setup will not write through a symlink: ${relative(root, current)}`);
    current = dirname(current);
  }
  return absolute;
}

function write(path, text) {
  const absolute = safeTarget(path);
  if (existsSync(absolute) && readFileSync(absolute, "utf8") === text) return;
  mkdirSync(dirname(absolute), { recursive: true });
  const temporary = safeTarget(`${path}.setup-tmp`);
  writeFileSync(temporary, text, { flag: "wx" });
  try {
    renameSync(temporary, absolute);
  } finally {
    rmSync(temporary, { force: true });
  }
}

/** Records generated policy separately from source-dependent maps and mutable state. */
function generatedSnapshot(paths) {
  const hashes = {};
  function visit(path) {
    const absolute = safeTarget(path);
    if (!existsSync(absolute)) throw new Error(`Generated policy is missing: ${path}`);
    if (lstatSync(absolute).isDirectory()) {
      for (const name of readdirSync(absolute).sort()) visit(`${path}/${name}`);
    } else hashes[path] = createHash("sha256").update(readFileSync(absolute)).digest("hex");
  }
  for (const path of paths) visit(path);
  return hashes;
}

/** Backs up only managed files; application sources, dependencies and tracker state are excluded. */
function managedBackup(paths) {
  const contents = new Map();
  function visit(path) {
    const absolute = safeTarget(path);
    if (!existsSync(absolute)) return;
    if (lstatSync(absolute).isDirectory()) {
      for (const name of readdirSync(absolute)) visit(`${path}/${name}`);
    } else contents.set(path, readFileSync(absolute));
  }
  paths.forEach(visit);
  return () => {
    const current = new Set();
    function collect(path) {
      const absolute = safeTarget(path);
      if (!existsSync(absolute)) return;
      if (lstatSync(absolute).isDirectory()) readdirSync(absolute).forEach((name) => collect(`${path}/${name}`));
      else current.add(path);
    }
    paths.forEach(collect);
    for (const path of current) if (!contents.has(path)) rmSync(safeTarget(path));
    for (const [path, bytes] of contents) {
      mkdirSync(dirname(safeTarget(path)), { recursive: true });
      writeFileSync(safeTarget(path), bytes);
    }
  };
}

async function main() {
  const opts = options(process.argv.slice(2));
  const bundles = join(framework, "profile-bundles");
  const matches = [];
  for (const name of readdirSync(bundles).sort()) {
    const path = join(bundles, name, "installer.mjs");
    if (!existsSync(path) || (opts.profile && opts.profile !== name)) continue;
    const adapter = await import(pathToFileURL(path));
    if (adapter.detect(root)) matches.push({ name, adapter, path });
  }
  if (matches.length !== 1) throw new Error(`Expected one compatible setup adapter, found ${matches.length}. Use the manual installation guide for unsupported stacks.`);
  const { name, adapter, path: adapterPath } = matches[0];
  const defaults = readJson(join(framework, "templates/pipeline.config.template.json"));
  const planned = adapter.plan(root, defaults);
  let config = planned.config;
  const current = existsSync("pipeline.config.json") ? readJson("pipeline.config.json") : null;
  const fingerprint = createHash("sha256").update(readFileSync(adapterPath)).update(serialize(planned.files)).update(serialize(planned.compatibilityManifest ?? null)).digest("hex");
  config.setup.fingerprint = fingerprint;
  if (current?.bootstrap) {
    const bootstrap = readJson(safeTarget(current.bootstrap));
    if (bootstrap.format !== 1 || !isDeepStrictEqual(bootstrap.architecture, current.architecture)) throw new Error("Bootstrap architecture differs from the recorded decision.");
    config.bootstrap = current.bootstrap;
    config.architecture = current.architecture;
    if (config.architecture.project_type !== "backend") throw new Error("The selected adapter requires a backend bootstrap.");
  }
  const runtime = opts.runtime ?? current?.agent_runtime?.prompt_adapter ?? "portable";
  config.agent_runtime.prompt_adapter = runtime;
  if (runtime === "claude-code") {
    config.prompts_dir = ".claude/agents";
    config.skills_dir = ".claude/skills";
  }
  const stub = current && Object.keys(current).sort().join(",") === "architecture,bootstrap";
  if (!opts.update && current && !stub && !isDeepStrictEqual(current, config)) {
    throw new Error("Existing pipeline.config.json differs from this setup plan. Keep your policy; use preflight for an installed pipeline or review a migration explicitly.");
  }
  const resuming = current?.setup?.fingerprint === fingerprint || (opts.update && current?.setup?.adapter === name);
  const profileDir = `${config.profiles_dir}/${config.profile}`;
  const profileManifest = `${profileDir}/profile.json`;
  const manifest = { setup_adapter: name, fingerprint, calibration_required: true, validation: "fixed preset; local gates must pass before rendering" };
  let files = { ...planned.files };
  const journal = `${config.decisions_dir}/0000-pipeline-setup.md`;
  files[journal] = `# Pipeline installation\n\nAdapter: ${name}. Runtime: ${runtime}.\n\nThe operator invokes setup to apply this fixed preset. Existing application sources, dependencies and product scope are preserved. Architecture reference: ${JSON.stringify(config.architecture)}. No product approval or CI proof is inferred from installation.\n`;
  const baselinePath = `${profileDir}/setup-baseline.json`;
  safeTarget(baselinePath);
  let upstream = { config: structuredClone(config), files: structuredClone(files) };
  let changes = [];
  let removed = [];
  if (opts.update) {
    if (!resuming || !existsSync(baselinePath)) throw new Error("No versioned setup baseline exists. Legacy installations require an explicit manual migration; existing files were kept.");
    const baseline = readJson(baselinePath);
    if (baseline.format !== 1 || baseline.config?.setup?.fingerprint !== current.setup.fingerprint) throw new Error("Setup baseline does not match the installed adapter.");
    for (const key of ["profile", "profiles_dir", "project_context", "decisions_dir", "briefs_dir", "prompts_dir", "skills_dir", "rules_path", "store_dir"]) {
      if (current[key] !== baseline.config[key] || config[key] !== baseline.config[key]) throw new Error(`Directory or profile migration requires manual review: ${key}`);
    }
    const localFiles = {};
    for (const path of new Set([...Object.keys(baseline.files), ...Object.keys(files)])) {
      safeTarget(path);
      if (existsSync(path)) localFiles[path] = readFileSync(path, "utf8");
    }
    // An installation decision records history; an adapter update does not rewrite it.
    if (baseline.files[journal] !== undefined) upstream.files[journal] = baseline.files[journal];
    const merged = mergeUpdate({ config: baseline.config, files: baseline.files }, { config: current, files: localFiles }, upstream);
    if (merged.conflicts.length) throw new Error(`Update conflicts; no files written: ${merged.conflicts.join(", ")}`);
    config = merged.config;
    files = merged.files;
    removed = Object.keys(localFiles).filter((path) => !Object.hasOwn(files, path));
    changes = [...new Set([...Object.keys(localFiles), ...Object.keys(files)])]
      .filter((path) => localFiles[path] !== files[path])
      .map((path) => ({ path, before: localFiles[path] ?? null, after: files[path] ?? null }));
    if (!isDeepStrictEqual(current, config)) changes.unshift({ path: "pipeline.config.json", before: current, after: config });
  }
  files["pipeline.config.json"] = serialize(config);
  const generated = ["AGENTS.md", config.rules_path, config.project_map.out, config.prompts_dir, config.skills_dir, config.briefs_dir];
  if (runtime === "claude-code") generated.push("CLAUDE.md");
  const snapshotPath = `${profileDir}/setup-targets.json`;
  const fixedTargets = generated.filter((path) => path !== config.project_map.out);
  safeTarget(snapshotPath);
  if (opts.update && !existsSync(snapshotPath)) throw new Error("Generated policy baseline is missing; review the legacy installation manually.");
  if (existsSync(snapshotPath)) {
    if (!resuming || !isDeepStrictEqual(readJson(snapshotPath), generatedSnapshot(fixedTargets))) {
      throw new Error("Generated policy changed since setup. Review the changes; setup will not overwrite them.");
    }
  }
  for (const [path, text] of Object.entries(files)) {
    safeTarget(path);
    if ((path === "pipeline.config.json" && stub) || opts.update) continue;
    if (path.endsWith("/pitfalls.md") && existsSync(path)) continue;
    if (existsSync(path) && readFileSync(path, "utf8") !== text) throw new Error(`Existing file differs: ${path}. Setup will not overwrite it.`);
  }
  for (const path of generated) {
    safeTarget(path);
    if (!resuming && existsSync(path)) throw new Error(`Generated target already exists: ${path}. Review its integration before setup.`);
  }
  safeTarget(profileManifest);
  safeTarget(config.setup.report);
  safeTarget(config.issue_tracker.root);
  if (!resuming && existsSync(config.setup.report)) throw new Error(`Setup report already exists: ${config.setup.report}`);
  safeTarget(".gitignore");
  if (existsSync(profileManifest)) {
    const existing = readJson(profileManifest);
    if (existing.setup_adapter !== name || existing.fingerprint !== (opts.update ? current.setup.fingerprint : fingerprint)) throw new Error(`Existing profile is not owned by this setup: ${profileManifest}`);
  }
  if (existsSync(".github/workflows/ci.yml")) throw new Error("Existing ci.yml needs explicit integration; setup does not replace CI.");
  if (opts.dryRun) {
    console.log(serialize({
      adapter: name, config,
      compatibility: planned.compatibility ?? null,
      update: opts.update ? { from: current.setup.adapter_version ?? "legacy", to: config.setup.adapter_version, changes, regenerated: generated } : null,
      files: [...Object.keys(files), profileManifest, snapshotPath, baselinePath, ...generated, ".gitignore", config.setup.report,
        `${config.store_dir}/issues.jsonl`, `${config.store_dir}/specs.jsonl`],
      tracker_directory: config.issue_tracker.root,
      git_hooks: ["pre-commit", "pre-push"],
      checks: Object.keys(config.commands),
      remediation: planned.remediation ?? null,
      prerequisites: "Installed host tools, Git repository, configured tracker CLI. Setup installs no dependency, except to make effective a declared remediation it just applied and reported.",
    }));
    return;
  }
  const compatibility = adapter.prerequisites(root, planned);
  const gitRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  if (resolve(gitRoot) !== root) throw new Error("Run setup at the root of the host Git repository.");
  if (!existsSync(join(root, "agent-pipeline/scripts/apply-profile.mjs"))) throw new Error("Install the framework at agent-pipeline/ in the host repository first.");
  try { execFileSync(config.issue_tracker.command, ["--version"], { stdio: "ignore" }); }
  catch { throw new Error(`Tracker CLI ${config.issue_tracker.command} is unavailable. Install it before rerunning setup.`); }
  const hookRoot = execFileSync("git", ["rev-parse", "--git-path", "hooks"], { encoding: "utf8" }).trim();
  for (const name of ["pre-commit", "pre-push"]) {
    const path = join(hookRoot, name);
    if (existsSync(path) && !readFileSync(path, "utf8").includes("# generated by agent-pipeline/scripts/install-hooks.mjs")) throw new Error(`Existing hook needs integration: ${path}`);
  }
  const lock = safeTarget(".pipeline-setup.lock");
  try { mkdirSync(lock); } catch { throw new Error("Setup lock exists. Wait for the active setup, or remove .pipeline-setup.lock after confirming it was interrupted."); }
  const report = { adapter: name, fingerprint, compatibility, started_at: new Date().toISOString(), status: "running", steps: [] };
  const started = performance.now();
  const step = async (name, command, args = [], shell = false) => {
    const result = await runStep(name, command, args, { timeoutMs: opts.timeoutMs, shell });
    report.steps.push(result);
    if (result.code !== 0 || result.timed_out || result.interrupted || result.error) throw new Error(`Setup stopped at ${name}. Fix the reported problem and rerun the same command.`);
  };
  const core = (script, args = []) => step(script, process.execPath, [join(framework, "scripts", script), ...args]);
  let rollback;
  const savedHooks = opts.update ? ["pre-commit", "pre-push"].map((name) => {
    const path = join(hookRoot, name);
    return { path, content: existsSync(path) ? readFileSync(path) : null };
  }) : [];
  try {
    if (opts.update) rollback = managedBackup([...Object.keys(files), ...removed, ...generated, baselinePath, profileManifest, snapshotPath, ".gitignore"]);
    for (const [path, text] of Object.entries(files)) {
      if (!opts.update && path.endsWith("/pitfalls.md") && existsSync(path)) continue;
      write(path, text);
    }
    for (const path of removed) rmSync(safeTarget(path));
    write(profileManifest, serialize(manifest));
    const ignored = [...(planned.ignored ?? []), config.handoffs_dir, config.agent_runtime.runs_dir, config.pages_dir, config.setup.report, ".pipeline-setup.lock/"];
    const originalIgnore = existsSync(".gitignore") ? readFileSync(".gitignore", "utf8") : "";
    const additions = ignored.filter((path) => !originalIgnore.split(/\r?\n/).includes(`/${path}`));
    if (additions.length) write(".gitignore", `${originalIgnore}${originalIgnore.endsWith("\n") || !originalIgnore ? "" : "\n"}${additions.map((path) => `/${path}`).join("\n")}\n`);
    for (const kind of ["issues", "specs"]) {
      const path = `${config.store_dir}/${kind}.jsonl`;
      safeTarget(path);
      if (!existsSync(path)) write(path, "");
    }
    if (![config.issue_tracker.issues_file, config.issue_tracker.specs_file].every((file) => existsSync(join(config.issue_tracker.root, file)))) {
      await step("initialize tracker", config.issue_tracker.command, ["init"]);
    }
    if (planned.remediation) {
      // The official scaffold fails the audit gate as generated. The repair is
      // declared in the adapter manifest, applied here, and reported: an
      // override only reaches the audit through a regenerated lockfile, so the
      // install is part of the repair rather than a convenience.
      write("package.json", planned.remediation.package_json);
      report.remediation = planned.remediation.applied;
      for (const entry of planned.remediation.applied) console.log(`[setup] remediation ${entry.id}: ${entry.change}`);
      await step("apply scaffold remediation", planned.remediation.install.command, planned.remediation.install.args);
    }
    await step("generate project map", config.project_map.regenerate, [], true);
    for (const [name, command] of Object.entries(config.commands)) await step(name, command, [], true);
    // Clearing the flag states that the gates were proven here; the adapter's
    // observation says against what. apply-profile refuses the claim without it.
    write(profileManifest, serialize({ ...manifest, calibration_required: false, ...(planned.detected ? { detected: planned.detected } : {}) }));
    await core("apply-profile.mjs");
    await core("sync-briefs.mjs");
    await core("install-hooks.mjs");
    for (const script of ["apply-profile.mjs", "sync-briefs.mjs", "install-hooks.mjs"]) await core(script, ["--check"]);
    await core("store-verify.mjs");
    await core("next-step.mjs");
    write(snapshotPath, serialize(generatedSnapshot(fixedTargets)));
    write(baselinePath, serialize({ format: 1, ...upstream }));
    report.status = "ready";
    console.log("Pipeline ready. Define the product scope with Product when you want to start work.");
  } catch (error) {
    if (rollback) {
      rollback();
      for (const hook of savedHooks) {
        if (hook.content === null) rmSync(hook.path, { force: true });
        else writeFileSync(hook.path, hook.content);
      }
      report.rolled_back = true;
    }
    report.status = "failed";
    report.error = error.message;
    throw error;
  } finally {
    report.duration_ms = Math.round(performance.now() - started);
    report.finished_at = new Date().toISOString();
    try {
      write(config.setup.report, serialize(report));
      console.log(`[setup] ${report.status}: ${report.duration_ms} ms; report: ${config.setup.report}`);
    } finally { rmSync(lock, { recursive: true, force: true }); }
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
