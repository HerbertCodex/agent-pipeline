import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { createSandbox, destroySandbox, run } from "./harness.mjs";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const FRAMEWORK = join(here, "..");
const SCRIPTS = join(FRAMEWORK, "scripts");
const TESTS = here;

/**
 * Nom de ce fichier, seule exclusion des balayages ci-dessous.
 *
 * Un controle doit nommer ce qu'il refuse, donc son propre source contient
 * les motifs interdits et se denoncerait lui-meme. L'exclusion est nommee
 * plutot que le motif tordu : une expression contournee pour ne pas se voir
 * finit par ne plus voir non plus ce qu'elle cherche.
 */
const SELF = "agnosticite.test.mjs";

/**
 * Lit tous les fichiers d'un repertoire du framework.
 *
 * @param directory - repertoire a parcourir
 * @param suffix - extension retenue
 * @returns les couples nom de fichier et contenu
 */
function filesIn(directory, suffix = ".mjs") {
  return readdirSync(directory)
    .filter((name) => name.endsWith(suffix))
    .map((name) => [name, readFileSync(join(directory, name), "utf8")]);
}

/**
 * Retire les blocs de commentaire et les lignes de commentaire d'un source.
 *
 * Une consigne peut legitimement citer un outil de projet en prose ; seule
 * une invocation reelle est un couplage. Comparer sur le code seul evite de
 * transformer la porte en interdiction d'ecrire de la documentation.
 *
 * @param source - contenu du fichier
 * @returns le source prive de ses commentaires
 */
function codeOnly(source) {
  return source.replaceAll(/\/\*[\s\S]*?\*\//g, "").replaceAll(/^\s*\/\/.*$/gm, "");
}

describe("agnosticite : le framework ne connait pas la stack du projet", () => {
  test("aucun script du core n'invoque le lanceur de taches d'un ecosysteme", () => {
    const offenders = [];
    for (const [name, source] of [...filesIn(SCRIPTS), ...filesIn(TESTS)]) {
      if (name === SELF) continue;
      const match = codeOnly(source).match(/npm run|npx |yarn |pnpm |\bpoetry run\b|\bcargo run\b/);
      if (match != null) offenders.push(`${name} : ${match[0].trim()}`);
    }
    assert.deepEqual(
      offenders,
      [],
      "un projet Python, Go ou Rust n'a pas de package.json : le core doit tourner sans lanceur de taches",
    );
  });

  test("aucun script du core ne depend d'un paquet installe", () => {
    const offenders = [];
    for (const [name, source] of filesIn(SCRIPTS)) {
      for (const match of source.matchAll(/^\s*import[^;]*?from\s+"([^"]+)"/gm)) {
        const target = match[1];
        const builtin = target.startsWith("node:");
        const sibling = target.startsWith("./") || target.startsWith("../");
        if (!builtin && !sibling) offenders.push(`${name} : ${target}`);
      }
    }
    assert.deepEqual(offenders, [], "le core ne s'installe pas : il n'importe que des modules natifs et ses voisins");
  });

  test("aucun script du core n'ecrit en dur un chemin que la configuration possede", () => {
    const owned = /"pipeline\/(rules\.json|store|briefs|profiles)/;
    const offenders = [];
    for (const [name, source] of filesIn(SCRIPTS)) {
      const match = codeOnly(source).match(owned);
      if (match != null) offenders.push(`${name} : ${match[0]}`);
    }
    assert.deepEqual(
      offenders,
      [],
      "rules_path, store_dir, briefs_dir et profiles_dir sont configurables : les supposer ne marche que sur un projet qui a garde les defauts",
    );
  });
});

describe("agnosticite : la CI separe le core de la stack", () => {
  const template = readFileSync(join(FRAMEWORK, "templates", "ci.template.yml"), "utf8");

  test("chaque etape du core s'execute par node, jamais par un lanceur de taches", () => {
    const lines = template.split("\n");
    const offenders = [];
    for (const [index, line] of lines.entries()) {
      const named = line.match(/- name: (core-tests|briefs-sync|profile-sync|store-invariants)/);
      if (named == null) continue;
      const command = (lines[index + 1] ?? "").trim();
      if (!command.startsWith("run: node")) offenders.push(`${named[1]} : ${command}`);
    }
    assert.deepEqual(offenders, [], "les etapes du core ne passent jamais par la stack du projet");
  });

  test("les etapes de la stack restent un emplacement a remplir, jamais une commande ecrite", () => {
    assert.match(template, /\{\{steps\}\}/, "les portes du projet viennent de commands, pas du template");
    assert.match(template, /\{\{install\}\}/, "l'installation appartient a l'ecosysteme du projet");
  });
});

describe("le cadre exige une porte sur les bornes de conception", () => {
  test("apply-profile refuse une configuration sans design_limits", () => {
    const root = createSandbox();
    try {
      const path = join(root, "pipeline.config.json");
      const config = JSON.parse(readFileSync(path, "utf8"));
      config.commands = { check: "true", lint: "true", build: "true", test_unit: "true", audit: "true", secrets_scan: "true", project_map: "true" };
      writeFileSync(path, JSON.stringify(config));
      const result = run(root, "apply-profile.mjs", ["--check"]);
      assert.notEqual(result.status, 0);
      assert.match(result.output, /design_limits manquante/);
      assert.match(result.output, /s'auto-annulent/, "le refus dit pourquoi la porte existe, pas seulement qu'elle manque");
    } finally {
      destroySandbox(root);
    }
  });

  test("elle est acceptee des qu'elle est declaree, quel que soit l'outil", () => {
    const root = createSandbox();
    try {
      const path = join(root, "pipeline.config.json");
      const config = JSON.parse(readFileSync(path, "utf8"));
      config.commands = { check: "true", lint: "true", build: "true", test_unit: "true", audit: "true", secrets_scan: "true", project_map: "true", design_limits: "gocyclo -over 8 ." };
      writeFileSync(path, JSON.stringify(config));
      const result = run(root, "apply-profile.mjs", ["--check"]);
      assert.doesNotMatch(result.output, /design_limits/, "le core ne juge pas l'outil, seulement la presence de la cle");
    } finally {
      destroySandbox(root);
    }
  });
});
