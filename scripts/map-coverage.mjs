import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, fail } from "./lib.mjs";

/**
 * Rend tous les fichiers d'une racine, recursivement.
 *
 * @param dir - repertoire a parcourir
 * @returns les chemins relatifs au depot
 */
function walk(dir) {
  if (!existsSync(dir)) return [];
  let out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out = out.concat(walk(path));
    else out.push(path);
  }
  return out;
}

/**
 * Verifie que la carte du projet cite reellement le code qu'elle pretend couvrir.
 *
 * La porte `project_map` compare la carte rendue a sa regeneration : elle
 * attrape une carte perimee, jamais une carte vide. Un generateur qui ne
 * collecte pas les bons fichiers — celui du projet d'origine cherchait `*.ts`,
 * inutilisable des que la stack change — rend un document quasi vide, et
 * `--check` compare vide a vide et sort en 0. On obtient une porte verte qui
 * n'affirme rien, pire qu'une porte absente puisqu'on cesse de verifier.
 *
 * Ce controle ferme ce cas sans rien connaitre du langage : pour chaque
 * fichier de source sous `project_map.roots`, il exige que son nom apparaisse
 * quelque part dans la carte rendue. Il ne lit pas le format de la carte, il
 * n'analyse aucun code.
 *
 * L'appariement porte sur le nom de fichier et non sur le chemin complet,
 * parce qu'une carte peut legitimement grouper par repertoire et ne citer que
 * les noms — c'est le cas de celle du profil d'origine. Deux fichiers homonymes
 * dans deux repertoires rendent donc le controle indulgent plutot que faux :
 * pour une porte dont le role est d'attraper une carte vide, une fausse alerte
 * couterait plus cher qu'une indulgence.
 *
 * Usage : node map-coverage.mjs [--json]
 */
function main() {
  const config = loadConfig();
  const map = config.project_map ?? {};
  const out = map.out;
  if (typeof out !== "string") fail("project_map.out manquante dans la configuration");
  if (!existsSync(out)) fail(`carte introuvable : ${out}. La regenerer avant de la verifier.`);

  const roots = map.roots ?? ["src"];
  const skip = map.skip == null ? null : new RegExp(map.skip);
  const rendered = readFileSync(out, "utf8");

  const sources = roots
    .flatMap((root) => walk(root))
    .filter((path) => skip == null || !skip.test(path))
    .sort();

  if (sources.length === 0) {
    fail(
      `aucun fichier de source sous ${roots.join(", ")} : la carte ne peut rien couvrir. ` +
        `Verifier project_map.roots et project_map.skip.`,
    );
  }

  const missing = sources.filter((path) => {
    const name = path.split("/").pop();
    return !rendered.includes(path) && !rendered.includes(name);
  });

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ out, sources: sources.length, missing }, null, 2));
    if (missing.length > 0) process.exit(1);
    return;
  }

  if (missing.length > 0) {
    console.error(`${out} ne cite pas ${missing.length} fichier(s) sur ${sources.length} :`);
    for (const path of missing) console.error(`  ${path}`);
    fail(
      "Une carte qui ne cite pas le code ne repond pas a « est-ce que ca existe deja ? ». " +
        "Verifier que le generateur collecte bien les fichiers de cette stack.",
    );
  }

  console.log(`${out} cite les ${sources.length} fichiers de ${roots.join(", ")}.`);
}

main();
