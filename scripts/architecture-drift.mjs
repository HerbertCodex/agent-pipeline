import { readFileSync, existsSync } from "node:fs";
import { fail } from "./lib.mjs";

/**
 * Confronts a dependency graph with the signs announcing an architecture
 * change.
 *
 * The framework judges, it does not extract: reading imports means knowing a
 * language, and the core knows none. The project therefore supplies the graph
 * in a neutral form, modules with their files and what they import, and that
 * boundary is what makes the detector portable.
 *
 * What it does NOT see, and says so: SEMANTIC duplication of a business rule.
 * Two modules applying the same rule with different code are invisible to an
 * import graph. That trigger stays human, and claiming it covered would be
 * worse than not looking for it.
 *
 * Usage: node architecture-drift.mjs <graph.json>
 */

/**
 * Size below which sharing signals mean nothing.
 *
 * A shared file with a single consumer is a sign only if the project has
 * enough modules that it COULD have had several. On three modules that signal
 * fires systematically and wrongly, and a detector that cries on a young
 * project mostly teaches people to ignore it.
 */
const MATURITE = { modules: 4, files: 20 };

/**
 * Detects dependency cycles between modules.
 *
 * @param modules - graph of the modules
 * @returns the cycling pairs, each one only once
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
 * Returns the signals observed on a graph.
 *
 * @param graph - graph supplied by the project
 * @returns the list of signals, each with its trigger and what to do next
 */
export function drift(graph) {
  const all = graph.modules ?? {};
  const root = graph.composition_root ?? null;
  const modules = Object.fromEntries(Object.entries(all).filter(([name]) => name !== root));
  const names = Object.keys(modules);
  const signals = [];
  const total = names.reduce((sum, name) => sum + (modules[name].files ?? 0), 0);
  const mature = names.length >= MATURITE.modules && total >= MATURITE.files;

  for (const [name, node] of Object.entries(modules)) {
    const out = (node.imports ?? []).length;
    if (out >= 3) {
      signals.push({
        level: "attention",
        signal: `Module "${name}" imports ${out} other modules.`,
        means: "A module that knows everyone is either a disguised orchestrator, or a sign the split follows technology rather than subject.",
        next: "Check whether it carries a responsibility that belongs elsewhere, before considering another layout.",
      });
    }
  }

  for (const [a, b] of cycles(modules)) {
    signals.push({
      level: "grave",
      signal: `&laquo; ${a} &raquo; and &laquo; ${b} &raquo; import each other.`,
      means: "The split is wrong here: these two modules are really one, or a third is missing that would carry what they share.",
      next: "Pull what they share into a separate module. Do not resolve the cycle with a deferred reference: it hides the problem without treating it.",
    });
  }

  const shared = mature ? (graph.shared ?? {}) : {};
  for (const [file, users] of Object.entries(shared)) {
    if (users.length === 1) {
      signals.push({
        level: "menage",
        signal: `« ${file} » is shared but used only by « ${users[0]} ».`,
        means: "A shared file with a single consumer is not shared, it is a file filed too far from its use.",
        next: `Move it back into « ${users[0]} ». It becomes shared again the day a second module needs it.`,
      });
    }
    if (users.length >= 3) {
      signals.push({
        level: "attention",
        signal: `« ${file} » is used by ${users.length} modules.`,
        means: "A file everyone imports is a contention point: every issue touching it serialises against the others.",
        next: "Check it does not mix several responsibilities. If it does, split it; otherwise it is healthy.",
      });
    }
  }

  const sharedSize = graph.shared_files ?? Object.keys(shared).length;
  if (mature && total > 0 && sharedSize / total > 0.3) {
    signals.push({
      level: "attention",
      signal: `Shared files are ${Math.round((sharedSize / total) * 100)} % of all files.`,
      means: "Beyond a third, the shared folder is no longer a foundation: it is the dumping ground for what nobody knew where to put.",
      next: "Go through its files one by one and ask who really uses them.",
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
        signal: `&laquo; ${name} &raquo; is ${Math.round(biggest / median)} times bigger than the median module.`,
        means: "A module far above the others often carries several subjects, or deserves its own internal structure.",
        next: "Harden THAT module alone: that is what a per-feature layout allows. Do not change the whole project's architecture for one folder.",
      });
    }
  }

  return { signals, mature, modules: names.length, files: total, root };
}

function main() {
  const [path] = process.argv.slice(2);
  if (!path) fail("usage : architecture-drift.mjs <graphe.json>");
  if (!existsSync(path)) fail(`graphe not found: ${path}`);
  const graph = JSON.parse(readFileSync(path, "utf8"));
  if (graph.modules == null) fail("the graph must carry modules: { name: { files, imports } }");

  const { signals, mature, modules, files, root } = drift(graph);
  if (root != null) {
    console.log(`composition root excluded: « ${root} » legitimately imports everyone, that is its job.\n`);
  }
  if (!mature) {
    console.log(
      `young project: ${modules} module(s), ${files} file(s). Sharing signals stay dormant ` +
        `until ${MATURITE.modules} modules and ${MATURITE.files} files.`,
    );
    console.log("A shared folder with a single consumer only means something once the project could have had several.\n");
  }
  if (signals.length === 0) {
    console.log("no sign of drift: the split holds.");
  } else {
    for (const item of signals) {
      console.log(`[${item.level}] ${item.signal}\n         ${item.means}\n         -> ${item.next}`);
    }
  }
  console.log(
    "\nnot detectable here: two modules applying the SAME business rule with different code.",
  );
  console.log("An import graph does not see meaning. That trigger is found by reading, not by computing.");
}

if (process.argv[1]?.endsWith("architecture-drift.mjs")) main();
