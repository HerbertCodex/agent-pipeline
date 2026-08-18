import { readFileSync, existsSync } from "node:fs";
import { fail } from "./lib.mjs";

/**
 * Confronte un graphe de dependances aux signes qui annoncent un changement
 * d'architecture.
 *
 * Le framework juge, il n'extrait pas : lire des imports demande de connaitre
 * un langage, et le core n'en connait aucun. Le projet fournit donc le graphe
 * sous une forme neutre — des modules, leurs fichiers, ce qu'ils importent —
 * et cette frontiere est ce qui rend le detecteur portable.
 *
 * Ce qu'il ne voit PAS, et qu'il dit : la duplication SEMANTIQUE d'une regle
 * metier. Deux modules qui appliquent la meme regle avec un code different
 * sont invisibles a un graphe d'imports. Ce declencheur-la reste humain, et
 * le pretendre couvert serait pire que de ne pas le chercher.
 *
 * Usage : node architecture-drift.mjs <graphe.json>
 */

/**
 * Taille en dessous de laquelle les signaux de partage ne veulent rien dire.
 *
 * Un fichier partage n'ayant qu'un consommateur est un signe seulement si le
 * projet compte assez de modules pour qu'il ait PU en avoir plusieurs. Sur
 * trois modules, ce signal se declenche systematiquement et a tort — et un
 * detecteur qui crie sur un projet jeune apprend surtout a etre ignore.
 */
const MATURITE = { modules: 4, fichiers: 20 };

/**
 * Detecte les cycles de dependance entre modules.
 *
 * @param modules - graphe des modules
 * @returns les paires en cycle, chacune une seule fois
 */
function cycles(modules) {
  const found = [];
  for (const [name, node] of Object.entries(modules)) {
    for (const target of node.imports ?? []) {
      if ((modules[target]?.imports ?? []).includes(name) && name < target) {
        found.push([name, target]);
      }
    }
  }
  return found;
}

/**
 * Rend les signaux constates sur un graphe.
 *
 * @param graph - graphe fourni par le projet
 * @returns la liste des signaux, chacun avec son declencheur et sa suite
 */
export function drift(graph) {
  const all = graph.modules ?? {};
  const root = graph.composition_root ?? null;
  const modules = Object.fromEntries(Object.entries(all).filter(([name]) => name !== root));
  const names = Object.keys(modules);
  const signals = [];
  const total = names.reduce((sum, name) => sum + (modules[name].files ?? 0), 0);
  const mature = names.length >= MATURITE.modules && total >= MATURITE.fichiers;

  for (const [name, node] of Object.entries(modules)) {
    const out = (node.imports ?? []).length;
    if (out >= 3) {
      signals.push({
        level: "attention",
        signal: `Le module « ${name} » importe ${out} autres modules.`,
        means: "Un module qui connait tout le monde est soit un orchestrateur deguise, soit le signe que le decoupage suit la technique et non le sujet.",
        next: "Regardez s'il porte une responsabilite qui appartient ailleurs, avant d'envisager un autre rangement.",
      });
    }
  }

  for (const [a, b] of cycles(modules)) {
    signals.push({
      level: "grave",
      signal: `« ${a} » et « ${b} » s'importent mutuellement.`,
      means: "Le decoupage est faux a cet endroit : ces deux modules n'en sont qu'un, ou il leur manque un troisieme qui porte ce qu'ils partagent.",
      next: "Sortez ce qu'ils partagent dans un module a part. Ne resolvez pas le cycle par une reference differee : elle cache le probleme sans le traiter.",
    });
  }

  const shared = mature ? (graph.shared ?? {}) : {};
  for (const [file, users] of Object.entries(shared)) {
    if (users.length === 1) {
      signals.push({
        level: "menage",
        signal: `« ${file} » est partage mais n'est utilise que par « ${users[0]} ».`,
        means: "Un partage a un seul consommateur n'est pas un partage, c'est un fichier range trop loin de son usage.",
        next: `Ramenez-le dans « ${users[0]} ». Il redeviendra partage le jour ou un second module en aura besoin.`,
      });
    }
    if (users.length >= 3) {
      signals.push({
        level: "attention",
        signal: `« ${file} » est utilise par ${users.length} modules.`,
        means: "Un fichier que tout le monde importe est un point de contention : chaque issue qui le touche se serialise contre les autres.",
        next: "Verifiez qu'il ne melange pas plusieurs responsabilites. S'il en melange, decoupez-le ; sinon c'est sain.",
      });
    }
  }

  const sharedSize = graph.shared_files ?? Object.keys(shared).length;
  if (mature && total > 0 && sharedSize / total > 0.3) {
    signals.push({
      level: "attention",
      signal: `Le partage represente ${Math.round((sharedSize / total) * 100)} % des fichiers.`,
      means: "Au-dela d'un tiers, le dossier partage n'est plus un socle : c'est le fourre-tout ou atterrit ce qu'on n'a pas su ranger.",
      next: "Reprenez ses fichiers un par un et demandez qui les utilise vraiment.",
    });
  }

  const sizes = names.map((name) => modules[name].files ?? 0).filter((n) => n > 0);
  if (mature && sizes.length >= 2) {
    const biggest = Math.max(...sizes);
    const median = [...sizes].sort((a, b) => a - b)[Math.floor(sizes.length / 2)];
    if (median > 0 && biggest >= median * 3) {
      const name = names.find((candidate) => (modules[candidate].files ?? 0) === biggest);
      signals.push({
        level: "attention",
        signal: `« ${name} » est ${Math.round(biggest / median)} fois plus gros que le module median.`,
        means: "Un module tres au-dessus des autres porte souvent plusieurs sujets, ou merite sa propre structure interne.",
        next: "Durcissez CE module seul — c'est ce que permet le rangement par fonctionnalite. Ne changez pas l'architecture de tout le projet pour un dossier.",
      });
    }
  }

  return { signals, mature, modules: names.length, files: total, root };
}

function main() {
  const [path] = process.argv.slice(2);
  if (!path) fail("usage : architecture-drift.mjs <graphe.json>");
  if (!existsSync(path)) fail(`graphe introuvable : ${path}`);
  const graph = JSON.parse(readFileSync(path, "utf8"));
  if (graph.modules == null) fail("le graphe doit porter modules : { nom: { files, imports } }");

  const { signals, mature, modules, files, root } = drift(graph);
  if (root != null) {
    console.log(`racine de composition exclue : « ${root} » importe legitimement tout le monde, c'est son role.\n`);
  }
  if (!mature) {
    console.log(
      `projet jeune : ${modules} module(s), ${files} fichier(s). Les signaux de partage restent en veille ` +
        `jusqu'a ${MATURITE.modules} modules et ${MATURITE.fichiers} fichiers.`,
    );
    console.log("Un partage a un seul consommateur n'est un signe que si le projet a eu l'occasion d'en avoir plusieurs.\n");
  }
  if (signals.length === 0) {
    console.log("aucun signe de derive : le decoupage tient.");
  } else {
    for (const item of signals) {
      console.log(`[${item.level}] ${item.signal}\n         ${item.means}\n         -> ${item.next}`);
    }
  }
  console.log(
    "\nnon detectable ici : deux modules qui appliquent la MEME regle metier avec un code different.",
  );
  console.log("Un graphe d'imports ne voit pas le sens. Ce declencheur-la se constate en relisant, pas en calculant.");
}

if (process.argv[1]?.endsWith("architecture-drift.mjs")) main();
