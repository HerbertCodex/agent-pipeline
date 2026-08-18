import { readFileSync, writeFileSync, existsSync, mkdirSync, cpSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { loadConfig, fail } from "./lib.mjs";

/**
 * Cles de configuration qui decrivent la stack et non ce depot.
 *
 * Le partage entre les deux n'est pas cosmetique. `commands` nomme les
 * outils d'un ecosysteme et vaut pour tout projet qui l'emploie ;
 * `store_dir` ou `ci` decrivent l'endroit ou ce projet-ci range son etat et
 * chez quelle forge il vit. Emporter les seconds installerait chez le
 * suivant des decisions qu'il n'a pas prises.
 */
const STACK_KEYS = ["commands", "project_map", "doc_policy", "comment_policy", "secrets_scan", "file_policy"];

/**
 * Repere les fichiers d'outils qu'une commande designe par leur nom.
 *
 * Une commande exportee sans le fichier qu'elle passe en argument est une
 * commande qui echoue chez le suivant, et l'echec ressemblera a une porte
 * qui refuse alors que c'est un fichier absent — la confusion que
 * `preflight` existe pour lever.
 *
 * Le reperage est volontairement litteral : un jeton qui designe un
 * FICHIER existant est emporte, les autres sont ignores. La nuance a coute
 * un tour : `eslint --config <fichier> .` finit par un point, qui existe et
 * qui est un repertoire. Une commande qui passe par
 * un lanceur de taches ne nomme aucun fichier, et ses fichiers se
 * completent alors en arguments.
 *
 * @param commands - bloc `commands` de la configuration
 * @param root - racine du projet exporte
 * @returns les chemins relatifs reperes, sans doublon
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
 * Exporte le profil actif en paquet reutilisable.
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
