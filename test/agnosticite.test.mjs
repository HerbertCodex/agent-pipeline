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

describe("agnosticism: the framework knows nothing of the project stack", () => {
  test("no core script invokes an ecosystem task runner", () => {
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

  test("no core script depends on an installed package", () => {
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

  test("no core script hardcodes a path the configuration owns", () => {
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

describe("agnosticism: CI separates the core from the stack", () => {
  const template = readFileSync(join(FRAMEWORK, "templates", "ci.template.yml"), "utf8");

  test("every core step runs through node, never a task runner", () => {
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

  test("the stack steps stay a placeholder, never a written command", () => {
    assert.match(template, /\{\{steps\}\}/, "les portes du projet viennent de commands, pas du template");
    assert.match(template, /\{\{install\}\}/, "l'installation appartient a l'ecosysteme du projet");
  });
});

describe("the framework requires a gate on design limits", () => {
  test("apply-profile refuses a configuration with no design_limits", () => {
    const root = createSandbox();
    try {
      const path = join(root, "pipeline.config.json");
      const config = JSON.parse(readFileSync(path, "utf8"));
      config.commands = { check: "true", lint: "true", build: "true", test_unit: "true", audit: "true", secrets_scan: "true", project_map: "true" };
      writeFileSync(path, JSON.stringify(config));
      const result = run(root, "apply-profile.mjs", ["--check"]);
      assert.notEqual(result.status, 0);
      assert.match(result.output, /design_limits missing/);
      assert.match(result.output, /apply to nothing/, "the refusal says why the gate exists, not only that it is missing");
    } finally {
      destroySandbox(root);
    }
  });

  test("it is accepted as soon as it is declared, whatever the tool", () => {
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

describe("the framework requires the code layout to be declared", () => {
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

  test("apply-profile refuses a configuration with no architecture block", () => {
    const root = createSandbox();
    try {
      withArchitecture(root, null);
      const result = run(root, "apply-profile.mjs", ["--check"]);
      assert.notEqual(result.status, 0);
      assert.match(result.output, /architecture missing/);
      assert.match(
        result.output,
        /rendered page binds no agent/,
        "the refusal says why the key exists, not only that it is missing",
      );
    } finally {
      destroySandbox(root);
    }
  });

  test("an unknown layout is refused, and the known ones are named", () => {
    const root = createSandbox();
    try {
      withArchitecture(root, { id: "microservices", project_type: "backend" });
      const result = run(root, "apply-profile.mjs", ["--check"]);
      assert.notEqual(result.status, 0);
      assert.match(result.output, /architecture.id unknown/);
      assert.match(result.output, /feature-modules/, "le refus liste ce qui est accepte");
    } finally {
      destroySandbox(root);
    }
  });

  test("a layout outside the project type is refused", () => {
    const root = createSandbox();
    try {
      withArchitecture(root, { id: "hexagonal", project_type: "frontend" });
      const result = run(root, "apply-profile.mjs", ["--check"]);
      assert.notEqual(result.status, 0);
      assert.match(result.output, /does not apply to a frontend project/);
    } finally {
      destroySandbox(root);
    }
  });

  test("custom is accepted, but only with the note that becomes the reference", () => {
    const root = createSandbox();
    try {
      withArchitecture(root, { id: "custom", project_type: "backend" });
      const sansNote = run(root, "apply-profile.mjs", ["--check"]);
      assert.notEqual(sansNote.status, 0);
      assert.match(sansNote.output, /note describing the layout/);

      withArchitecture(root, { id: "custom", project_type: "backend", note: "un acteur par flux, rien de standard" });
      const avecNote = run(root, "apply-profile.mjs", ["--check"]);
      assert.doesNotMatch(avecNote.output, /architecture/, "le core ne juge pas un rangement qu'il ne connait pas");
    } finally {
      destroySandbox(root);
    }
  });

  test("an invalid project type is refused before any layout choice", () => {
    const root = createSandbox();
    try {
      withArchitecture(root, { id: "feature-modules", project_type: "embarque" });
      const result = run(root, "apply-profile.mjs", ["--check"]);
      assert.notEqual(result.status, 0);
      assert.match(result.output, /project_type invalid/);
    } finally {
      destroySandbox(root);
    }
  });

  test("every catalogue layout carries a real project type", () => {
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
