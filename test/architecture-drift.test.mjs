import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createSandbox, destroySandbox, run } from "./harness.mjs";
import { drift } from "../scripts/architecture-drift.mjs";

let sandbox = null;
afterEach(() => {
  if (sandbox != null) destroySandbox(sandbox);
  sandbox = null;
});

/**
 * Construit un graphe de N modules de taille donnee, sans dependance.
 *
 * @param count - nombre de modules
 * @param filesEach - fichiers par module
 * @returns le graphe
 */
function grid(count, filesEach) {
  const modules = {};
  for (let index = 0; index < count; index += 1) modules[`m${index}`] = { files: filesEach, imports: [] };
  return { modules };
}

/**
 * Lance le detecteur sur un graphe ecrit dans le bac a sable.
 *
 * @param graph - graphe a juger
 * @returns le resultat d'execution
 */
function inspect(graph) {
  sandbox ??= createSandbox();
  const path = join(sandbox, "graphe.json");
  writeFileSync(path, JSON.stringify(graph));
  return run(sandbox, "architecture-drift.mjs", [path]);
}

describe("architecture-drift : il se tait sur un projet jeune", () => {
  test("les signaux de partage restent en veille en dessous du seuil", () => {
    const graph = { ...grid(2, 3), shared: { "socle/base": ["m0"] } };
    const { signals, mature } = drift(graph);
    assert.equal(mature, false);
    assert.deepEqual(signals, [], "un partage a un consommateur n'est pas un signe sur deux modules");
  });

  test("le meme graphe, une fois le projet mur, declenche le signal", () => {
    const graph = { ...grid(5, 6), shared: { "socle/base": ["m0"] } };
    const { signals, mature } = drift(graph);
    assert.equal(mature, true);
    assert.equal(signals.length, 1);
    assert.match(signals[0].signal, /n'est utilise que par/);
  });

  test("la sortie annonce la mise en veille au lieu de se taire silencieusement", () => {
    const { output } = inspect({ ...grid(2, 3), shared: { "socle/base": ["m0"] } });
    assert.match(output, /projet jeune/);
    assert.match(output, /restent en veille/);
  });
});

describe("architecture-drift : la racine de composition n'est pas une derive", () => {
  test("elle est exclue du comptage de couplage", () => {
    const graph = {
      modules: {
        racine: { files: 2, imports: ["a", "b", "c"] },
        a: { files: 5, imports: [] },
        b: { files: 5, imports: [] },
        c: { files: 5, imports: [] },
        d: { files: 5, imports: [] },
      },
      composition_root: "racine",
    };
    const { signals } = drift(graph);
    assert.equal(signals.filter((s) => s.signal.includes("racine")).length, 0);
  });

  test("sans declaration, un module qui importe tout est signale", () => {
    const graph = {
      modules: {
        racine: { files: 2, imports: ["a", "b", "c"] },
        a: { files: 5, imports: [] },
        b: { files: 5, imports: [] },
        c: { files: 5, imports: [] },
        d: { files: 5, imports: [] },
      },
    };
    const { signals } = drift(graph);
    assert.ok(signals.some((s) => s.signal.includes("racine")));
  });
});

describe("architecture-drift : ce qu'il voit reellement", () => {
  test("un cycle entre deux modules est grave et propose une sortie", () => {
    const graph = {
      modules: { a: { files: 6, imports: ["b"] }, b: { files: 6, imports: ["a"] }, c: { files: 6, imports: [] }, d: { files: 6, imports: [] } },
    };
    const { signals } = drift(graph);
    const cycle = signals.find((s) => s.level === "grave");
    assert.ok(cycle, "un cycle doit etre signale");
    assert.match(cycle.next, /reference differee|Sortez ce qu'ils partagent/);
  });

  test("un cycle n'est signale qu'une fois, pas dans les deux sens", () => {
    const graph = {
      modules: { a: { files: 6, imports: ["b"] }, b: { files: 6, imports: ["a"] }, c: { files: 6, imports: [] }, d: { files: 6, imports: [] } },
    };
    assert.equal(drift(graph).signals.filter((s) => s.level === "grave").length, 1);
  });

  test("un module trois fois plus gros que le median est signale, avec un conseil local", () => {
    const graph = { modules: { a: { files: 30, imports: [] }, b: { files: 5, imports: [] }, c: { files: 5, imports: [] }, d: { files: 5, imports: [] } } };
    const gros = drift(graph).signals.find((s) => s.signal.includes("plus gros"));
    assert.ok(gros);
    assert.match(gros.next, /CE module seul/);
  });

  test("un decoupage sain ne produit aucun signal", () => {
    assert.deepEqual(drift(grid(5, 6)).signals, []);
  });
});

describe("architecture-drift : il dit ce qu'il ne sait pas voir", () => {
  test("la duplication semantique d'une regle est annoncee comme hors de portee", () => {
    const { output } = inspect(grid(5, 6));
    assert.match(output, /non detectable ici/);
    assert.match(output, /MEME regle metier avec un code different/);
    assert.match(output, /se constate en relisant, pas en calculant/);
  });

  test("refuse un graphe sans modules", () => {
    const { status, output } = inspect({ shared: {} });
    assert.notEqual(status, 0);
    assert.match(output, /doit porter modules/);
  });

  test("refuse un graphe introuvable", () => {
    sandbox ??= createSandbox();
    const result = run(sandbox, "architecture-drift.mjs", ["/absent.json"]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /introuvable/);
  });
});
