import { spawnSync } from "node:child_process";
import { loadConfig, fail } from "./lib.mjs";

/**
 * Patterns by which an interpreter announces that a tool does not exist.
 *
 * The detection is heuristic and says so: there is no universal exit code for
 * "binary missing". A false negative shows up as a gate classed refusing when
 * it is unavailable, which is the state we have today, never worse.
 *
 * Silence is the second signal, and that one is not heuristic: a gate that
 * found something says so. A gate that fails without writing a character
 * reports nothing, it did not run. The case occurred on 2026-08-18 on a
 * freshly imported project: a task runner in silent mode, deprived of its
 * manifest, exits 254 without a word. The sixteen gates were classed
 * refusing, and preflight concluded that all were executable in a project
 * where none was.
 */
const ABSENT =
  /command not found|not found|No such file or directory|is not recognized|ENOENT|Cannot find module|MODULE_NOT_FOUND|executable file not found/i;

/**
 * Classes a gate's result: available and green, available and refusing, or
 * unavailable.
 *
 * The distinction is the point: a gate failing because it found something and
 * a gate failing because its tool is missing look alike in a log, and mean
 * nothing like the same thing. Confused, the second teaches people to ignore
 * the first.
 *
 * @param key - the gate's key in `commands`
 * @param command - command to run
 * @returns the verdict, the exit code and the first useful line
 */
export function classify(key, command) {
  const result = spawnSync(command, { shell: true, encoding: "utf8", timeout: 600000 });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const lines = output.split("\n").filter((line) => line.trim().length > 0);
  const telling = lines.find((line) => ABSENT.test(line)) ?? lines[0] ?? "";

  if (result.error?.code === "ETIMEDOUT") {
    return { key, verdict: "trop-longue", status: null, detail: "depasse dix minutes" };
  }
  if (result.status === 0) return { key, verdict: "verte", status: 0, detail: "" };
  if (result.status === 127 || ABSENT.test(output) || output.trim().length === 0) {
    return { key, verdict: "indisponible", status: result.status, detail: telling.trim().slice(0, 120) };
  }
  return { key, verdict: "refuse", status: result.status, detail: telling.trim().slice(0, 120) };
}

/**
 * Checks that every declared gate can actually run.
 *
 * A gate whose tool is missing fails instead of protecting, and a gate that
 * always fails ends up bypassed: the repository then claims a protection
 * nobody exercises. This control separates the two cases before they blur
 * together in a CI log.
 *
 * Usage: node preflight.mjs [--json]
 */
function main() {
  const json = process.argv.includes("--json");
  const config = loadConfig();
  const keys = Object.keys(config.commands ?? {});
  if (keys.length === 0) fail("no command declared in commands");

  const results = keys.map((key) => classify(key, config.commands[key]));
  const missing = results.filter((item) => item.verdict === "indisponible");

  if (json) {
    console.log(JSON.stringify({ results, missing: missing.map((item) => item.key) }, null, 2));
  } else {
    for (const item of results) {
      const mark = { verte: "  ok   ", refuse: "  refuse", indisponible: "  ABSENT", "trop-longue": "  lente " }[item.verdict];
      console.log(`${mark} ${item.key.padEnd(16)} ${item.detail}`);
    }
    console.log("");
    if (missing.length === 0) {
      console.log("every declared gate can run.");
      console.log("A red gate therefore reports a finding, never a missing tool.");
    } else {
      console.log(`${missing.length} gate(s) cannot run : ${missing.map((item) => item.key).join(", ")}`);
      console.log("These gates fail instead of protecting. The repository claims a protection nobody exercises.");
      console.log("Install the tool, or drop the key from commands, but do not leave a gate permanently red.");
    }
  }

  if (missing.length > 0) process.exit(1);
}

if (process.argv[1]?.endsWith("preflight.mjs")) main();
