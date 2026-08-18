import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { loadConfig, sha256, fail } from "./lib.mjs";

/**
 * Longueur par defaut d'un bloc juge duplique.
 *
 * Six lignes significatives : au-dessous, deux fichiers qui se ressemblent
 * sont surtout deux fichiers qui obeissent aux memes conventions. Un seuil
 * plus bas ne produit pas plus de trouvailles, il produit du bruit qu'on
 * apprend a ignorer — et une porte qu'on ignore est deja desactivee.
 */
const DEFAULT_MIN_LINES = 6;

/**
 * Parcourt une racine et rend ses fichiers, moins ceux qui sont ecartes.
 *
 * @param root - repertoire de depart
 * @param skip - expression reguliere de rejet, ou null
 * @param found - accumulateur des chemins retenus
 * @returns les chemins retenus
 */
function walk(root, skip, found = []) {
  let entries;
  try {
    entries = readdirSync(root);
  } catch {
    return found;
  }
  for (const entry of entries) {
    const path = join(root, entry);
    if (skip != null && skip.test(path)) continue;
    if (statSync(path).isDirectory()) walk(path, skip, found);
    else found.push(path);
  }
  return found;
}

/**
 * Reduit un fichier a ses lignes significatives, indentation neutralisee.
 *
 * Un copier-coller est presque toujours reindente en arrivant : le meme
 * bloc pose dans une methode gagne quatre espaces. Comparer les lignes
 * brutes le manquerait, alors que c'est le cas le plus frequent.
 *
 * Les commentaires ne sont PAS retires : les enlever demanderait de
 * connaitre la syntaxe du langage, et ce script n'en connait aucun. Un bloc
 * copie avec son commentaire reste donc detecte, ce qui est le cas utile.
 *
 * @param body - contenu du fichier
 * @returns les lignes normalisees et leur numero d'origine
 */
function significant(body) {
  const lines = [];
  body.split("\n").forEach((raw, index) => {
    const text = raw.trim().replace(/\s+/g, " ");
    if (text.length > 0) lines.push({ text, line: index + 1 });
  });
  return lines;
}

/**
 * Groupe les fenetres identiques de `size` lignes a travers tous les fichiers.
 *
 * @param documents - fichiers normalises
 * @param size - hauteur de la fenetre
 * @returns les groupes d'au moins deux occurrences, par empreinte
 */
function windows(documents, size) {
  const groups = new Map();
  for (const document of documents) {
    for (let start = 0; start + size <= document.lines.length; start += 1) {
      const slice = document.lines.slice(start, start + size);
      const key = sha256(slice.map((entry) => entry.text).join("\n"));
      const at = { path: document.path, start, line: slice[0].line, end: slice[size - 1].line };
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(at);
    }
  }
  return [...groups.values()].filter((occurrences) => occurrences.length > 1);
}

/**
 * Fusionne les fenetres qui glissent sur une meme copie.
 *
 * Une copie de trente lignes produit vingt-cinq fenetres identiques
 * decalees d'une ligne. Les rendre toutes donnerait un mur que personne ne
 * lit, et ferait passer une trouvaille pour vingt-cinq. On ne garde donc
 * qu'une occurrence par region, en retenant la plus longue.
 *
 * @param groups - groupes de fenetres identiques
 * @param size - hauteur de la fenetre
 * @returns les clones, une entree par region dupliquee
 */
function merge(groups, size) {
  const clones = [];
  const claimed = new Map();
  for (const occurrences of groups) {
    const fresh = occurrences.filter((at) => {
      const seen = claimed.get(at.path) ?? [];
      return !seen.some((range) => at.start >= range.from && at.start <= range.to);
    });
    if (fresh.length < 2) continue;
    let span = size;
    while (grows(occurrences, span)) span += 1;
    for (const at of occurrences) {
      const seen = claimed.get(at.path) ?? [];
      seen.push({ from: at.start, to: at.start + span - size });
      claimed.set(at.path, seen);
    }
    clones.push({ lines: span, sites: occurrences.map((at) => ({ path: at.path, line: at.line })) });
  }
  return clones;
}

/**
 * Dit si toutes les occurrences se prolongent d'une ligne identique.
 *
 * @param occurrences - positions du bloc
 * @param span - hauteur atteinte
 * @returns vrai si la ligne suivante est la meme partout
 */
function grows(occurrences, span) {
  const next = occurrences.map((at) => at.document.lines[at.start + span]?.text ?? null);
  return next[0] != null && next.every((text) => text === next[0]);
}

/**
 * Cherche les blocs dupliques et rend un verdict.
 */
function main() {
  const asJson = process.argv.includes("--json");
  const config = loadConfig();
  const settings = config.duplication;
  if (settings?.roots == null || !Array.isArray(settings.roots) || settings.roots.length === 0) {
    fail(
      "duplication.roots missing: name the directories to scan. The framework does not guess them, " +
        "because a scan of the wrong tree is green for the wrong reason.",
    );
  }

  const size = Number.isInteger(settings.min_lines) ? settings.min_lines : DEFAULT_MIN_LINES;
  const skip = typeof settings.skip === "string" ? new RegExp(settings.skip) : null;
  const documents = [];
  for (const root of settings.roots) {
    for (const path of walk(root, skip)) {
      const lines = significant(readFileSync(path, "utf8"));
      if (lines.length >= size) documents.push({ path: relative(".", path), lines });
    }
  }
  if (documents.length === 0) {
    fail(`no file to scan under ${settings.roots.join(", ")}: an empty scan is a misconfiguration, not a clean result.`);
  }

  const groups = windows(documents, size).map((occurrences) =>
    occurrences.map((at) => ({ ...at, document: documents.find((document) => document.path === at.path) })),
  );
  const clones = merge(groups, size);

  if (asJson) {
    console.log(JSON.stringify({ files: documents.length, min_lines: size, clones }, null, 2));
    process.exit(clones.length === 0 ? 0 : 1);
  }

  if (clones.length === 0) {
    console.log(`duplication: ${documents.length} file(s) scanned, no block of ${size}+ lines repeated.`);
    return;
  }

  for (const clone of clones) {
    console.log(`${clone.lines} lines repeated in ${clone.sites.length} places:`);
    for (const site of clone.sites) console.log(`  ${site.path}:${site.line}`);
  }
  console.log("");
  console.log("Extract what repeats into one shared unit and reuse it, or say in the handoff why the");
  console.log("two copies must stay apart. This is the reuse note made checkable: until now it was");
  console.log("judged in review, which means it was judged when someone remembered to look.");
  process.exit(1);
}

if (process.argv[1]?.endsWith("duplication.mjs")) main();
