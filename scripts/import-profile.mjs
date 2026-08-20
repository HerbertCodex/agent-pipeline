import { readFileSync, writeFileSync, existsSync, mkdirSync, cpSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fail } from "./lib.mjs";

/**
 * Keys the bundle brings, in the order they are read.
 */
const STACK_KEYS = ["commands", "project_map", "doc_policy", "comment_policy", "secrets_scan", "file_policy"];

/**
 * Template of the values the bundle cannot know.
 *
 * They describe where THIS project files its own things, not the stack: no
 * profile can bring them. They live in a template rather than in this script,
 * for two reasons. A path hardcoded here would only hold for a project that
 * kept the defaults, and the framework forbids itself that everywhere else.
 * And a template is read: a default discovered by opening a file beats a
 * default discovered by reading code.
 */
const CONFIG_TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), "..", "templates", "pipeline.config.template.json");

/**
 * Reads the host values from the framework's template.
 *
 * The template is resolved from this script, never from the host project: the
 * framework running the import is the one bringing its own defaults, and a
 * blank host has nothing to offer yet.
 *
 * @returns the location keys to write into the configuration
 */
function hostDefaults() {
  if (!existsSync(CONFIG_TEMPLATE)) fail(`not found: ${CONFIG_TEMPLATE}`);
  return JSON.parse(readFileSync(CONFIG_TEMPLATE, "utf8"));
}

/**
 * Installs a profile bundle into a host project.
 */
function main() {
  const [bundle, host = "."] = process.argv.slice(2);
  if (!bundle) fail("usage: import-profile.mjs <bundle-dir> [host-dir]");
  const manifestPath = join(bundle, "profile.json");
  if (!existsSync(manifestPath)) fail(`not a profile bundle: ${manifestPath} not found`);

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const name = manifest.name;
  if (typeof name !== "string" || name.length === 0) fail("profile.json carries no name");

  const written = [];
  const skipped = [];

  const defaults = hostDefaults();
  const profileDir = join(host, defaults.profiles_dir, name);
  mkdirSync(profileDir, { recursive: true });
  cpSync(join(bundle, "invariants.md"), join(profileDir, "invariants.md"));
  written.push(join(defaults.profiles_dir, name, "invariants.md"));
  if (existsSync(join(bundle, "skills"))) {
    cpSync(join(bundle, "skills"), join(profileDir, "skills"), { recursive: true });
    written.push(join(defaults.profiles_dir, name, "skills/"));
  }
  writeFileSync(join(profileDir, "profile.json"), JSON.stringify({ imported_from: manifest.name, calibration_required: true }, null, 2));

  const toolingDir = join(bundle, "tooling");
  if (existsSync(toolingDir)) {
    for (const file of readdirSync(toolingDir)) {
      const destination = join(host, file);
      if (existsSync(destination)) {
        skipped.push(file);
        continue;
      }
      cpSync(join(toolingDir, file), destination);
      written.push(file);
    }
  }

  const slice = { profile: name };
  for (const key of STACK_KEYS) {
    if (manifest[key] !== undefined) slice[key] = manifest[key];
  }

  const configPath = join(host, "pipeline.config.json");
  if (existsSync(configPath)) {
    console.log(`${configPath} already exists. It belongs to the operator and is never rewritten.`);
    console.log("Merge this block by hand, then delete whatever your project does differently:\n");
    console.log(JSON.stringify(slice, null, 2));
    console.log("");
    for (const file of written) console.log(`  written  ${file}`);
    for (const file of skipped) console.log(`  kept     ${file} (yours, left untouched)`);
    process.exit(1);
  }

  // Merged key by key inside `commands`, not object against object: the
  // template carries the gates the framework itself provides, the bundle
  // carries the ones the stack provides, and a whole-object overwrite drops
  // one of the two silently. The bundle wins where both name a key — it was
  // written for a real project, the template was written for none.
  const merged = { ...slice, ...defaults };
  if (defaults.commands != null || slice.commands != null) {
    merged.commands = { ...(defaults.commands ?? {}), ...(slice.commands ?? {}) };
  }
  writeFileSync(configPath, JSON.stringify(merged, null, 2));
  written.push("pipeline.config.json");

  for (const file of written) console.log(`  written  ${file}`);
  for (const file of skipped) console.log(`  kept     ${file} (yours, left untouched)`);
  console.log("");
  console.log("calibration_required is set on this profile, and apply-profile refuses to run while it is.");
  console.log("The thresholds came from another codebase. Measure them against yours, adjust the tool files,");
  console.log("then set calibration_required to false to state that you did.");
}

if (process.argv[1]?.endsWith("import-profile.mjs")) main();
