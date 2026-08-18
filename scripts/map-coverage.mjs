import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, fail } from "./lib.mjs";

/**
 * Returns all files under a root, recursively.
 *
 * @param dir - directory to walk
 * @returns the paths relative to the repository
 */
function walk(dir) {
  if (!existsSync(dir)) return [];
  let out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out = out.concat(walk(path));
    else out.push(path);
  }
  return out;
}

/**
 * Checks that the project map really cites the code it claims to cover.
 *
 * The `project_map` gate compares the rendered map with its regeneration: it
 * catches a stale map, never an empty one. A generator that does not collect
 * the right files, and the original project's looked for `*.ts`, unusable as
 * soon as the stack changes, produces a near-empty document; `--check` then
 * compares empty with empty and exits 0. The result is a green gate that
 * asserts nothing, worse than a missing gate since checking stops.
 *
 * This control closes that case while knowing nothing of the language: for
 * every source file under `project_map.roots`, it requires the file name to
 * appear somewhere in the rendered map. It does not read the map's format and
 * analyses no code.
 *
 * The matching is on the file name rather than the full path, because a map
 * may legitimately group by directory and cite only names, which is what the
 * original profile's map does. Two same-named files in two directories
 * therefore make the control lenient rather than wrong: for a gate whose job
 * is to catch an empty map, a false alarm would cost more than leniency.
 *
 * Usage: node map-coverage.mjs [--json]
 */
function main() {
  const config = loadConfig();
  const map = config.project_map ?? {};
  const out = map.out;
  if (typeof out !== "string") fail("project_map.out missing from the configuration");
  if (!existsSync(out)) fail(`carte not found: ${out}. Regenerate it before checking it.`);

  const roots = map.roots ?? ["src"];
  const skip = map.skip == null ? null : new RegExp(map.skip);
  const rendered = readFileSync(out, "utf8");

  const sources = roots
    .flatMap((root) => walk(root))
    .filter((path) => skip == null || !skip.test(path))
    .sort();

  if (sources.length === 0) {
    fail(
      `no source file under ${roots.join(", ")} : the map can cover nothing. ` +
        `Check project_map.roots and project_map.skip.`,
    );
  }

  const missing = sources.filter((path) => {
    const name = path.split("/").pop();
    return !rendered.includes(path) && !rendered.includes(name);
  });

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ out, sources: sources.length, missing }, null, 2));
    if (missing.length > 0) process.exit(1);
    return;
  }

  if (missing.length > 0) {
    console.error(`${out} does not cite ${missing.length} file(s) out of ${sources.length} :`);
    for (const path of missing) console.error(`  ${path}`);
    fail(
      "A map that does not cite the code cannot answer \u00ab does this already exist? \u00bb. " +
        "Check the generator really collects the files of this stack.",
    );
  }

  console.log(`${out} cites all ${sources.length} files of ${roots.join(", ")}.`);
}

main();
