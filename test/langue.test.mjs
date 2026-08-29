import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const FRAMEWORK = join(here, "..");

/**
 * Nom de ce fichier, seule exclusion des balayages.
 *
 * Le controle porte les mots qu'il refuse : son propre source se
 * denoncerait. Nommer l'exclusion vaut mieux que tordre le motif pour ne
 * pas se voir, une expression contournee finissant par ne plus rien voir.
 */
const SELF = "langue.test.mjs";

/**
 * Mots outils francais absents du vocabulaire anglais courant.
 *
 * La detection ne peut pas s'appuyer sur les accents : les scripts n'en
 * portent pas, precisement pour survivre a un terminal pauvre. Ce sont donc
 * les mots de liaison qui trahissent la langue, et eux seuls sont fiables :
 * un nom commun peut etre un identifiant, un mot outil ne l'est jamais.
 */
const FRENCH = [
  "aucune", "aucun", "avec", "cette", "chaque", "dans", "depuis", "doit",
  "elle", "est", "etre", "fichier", "fichiers", "introuvable", "invalide",
  "jamais", "lancer", "leur", "manquant", "manquante", "mais", "pas",
  "porte", "pour", "quand", "racine", "sans", "seul", "sont",
  "sous", "toujours", "tous", "vers", "vide",
  "attendu", "attendue", "choix", "decoupage", "ecrit", "ecriture", "liste",
  "metier", "optimiste", "perime", "perimetre", "recue", "regle", "regles",
  "verrou", "exige", "titre", "statut", "inconnu", "inconnue",
  "resolue", "resolu", "attendu", "attendue", "libelle", "supprime", "ajoute", "constate",
  "aux", "ainsi", "ces", "cela", "des", "donc", "et", "les", "ses", "une",
  "applique", "profil", "synchronise", "synchronises", "reussi", "termine",
  "approbation", "illisible", "ouverte", "ouvertes", "precedente", "prevue",
  "prevues", "valide", "motif", "mesures", "escalade", "escalades", "ferme", "valides", "rendu", "rendue", "amorce", "seme",
  "cible", "echappee", "echappees", "empreinte", "fonctionnalite",
  "fonctionnalites", "generee", "generees", "serialisee", "serialisees",
  // Les mots les plus courants de la langue etaient absents, et c'est par eux
  // que le francais est revenu : « repertoire de documents not found », « ##
  // Commandes du projet », « le document source fait foi » ne portaient aucun
  // des mots ci-dessus. Ils sont ecartes de l'anglais et du code par les
  // bornes de mot : `questionnaire` ne contient pas `que`.
  "de", "du", "la", "le", "ou", "que", "qui", "sur", "par", "faut",
  "projet", "repertoire", "commandes", "executer", "conflit", "doute",
  "foi", "deja",
];

const WORDS = new RegExp(`(?<![-\\w])(${FRENCH.join("|")})\\b(?![-\\w])`, "i");

/**
 * Confronte une chaine aux mots outils francais.
 *
 * Ce qu'elle ne fait PAS : deviner. Les terminaisons ont ete essayees et
 * retirees — `guarantee` et `questionnaire` sont anglais, et une porte qui
 * refuse de l'anglais est desactivee le lendemain. La liste a donc une
 * traine longue : chaque mot qui fuit s'ajoute apres coup, et c'est la
 * limite assumee de ce controle.
 *
 * @param text - chaine a examiner
 * @returns le fragment francais trouve, ou null
 */
function frenchIn(text) {
  const word = text.match(WORDS);
  return word == null ? null : word[1];
}

/**
 * Le mot francais ne compte pas s'il est suivi d'un trait d'union : `sans-serif`
 * est une valeur CSS, pas une phrase. Sans cette reserve la porte refuserait
 * une feuille de style, donc deviendrait impossible a satisfaire.
 */

/**
 * Retire commentaires et TSDoc d'un source.
 *
 * @param source - contenu du fichier
 * @returns le source prive de ses commentaires
 */
function codeOnly(source) {
  return source.replaceAll(/\/\*[\s\S]*?\*\//g, "").replaceAll(/^\s*\/\/.*$/gm, "");
}

/**
 * Extrait les chaines qu'un utilisateur finit par lire.
 *
 * Toute chaine portant une espace est retenue, pas seulement celles passees a
 * fail ou a console : un message pousse dans un tableau d'erreurs finit
 * imprime lui aussi. La premiere version de ce controle ne lisait que les
 * appels directs et laissait passer « hors role » dans verify-scope.
 *
 * @param source - contenu du fichier
 * @returns les chaines passees a fail ou a console
 */
function userFacing(source) {
  const found = [];
  for (const m of codeOnly(source).matchAll(/(["'`])((?:[^\\]|\\.)*?)\1/g)) {
    if (m[2].includes(" ")) found.push(m[2]);
  }
  return found;
}

/**
 * Extrait les intitules de suites et de cas de test.
 *
 * @param source - contenu du fichier
 * @returns les intitules declares
 */
function testTitles(source) {
  return [...codeOnly(source).matchAll(/\b(?:describe|test|it)\(\s*(["'`])([\s\S]*?)\1/g)].map((m) => m[2]);
}

/**
 * Removes string literals from a source.
 *
 * A glob ending a path with a star and a slash opens a comment as far as a
 * regular expression is concerned: everything up to the next closing marker
 * was then read as one, and a file declaring reservations was reported as
 * French because of an issue title three functions below. Stripping the
 * literals first is what makes the extractor read code rather than text
 * that looks like code.
 *
 * @param source - file contents
 * @returns the same source, its string literals blanked out
 */
function withoutStrings(source) {
  return source.replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""');
}

/**
 * Extracts the comment blocks of a source.
 *
 * They were excluded from the sweeps until 2026-08-18, on the grounds that a
 * comment is not output. That was false in practice: they are the first
 * lines anyone opening a script reads, and with nothing holding it back,
 * French came back in every file written.
 *
 * @param source - file contents
 * @returns the comment blocks, one per entry
 */
function comments(source) {
  const code = withoutStrings(source);
  return [...code.matchAll(/\/\*[\s\S]*?\*\//g), ...code.matchAll(/^\s*\/\/.*$/gm)].map((match) => match[0]);
}

describe("the framework speaks one language", () => {
  test("no user-facing message is in French", () => {
    const offenders = [];
    for (const directory of ["scripts", "dashboard"]) {
      for (const name of readdirSync(join(FRAMEWORK, directory)).filter((f) => f.endsWith(".mjs"))) {
        for (const line of userFacing(readFileSync(join(FRAMEWORK, directory, name), "utf8"))) {
          const hit = frenchIn(line);
          if (hit != null) offenders.push(`${directory}/${name} : « ${line.slice(0, 60)} » (${hit})`);
        }
      }
    }
    assert.deepEqual(
      offenders.slice(0, 12),
      [],
      `${offenders.length} message(s) en francais. Les documents sont en anglais : un lecteur qui suit ` +
        "le guide et recoit un refus dans une autre langue doit deviner s'il a mal lu ou mal fait.",
    );
  });

  test("no test title is in French", () => {
    const offenders = [];
    for (const name of readdirSync(join(FRAMEWORK, "test")).filter((f) => f.endsWith(".mjs"))) {
      if (name === SELF) continue;
      for (const title of testTitles(readFileSync(join(FRAMEWORK, "test", name), "utf8"))) {
        const hit = frenchIn(title);
        if (hit != null) offenders.push(`${name} : « ${title.slice(0, 60)} » (${hit})`);
      }
    }
    assert.deepEqual(
      offenders.slice(0, 12),
      [],
      `${offenders.length} intitule(s) en francais. La sortie des tests est ce qu'un contributeur lit en premier.`,
    );
  });

  test("no document is in French", () => {
    const offenders = [];
    for (const directory of ["docs", "templates", "prompts"]) {
      for (const name of readdirSync(join(FRAMEWORK, directory)).filter((f) => f.endsWith(".md"))) {
        const body = readFileSync(join(FRAMEWORK, directory, name), "utf8");
        if (/[éèàçùôêîœ]/.test(body)) offenders.push(`${directory}/${name}`);
      }
    }
    assert.deepEqual(offenders, [], "les documents du cadre sont en anglais");
  });

  test("no script comment is in French", () => {
    const offenders = [];
    for (const directory of ["scripts", "dashboard", "test"]) {
      for (const name of readdirSync(join(FRAMEWORK, directory)).filter((f) => f.endsWith(".mjs"))) {
        if (name === SELF) continue;
        for (const block of comments(readFileSync(join(FRAMEWORK, directory, name), "utf8"))) {
          const hit = frenchIn(block);
          if (hit != null) offenders.push(`${directory}/${name} (${hit})`);
        }
      }
    }
    assert.deepEqual(
      [...new Set(offenders)].slice(0, 10),
      [],
      `${offenders.length} block(s) in French. A comment is the first thing anyone opening a script ` +
        "reads: a repository whose documents are in one language and whose reasoning is in another " +
        "asks its reader to know both.",
    );
  });

  test("the detector does not fire on ordinary English", () => {
    const english = [
      "gate refused: the declared scope does not match the diff",
      "store is out of date, re-read the record and try again",
      "usage: verify-scope.mjs <handoff.json> <base-ref>",
      "every gate must fail at least once before you trust it",
      "${path} does not refuse: the platform allows what file_policy forbids",
      "the analysis must carry business_rules, even empty",
      "font-family:ui-sans-serif,system-ui,Roboto,sans-serif",
      "unknown project type: expected one of backend, frontend",
      "written: 3 files, 2 sections, gates green",
      "see the questionnaire, then the committee guarantee for each employee",
      "renders a page and counts the features it carries",
      "3 named exclusions and 2 design engagements, per the proposition",
      "a sortie against precedent, tranche by tranche, until cloture",
    ];
    const wrong = english.filter((line) => frenchIn(line) != null);
    assert.deepEqual(wrong, [], "un detecteur qui refuse de l'anglais rendrait la porte impossible a satisfaire");
  });

  test("stripping the literals did not blind the extractor", () => {
    // The false positive fixed here came from a glob, so the witness carries
    // one: the comment must still be found with a string beside it that ends
    // in a star and a slash.
    const source = [
      'const policy = { allow: ["src/**", "docs/**"] };',
      "// une regle que rien ne fait mordre s'annule toute seule",
      'const title = "issue de test";',
    ].join("\n");
    const blocks = comments(source);
    assert.equal(blocks.length, 1, `blocs extraits : ${JSON.stringify(blocks)}`);
    assert.equal(frenchIn(blocks[0]), "une");
  });
});
