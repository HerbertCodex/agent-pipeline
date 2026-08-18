import { readFileSync, writeFileSync, existsSync, mkdirSync, cpSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { loadConfig, fail } from "./lib.mjs";

/**
 * Configuration keys that describe the stack, not this repository.
 *
 * The split between the two is not cosmetic. `commands` names an ecosystem's
 * tools and holds for any project using it; `store_dir` or `ci` describe
 * where THIS project keeps its state and which forge it lives on. Carrying
 * the second kind would install decisions the next project never took.
 */
const STACK_KEYS = ["commands", "project_map", "doc_policy", "comment_policy", "secrets_scan", "file_policy"];

/**
 * Spots the tool files a command names as arguments.
 *
 * A command exported without the file it passes as an argument is a command
 * that fails at the next project, and the failure will look like a gate
 * refusing when it is a file missing, the confusion `preflight` exists to
 * lift.
 *
 * The spotting is deliberately literal: a token designating an existing FILE
 * is carried, the rest are ignored. That nuance cost one round: `eslint
 * --config <file> .` ends with a dot, which exists and is a directory. A
 * command going through a task runner names no file, and its files are then
 * completed as arguments.
 *
 * @param commands - the configuration's `commands` block
 * @param root - root of the exported project
 * @returns the relative paths spotted, without duplicates
 */
function toolingFrom(commands, root) {
  const found = new Set();
  for (const command of Object.values(commands)) {
    for (const token of String(command).split(/\s+/)) {
      const candidate = token.replace(/^["']|["']$/g, "");
      if (candidate.length === 0 || candidate.startsWith("-")) continue;
      if (!/[./]/.test(candidate)) continue;
      const resolved = join(root, candidate);
      if (!existsSync(resolved) || !statSync(resolved).isFile()) continue;
      found.add(candidate);
    }
  }
  return [...found];
}

/**
 * Exports the active profile as a reusable bundle.
 */
function main() {
  const [target, ...extra] = process.argv.slice(2);
  if (!target) fail("usage: export-profile.mjs <output-dir> [tool-file...]");

  const config = loadConfig();
  const source = join(config.profiles_dir, config.profile);
  if (!existsSync(join(source, "invariants.md"))) {
    fail(
      `profile "${config.profile}" not found under ${config.profiles_dir}: there is nothing to export. ` +
        "A profile is its invariants plus its skills; without invariants it is not one.",
    );
  }

  mkdirSync(target, { recursive: true });
  const carried = {};
  for (const key of STACK_KEYS) {
    if (config[key] !== undefined) carried[key] = config[key];
  }

  const tooling = [...new Set([...toolingFrom(config.commands ?? {}, "."), ...extra])];
  if (tooling.length > 0) {
    mkdirSync(join(target, "tooling"), { recursive: true });
    for (const file of tooling) {
      if (!existsSync(file)) fail(`tool file not found: ${file}`);
      cpSync(file, join(target, "tooling", basename(file)));
    }
  }

  writeFileSync(
    join(target, "profile.json"),
    JSON.stringify(
      {
        name: config.profile,
        project_type: config.architecture?.project_type ?? null,
        exported_at: new Date().toISOString().slice(0, 10),
        calibration_required: true,
        tooling: tooling.map((file) => basename(file)),
        ...carried,
      },
      null,
      2,
    ),
  );

  cpSync(join(source, "invariants.md"), join(target, "invariants.md"));
  if (existsSync(join(source, "skills"))) {
    cpSync(join(source, "skills"), join(target, "skills"), { recursive: true });
  }

  console.log(`written: ${target}/ (profile ${config.profile}, ${Object.keys(carried.commands ?? {}).length} commands)`);
  for (const file of tooling) console.log(`  tooling  ${file}`);
  console.log("");
  console.log("calibration_required is set: the thresholds in these files were measured on THIS codebase.");
  console.log("Whoever imports them measures again before trusting them.");
}

if (process.argv[1]?.endsWith("export-profile.mjs")) main();
