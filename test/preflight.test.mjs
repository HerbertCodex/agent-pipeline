import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createSandbox, destroySandbox, run } from "./harness.mjs";
import { classify } from "../scripts/preflight.mjs";

let sandbox = null;
afterEach(() => {
  if (sandbox != null) destroySandbox(sandbox);
  sandbox = null;
});

/**
 * Ecrit un jeu de commandes dans la configuration du bac a sable.
 *
 * @param commands - portes a declarer
 * @returns le chemin du bac a sable
 */
function withCommands(commands) {
  sandbox = createSandbox();
  const path = join(sandbox, "pipeline.config.json");
  const config = JSON.parse(readFileSync(path, "utf8"));
  config.commands = commands;
  writeFileSync(path, JSON.stringify(config));
  return sandbox;
}

describe("preflight : distinguer un outil absent d'un vrai constat", () => {
  test("une porte verte est verte", () => {
    assert.equal(classify("k", "true").verdict, "verte");
  });

  test("une porte qui refuse est classee refusante, pas indisponible", () => {
    const result = classify("k", "echo 'secret trouve a la ligne 12' ; exit 1");
    assert.equal(result.verdict, "refuse");
    assert.match(result.detail, /secret trouve/);
  });

  test("un outil qui n'existe pas est classe indisponible", () => {
    const result = classify("k", "outil-qui-nexiste-vraiment-pas --version");
    assert.equal(result.verdict, "indisponible", "un binaire absent n'est pas un constat");
  });

  test("un chemin de script inexistant est classe indisponible", () => {
    assert.equal(classify("k", "node /absent/vraiment/pas-la.mjs").verdict, "indisponible");
  });
});

describe("preflight : ce qu'il rend a l'operateur", () => {
  test("il sort en 0 et le dit quand tout est executable", () => {
    const root = withCommands({ check: "true", lint: "true" });
    const result = run(root, "preflight.mjs");
    assert.equal(result.status, 0);
    assert.match(result.output, /toutes les portes declarees sont executables/);
    assert.match(result.output, /jamais un outil manquant/);
  });

  test("il sort en 1 et nomme les portes injouables", () => {
    const root = withCommands({ check: "true", secrets_scan: "outil-absent-xyz" });
    const result = run(root, "preflight.mjs");
    assert.notEqual(result.status, 0);
    assert.match(result.output, /secrets_scan/);
    assert.match(result.output, /echouent au lieu de proteger/);
  });

  test("une porte qui refuse ne fait PAS echouer le controle", () => {
    const root = withCommands({ check: "true", lint: "exit 1" });
    const result = run(root, "preflight.mjs");
    assert.equal(result.status, 0, "preflight verifie l'executabilite, il ne rejoue pas les portes");
    assert.match(result.output, /refuse/);
  });

  test("il propose les deux sorties honnetes, jamais de laisser rouge", () => {
    const root = withCommands({ secrets_scan: "outil-absent-xyz" });
    const result = run(root, "preflight.mjs");
    assert.match(result.output, /Installez l'outil, ou retirez la cle/);
  });

  test("la forme machine liste les portes manquantes", () => {
    const root = withCommands({ check: "true", sast: "outil-absent-xyz" });
    const result = run(root, "preflight.mjs", ["--json"]);
    const parsed = JSON.parse(result.stdout);
    assert.deepEqual(parsed.missing, ["sast"]);
  });

  test("refuse une configuration sans aucune commande", () => {
    const root = withCommands({});
    const result = run(root, "preflight.mjs");
    assert.notEqual(result.status, 0);
    assert.match(result.output, /aucune commande declaree/);
  });
});
