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
export function classify(key, command, { timeoutMs = 600000 } = {}) {
  const started = performance.now();
  const result = spawnSync(command, { shell: true, encoding: "utf8", timeout: timeoutMs });
  const measured = { key, duration_ms: Math.round(performance.now() - started) };
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const lines = output.split("\n").filter((line) => line.trim().length > 0);
  const telling = lines.find((line) => ABSENT.test(line)) ?? lines[0] ?? "";

  if (result.error?.code === "ETIMEDOUT") {
    return { ...measured, verdict: "trop-longue", status: null, detail: `exceeded ${timeoutMs} ms timeout` };
  }
  if (result.status === 0) return { ...measured, verdict: "verte", status: 0, detail: "" };
  if (result.status === 127 || ABSENT.test(output) || output.trim().length === 0) {
    return { ...measured, verdict: "indisponible", status: result.status, detail: telling.trim().slice(0, 120) };
  }
  return { ...measured, verdict: "refuse", status: result.status, detail: telling.trim().slice(0, 120) };
}

/** Parses a per-command timeout without changing which gates are checked. */
function options(args) {
  let json = false;
  let timeoutMs = 600000;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--json") json = true;
    else if (args[index] === "--timeout-seconds") {
      const seconds = Number(args[++index]);
      timeoutMs = seconds * 1000;
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) fail("timeout must be a positive number of seconds, with millisecond precision");
    } else fail("usage: preflight.mjs [--json] [--timeout-seconds <seconds>]");
  }
  return { json, timeoutMs };
}

/**
 * Checks that every declared gate can actually run.
 *
 * A gate whose tool is missing fails instead of protecting, and a gate that
 * always fails ends up bypassed: the repository then claims a protection
 * nobody exercises. This control separates the two cases before they blur
 * together in a CI log.
 *
 * Usage: node preflight.mjs [--json] [--timeout-seconds <seconds>]
 */
function main() {
  const { json, timeoutMs } = options(process.argv.slice(2));
  const config = loadConfig();
  const keys = Object.keys(config.commands ?? {});
  if (keys.length === 0) fail("no command declared in commands");

  const started = performance.now();
  const results = keys.map((key, index) => {
    if (!json) console.log(`[${index + 1}/${keys.length}] running ${key}`);
    const item = classify(key, config.commands[key], { timeoutMs });
    if (!json) {
      const mark = { verte: "  ok   ", refuse: "  refuse", indisponible: "  ABSENT", "trop-longue": "  TIMEOUT" }[item.verdict];
      console.log(`${mark} ${item.key.padEnd(16)} ${item.duration_ms} ms ${item.detail}`);
    }
    return item;
  });
  const duration_ms = Math.round(performance.now() - started);
  const missing = results.filter((item) => item.verdict === "indisponible");
  const timedOut = results.filter((item) => item.verdict === "trop-longue");

  if (json) {
    console.log(JSON.stringify({ results, missing: missing.map((item) => item.key), timed_out: timedOut.map((item) => item.key), duration_ms }, null, 2));
  } else {
    console.log("");
    console.log(`Elapsed: ${duration_ms} ms`);
    if (missing.length === 0 && timedOut.length === 0) {
      console.log("every declared gate can run.");
      console.log("A red gate therefore reports a finding, never a missing tool.");
    } else if (missing.length > 0) {
      console.log(`${missing.length} gate(s) cannot run : ${missing.map((item) => item.key).join(", ")}`);
      console.log("These gates fail instead of protecting. The repository claims a protection nobody exercises.");
      console.log("Install the tool, or drop the key from commands, but do not leave a gate permanently red.");
    }
    if (timedOut.length > 0) console.log(`Preflight incomplete: timed out: ${timedOut.map((item) => item.key).join(", ")}. Inspect these commands before retrying.`);
  }

  if (missing.length > 0 || timedOut.length > 0) process.exit(1);
}

if (process.argv[1]?.endsWith("preflight.mjs")) main();
