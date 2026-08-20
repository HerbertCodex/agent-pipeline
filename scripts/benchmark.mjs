import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { loadConfig, loadRules, readJsonl, sha256, fail } from "./lib.mjs";

/**
 * Directory of benchmark results.
 *
 * It lives outside `agent-pipeline/`, deliberately: the benchmark PROTOCOL is
 * reusable and travels with the pipeline, the RESULTS belong to one
 * repository and mean nothing elsewhere. Mixing them meant a copy of the
 * pipeline into a fresh project carried another project's measurements and
 * discoveries, plus a frozen requirement describing a foreign API.
 *
 * The configuration's `benchmarks_dir` moves it; `docs/benchmarks` by default.
 */
const DIR = loadConfig().benchmarks_dir ?? "docs/benchmarks";

const RUNS = join(DIR, "runs.jsonl");

const PENDING = join(DIR, ".pending.json");

const FINGERPRINT_SOURCES = [
  "CLAUDE.md",
  "pipeline.config.json",
  loadConfig().rules_path,
  "agent-pipeline/prompts",
  "agent-pipeline/docs",
];

/**
 * Returns the fingerprint of the pipeline configuration.
 *
 * Two runs with different fingerprints do not compare term by term: they
 * compare two pipelines. Without this fingerprint a series of measurements
 * says nothing, since nothing ties a number to the configuration that
 * produced it.
 *
 * @returns The first twelve characters of the configuration sources' hash.
 */
function fingerprint() {
  const parts = [];
  for (const source of FINGERPRINT_SOURCES) {
    if (!existsSync(source)) continue;
    const files = statSync(source).isDirectory()
      ? readdirSync(source)
          .sort()
          .map((name) => join(source, name))
          .filter((file) => statSync(file).isFile())
      : [source];
    for (const file of files) {
      parts.push(`${file}:${sha256(readFileSync(file, "utf8"))}`);
    }
  }
  return sha256(parts.join("\n")).slice(0, 12);
}

/**
 * Runs a git command and returns its output, or a fallback value.
 *
 * @param command - Full git command.
 * @returns The output trimmed, or `null` on failure.
 */
function git(command) {
  try {
    return execSync(command, { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

/**
 * Opens a run: freezes the starting instant and the measurable state.
 *
 * @param args - Command-line arguments.
 */
function start(args) {
  const labelIndex = args.indexOf("--label");
  const label = labelIndex === -1 ? null : args[labelIndex + 1];
  mkdirSync(DIR, { recursive: true });

  const config = loadConfig();
  const before = readJsonl(join(config.store_dir, "issues.jsonl")).map((e) => e.record);

  const pending = {
    started_at: new Date().toISOString(),
    label,
    base_ref: git("git rev-parse --short HEAD"),
    branch: git("git rev-parse --abbrev-ref HEAD"),
    fingerprint: fingerprint(),
    issues_before: before.map((r) => r.id),
  };
  writeFileSync(PENDING, JSON.stringify(pending, null, 2));

  console.log(`run open: fingerprint ${pending.fingerprint}, base ${pending.base_ref}`);
  if (pending.branch === "main") {
    console.log(
      "ATTENTION: you are on main. The protocol asks for a throwaway branch from the starting tag.",
    );
  }
}

/**
 * Closes a run: measures it and appends a line to the history.
 */
function finish() {
  if (!existsSync(PENDING)) fail(`no run open. Start one first: benchmark.mjs --start`);
  const pending = JSON.parse(readFileSync(PENDING, "utf8"));

  const config = loadConfig();
  const rules = loadRules();
  const records = readJsonl(join(config.store_dir, "issues.jsonl")).map((e) => e.record);
  const known = new Set(pending.issues_before);
  const produced = records.filter((r) => !known.has(r.id));

  const cycles = produced.reduce((sum, r) => sum + (r.transitions ?? []).length, 0);
  const rejections = produced.reduce((sum, r) => sum + (r.pipeline_state?.qa_code_rejections ?? 0), 0);
  const returns = produced.reduce(
    (sum, r) => sum + (r.transitions ?? []).filter((t) => t.from === "qa_in_progress" && t.to !== "closed").length,
    0,
  );
  const criteria = produced.reduce((sum, r) => sum + (r.acceptance_criteria ?? []).length, 0);
  const verified = produced.reduce(
    (sum, r) => sum + (r.criteria_ledger ?? []).filter((c) => c.status === "verified").length,
    0,
  );
  const discoveries = produced.filter((r) =>
    (r.relationships ?? []).some((rel) => rel.type === rules.discovery_relationship),
  ).length;
  const escapes = produced.filter((r) => r.escaped_from != null).length;

  const finished = new Date().toISOString();
  const run = {
    started_at: pending.started_at,
    finished_at: finished,
    minutes: Math.round((Date.parse(finished) - Date.parse(pending.started_at)) / 60000),
    label: pending.label,
    fingerprint_start: pending.fingerprint,
    fingerprint_end: fingerprint(),
    base_ref: pending.base_ref,
    issues: produced.length,
    closed: produced.filter((r) => r.pipeline_state?.phase === "closed").length,
    cycles,
    qa_code_rejections: rejections,
    returns_after_qa: returns,
    criteria,
    criteria_verified: verified,
    discoveries,
    escapes,
    code_commits: Number(git(`git rev-list --count ${pending.base_ref}..HEAD`) ?? 0),
  };

  const existing = existsSync(RUNS) ? readFileSync(RUNS, "utf8") : "";
  const separator = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
  writeFileSync(RUNS, existing + separator + JSON.stringify(run) + "\n");
  writeFileSync(PENDING, "");

  console.log(`run closed: ${run.minutes} min, ${run.issues} issue(s), ${run.cycles} cycle(s)`);
  if (run.fingerprint_start !== run.fingerprint_end) {
    console.log(
      "WARNING: the pipeline configuration changed DURING the run. This result measures no configuration in particular.",
    );
  }
}

/**
 * Compares the recorded runs, grouped by configuration fingerprint.
 */
function report() {
  if (!existsSync(RUNS)) fail(`no run recorded in ${RUNS}`);
  const runs = readFileSync(RUNS, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

  const groups = new Map();
  for (const run of runs) {
    const key = run.fingerprint_start;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(run);
  }

  console.log("# Spec etalon — runs enregistres\n");
  console.log("  fingerprint   runs  min   issues  cycles  rejects  found    echap.  criteres");
  for (const [key, list] of groups) {
    const avg = (pick) => Math.round((list.reduce((s, r) => s + pick(r), 0) / list.length) * 10) / 10;
    console.log(
      `  ${key}  ${String(list.length).padStart(4)}  ${String(avg((r) => r.minutes)).padStart(3)}  ` +
        `${String(avg((r) => r.issues)).padStart(6)}  ${String(avg((r) => r.cycles)).padStart(6)}  ` +
        `${String(avg((r) => r.qa_code_rejections)).padStart(6)}  ${String(avg((r) => r.discoveries ?? 0)).padStart(7)}  ${String(avg((r) => r.escapes)).padStart(6)}  ` +
        `${String(avg((r) => r.criteria_verified)).padStart(4)}/${avg((r) => r.criteria)}`,
    );
  }

  const thin = [...groups.values()].filter((list) => list.length < 2);
  if (thin.length > 0) {
    console.log(
      `\n  ${thin.length} configuration(s) have only ONE run. One run is a sample of one:\n` +
        "  two runs of the same configuration give different numbers.\n" +
        "  Conclude nothing from these lines before a second run.",
    );
  }
  console.log(
    "\n  Duration is the noisiest and most seductive indicator. The ones that count\n" +
      "  are escaped defects, cycles per issue and criteria verified on the first pass.\n" +
      "  A run twice as fast that lets a defect escape is a worse run.",
  );
}

/**
 * Point d'entree.
 *
 * Usage : node benchmark.mjs --start [--label <texte>] | --finish | --report
 */
function main() {
  const args = process.argv.slice(2);
  if (args.includes("--start")) return start(args);
  if (args.includes("--finish")) return finish();
  if (args.includes("--report")) return report();
  fail("usage : benchmark.mjs --start [--label <texte>] | --finish | --report");
}

main();
