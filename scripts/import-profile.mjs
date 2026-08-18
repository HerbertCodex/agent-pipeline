import { readFileSync, writeFileSync, existsSync, mkdirSync, cpSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fail } from "./lib.mjs";

/**
 * Cles que le paquet apporte, dans l'ordre ou elles se lisent.
 */
const STACK_KEYS = ["commands", "project_map", "doc_policy", "comment_policy", "secrets_scan", "file_policy"];

/**
 * Gabarit des valeurs que le paquet ne peut pas connaitre.
 *
 * Elles decrivent l'endroit ou ce projet-ci range ses fichiers, pas la
 * stack : aucun profil ne peut les apporter. Elles vivent dans un gabarit
 * plutot que dans ce script, pour deux raisons. Un chemin ecrit en dur ici
 * ne vaudrait que pour un projet ayant garde les defauts, et le cadre s'en
 * interdit partout ailleurs. Et un gabarit se relit : un defaut qu'on
 * decouvre en ouvrant un fichier vaut mieux qu'un defaut qu'on decouvre en
 * lisant du code.
 */
const CONFIG_TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), "..", "templates", "pipeline.config.template.json");

/**
 * Lit les valeurs d'accueil depuis le gabarit du cadre.
 *
 * Le gabarit est resolu depuis ce script, jamais depuis le projet
 * d'accueil : c'est le cadre qui execute l'import qui apporte ses propres
 * defauts, et un accueil vierge n'a encore rien a offrir.
 *
 * @returns les cles d'emplacement a poser dans la configuration
 */
function hostDefaults() {
  if (!existsSync(CONFIG_TEMPLATE)) fail(`not found: ${CONFIG_TEMPLATE}`);
  return JSON.parse(readFileSync(CONFIG_TEMPLATE, "utf8"));
}

/**
 * Installe un paquet de profil dans un projet d'accueil.
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

  writeFileSync(configPath, JSON.stringify({ ...slice, ...defaults }, null, 2));
  written.push("pipeline.config.json");

  for (const file of written) console.log(`  written  ${file}`);
  for (const file of skipped) console.log(`  kept     ${file} (yours, left untouched)`);
  console.log("");
  console.log("calibration_required is set on this profile, and apply-profile refuses to run while it is.");
  console.log("The thresholds came from another codebase. Measure them against yours, adjust the tool files,");
  console.log("then set calibration_required to false to state that you did.");
}

if (process.argv[1]?.endsWith("import-profile.mjs")) main();
