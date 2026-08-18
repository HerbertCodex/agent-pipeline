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
 * Builds a graph of N modules of a given size, with no dependency.
 *
 * @param count - number of modules
 * @param filesEach - files per module
 * @returns the graph
 */
function grid(count, filesEach) {
  const modules = {};
  for (let index = 0; index < count; index += 1) modules[`m${index}`] = { files: filesEach, imports: [] };
  return { modules };
}

/**
 * Runs the detector on a graph written into the sandbox.
 *
 * @param graph - graph to judge
 * @returns the execution result
 */
function inspect(graph) {
  sandbox ??= createSandbox();
  const path = join(sandbox, "graphe.json");
  writeFileSync(path, JSON.stringify(graph));
  return run(sandbox, "architecture-drift.mjs", [path]);
}

describe("architecture-drift: it stays quiet on a young project", () => {
  test("sharing signals stay dormant below the threshold", () => {
    const graph = { ...grid(2, 3), shared: { "socle/base": ["m0"] } };
    const { signals, mature } = drift(graph);
    assert.equal(mature, false);
    assert.deepEqual(signals, [], "un partage a un consommateur n'est pas un signe sur deux modules");
  });

  test("the same graph, once the project is mature, raises the signal", () => {
    const graph = { ...grid(5, 6), shared: { "socle/base": ["m0"] } };
    const { signals, mature } = drift(graph);
    assert.equal(mature, true);
    assert.equal(signals.length, 1);
    assert.match(signals[0].signal, /used only by/);
  });

  test("the output announces the dormancy instead of going silent", () => {
    const { output } = inspect({ ...grid(2, 3), shared: { "socle/base": ["m0"] } });
    assert.match(output, /young project/);
    assert.match(output, /stay dormant/);
  });
});

describe("architecture-drift: the composition root is not drift", () => {
  test("it is excluded from the coupling count", () => {
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

  test("with no declaration, a module importing everything is flagged", () => {
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

describe("architecture-drift: what it actually sees", () => {
  test("a cycle between two modules is serious and offers a way out", () => {
    const graph = {
      modules: { a: { files: 6, imports: ["b"] }, b: { files: 6, imports: ["a"] }, c: { files: 6, imports: [] }, d: { files: 6, imports: [] } },
    };
    const { signals } = drift(graph);
    const cycle = signals.find((s) => s.level === "grave");
    assert.ok(cycle, "un cycle doit etre signale");
    assert.match(cycle.next, /deferred reference|Pull what they share/);
  });

  test("a cycle is flagged once, not in both directions", () => {
    const graph = {
      modules: { a: { files: 6, imports: ["b"] }, b: { files: 6, imports: ["a"] }, c: { files: 6, imports: [] }, d: { files: 6, imports: [] } },
    };
    assert.equal(drift(graph).signals.filter((s) => s.level === "grave").length, 1);
  });

  test("a module three times the median is flagged, with local advice", () => {
    const graph = { modules: { a: { files: 30, imports: [] }, b: { files: 5, imports: [] }, c: { files: 5, imports: [] }, d: { files: 5, imports: [] } } };
    const gros = drift(graph).signals.find((s) => s.signal.includes("bigger than the median"));
    assert.ok(gros);
    assert.match(gros.next, /THAT module alone/);
  });

  test("a healthy split produces no signal", () => {
    assert.deepEqual(drift(grid(5, 6)).signals, []);
  });
});

describe("architecture-drift: it names what it cannot see", () => {
  test("semantic duplication of a rule is announced as out of reach", () => {
    const { output } = inspect(grid(5, 6));
    assert.match(output, /not detectable here/);
    assert.match(output, /SAME business rule with different code/);
    assert.match(output, /found by reading, not by computing/);
  });

  test("refuses a graph with no modules", () => {
    const { status, output } = inspect({ shared: {} });
    assert.notEqual(status, 0);
    assert.match(output, /must carry modules/);
  });

  test("refuses a graph that does not exist", () => {
    sandbox ??= createSandbox();
    const result = run(sandbox, "architecture-drift.mjs", ["/absent.json"]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /not found/);
  });
});
