import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { createSandbox, destroySandbox, run } from "./harness.mjs";
import { fileURLToPath } from "node:url";
import { ARCHITECTURES, PROJECT_TYPES } from "../scripts/architectures.mjs";

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

describe("le cadre exige que le rangement du code soit declare", () => {
  /**
   * Ecrit une configuration bac a sable dont le bloc architecture est impose.
   *
   * @param root - racine du bac a sable
   * @param architecture - valeur a poser, ou null pour retirer la cle
   */
  function withArchitecture(root, architecture) {
    const path = join(root, "pipeline.config.json");
    const config = JSON.parse(readFileSync(path, "utf8"));
    config.commands = {
      check: "true", lint: "true", build: "true", test_unit: "true",
      audit: "true", secrets_scan: "true", project_map: "true", design_limits: "true",
    };
    if (architecture == null) delete config.architecture;
    else config.architecture = architecture;
    writeFileSync(path, JSON.stringify(config));
  }

  test("apply-profile refuse une configuration sans bloc architecture", () => {
    const root = createSandbox();
    try {
      withArchitecture(root, null);
      const result = run(root, "apply-profile.mjs", ["--check"]);
      assert.notEqual(result.status, 0);
      assert.match(result.output, /architecture manquante/);
      assert.match(
        result.output,
        /page HTML n'engage aucun agent/,
        "le refus dit pourquoi la cle existe, pas seulement qu'elle manque",
      );
    } finally {
      destroySandbox(root);
    }
  });

  test("un rangement inconnu est refuse, et les connus sont nommes", () => {
    const root = createSandbox();
    try {
      withArchitecture(root, { id: "microservices", project_type: "backend" });
      const result = run(root, "apply-profile.mjs", ["--check"]);
      assert.notEqual(result.status, 0);
      assert.match(result.output, /architecture\.id inconnu/);
      assert.match(result.output, /feature-modules/, "le refus liste ce qui est accepte");
    } finally {
      destroySandbox(root);
    }
  });

  test("un rangement hors du type de projet est refuse", () => {
    const root = createSandbox();
    try {
      withArchitecture(root, { id: "hexagonal", project_type: "frontend" });
      const result = run(root, "apply-profile.mjs", ["--check"]);
      assert.notEqual(result.status, 0);
      assert.match(result.output, /ne s'applique pas a un projet frontend/);
    } finally {
      destroySandbox(root);
    }
  });

  test("custom est accepte, mais seulement avec la note qui devient la reference", () => {
    const root = createSandbox();
    try {
      withArchitecture(root, { id: "custom", project_type: "backend" });
      const sansNote = run(root, "apply-profile.mjs", ["--check"]);
      assert.notEqual(sansNote.status, 0);
      assert.match(sansNote.output, /note qui decrit le rangement retenu/);

      withArchitecture(root, { id: "custom", project_type: "backend", note: "un acteur par flux, rien de standard" });
      const avecNote = run(root, "apply-profile.mjs", ["--check"]);
      assert.doesNotMatch(avecNote.output, /architecture/, "le core ne juge pas un rangement qu'il ne connait pas");
    } finally {
      destroySandbox(root);
    }
  });

  test("un type de projet invalide est refuse avant tout choix de rangement", () => {
    const root = createSandbox();
    try {
      withArchitecture(root, { id: "feature-modules", project_type: "embarque" });
      const result = run(root, "apply-profile.mjs", ["--check"]);
      assert.notEqual(result.status, 0);
      assert.match(result.output, /project_type invalide/);
    } finally {
      destroySandbox(root);
    }
  });

  test("chaque rangement du catalogue porte un type de projet reel", () => {
    const types = new Set(Object.keys(PROJECT_TYPES));
    const offenders = [];
    for (const item of ARCHITECTURES) {
      for (const applies of item.applies) {
        if (!types.has(applies)) offenders.push(`${item.id} : ${applies}`);
      }
    }
    assert.deepEqual(offenders, [], "la porte compare a PROJECT_TYPES : un type fantome rendrait un choix valide irrefusable");
  });
});
