import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { loadConfig, generatedPaths, sha256, fail } from "./lib.mjs";

/**
 * Rewrites the generated targets and says which ones moved.
 *
 * This is the orchestrator's step, and only the orchestrator's. The project
 * map is a function of the whole source tree: whoever writes it writes a
 * state that includes every agent's work in progress, which is why no issue
 * owns it and why `verify-scope` refuses it in an implementer's diff. Once
 * an issue closes, one role regenerates it from a tree nobody is mid-write
 * in, and commits that.
 *
 * The regeneration command is deliberately not a key of `commands`: every
 * key there becomes a CI step, and a CI that regenerates the map before
 * checking it would make the check pass whatever the code says.
 *
 * Usage: node regenerate.mjs [--check]
 */
function main() {
  const checkMode = process.argv.includes("--check");
  const config = loadConfig();
  const command = config.project_map?.regenerate;
  if (typeof command !== "string") {
    fail(
      "project_map.regenerate missing: nothing here knows how to rewrite the map. " +
        "Declare the command that writes it, next to project_map.out.",
    );
  }

  const before = new Map();
  for (const path of generatedPaths(config)) {
    before.set(path, existsSync(path) ? sha256(readFileSync(path, "utf8")) : null);
  }

  if (checkMode) {
    console.log(`would run: ${command} (${before.size} generated target(s))`);
    return;
  }

  const result = spawnSync(command, { shell: true, encoding: "utf8" });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  if (result.status !== 0) {
    if (output.length > 0) console.error(output);
    fail(`regeneration failed (exit ${result.status}): ${command}`);
  }

  const moved = [];
  for (const [path, digest] of before) {
    const now = existsSync(path) ? sha256(readFileSync(path, "utf8")) : null;
    if (now !== digest) moved.push(path);
  }

  if (moved.length === 0) {
    console.log(`generated targets already current: ${[...before.keys()].join(", ") || "none"}`);
    return;
  }
  console.log(`rewritten: ${moved.join(", ")}`);
  console.log("commit them on their own: they are output, and a reviewer reads them as such.");
}

main();
