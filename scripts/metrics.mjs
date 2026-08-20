import { join } from "node:path";
import { loadConfig, loadRules, readJsonl } from "./lib.mjs";

/**
 * Returns the throughput and quality measurements derivable from the store.
 *
 * The only quality indicator that counts is the ESCAPE: a defect that crossed
 * QA and is discovered later. It is read from the `escaped_from` field, and
 * NOT from the `discovered-from` relation, which says where a finding
 * appeared, not what let it through. Confusing them inflates the indicator
 * exactly when the mechanism is being used well, and that happened: 18
 * discoveries caught in time were reported as 18 escapes.
 *
 * The rest, cycles, durations, rejections, measures throughput rather than
 * quality: a QA that never rejects proves nothing, it may equally have no box
 * to file what it finds.
 *
 * None of these values is a statistic. On one project, a few dozen issues and
 * a single operator, they are indications, and the temptation to read an
 * effect into noise is the main risk.
 *
 * Usage: node metrics.mjs [--spec <spec-id>] [--json]
 */
function main() {
  const args = process.argv.slice(2);
  const specIndex = args.indexOf("--spec");
  const specId = specIndex === -1 ? null : args[specIndex + 1];
  const asJson = args.includes("--json");

  const config = loadConfig();
  const rules = loadRules();
  const records = readJsonl(join(config.store_dir, "issues.jsonl")).map((e) => e.record);
  const discoveryType = rules.discovery_relationship;

  const inSpec = new Set(
    records.filter((r) => specId == null || r.spec_id === specId).map((r) => r.id),
  );

  const originOf = (record) =>
    (record.relationships ?? [])
      .filter((relation) => relation.type === discoveryType)
      .map((relation) => relation.to);

  const scoped = records.filter(
    (r) => inSpec.has(r.id) || originOf(r).some((origin) => inSpec.has(origin)),
  );

  const issues = scoped.map((record) => {
    const transitions = record.transitions ?? [];
    const stamps = transitions.map((t) => t.at).filter(Boolean).sort();
    const origins = originOf(record);

    return {
      id: record.id,
      phase: record.pipeline_state?.phase ?? null,
      cycles: transitions.length || null,
      qa_code_rejections: record.pipeline_state?.qa_code_rejections ?? 0,
      returned_to_work: transitions.filter((t) => t.from === "qa_in_progress" && t.to !== "closed")
        .length,
      minutes: durationMinutes(stamps[0], record.closed_at ?? stamps[stamps.length - 1]),
      criteria: (record.acceptance_criteria ?? []).length,
      verified: (record.criteria_ledger ?? []).filter((c) => c.status === "verified").length,
      ledger: record.criteria_ledger != null,
      escaped_from: record.escaped_from ?? null,
      discovered_from: origins,
    };
  });

  const escapes = issues.filter((i) => i.escaped_from != null);
  const discoveries = issues.filter((i) => i.discovered_from.length > 0);

  const planned = issues.filter((i) => inSpec.has(i.id));
  const instrumented = planned.filter((i) => i.cycles != null);
  const withLedger = planned.filter((i) => i.ledger);

  const summary = {
    spec: specId ?? "toutes",
    issues: planned.length,
    closed: planned.filter((i) => i.phase === "closed").length,
    decouvertes: discoveries.length,
    echappees: escapes.length,
    rejets_qa_code: planned.reduce((sum, i) => sum + i.qa_code_rejections, 0),
    retours_apres_qa: planned.reduce((sum, i) => sum + i.returned_to_work, 0),
    issues_instrumentees: `${instrumented.length}/${planned.length}`,
    issues_avec_registre: `${withLedger.length}/${planned.length}`,
  };

  if (asJson) {
    console.log(JSON.stringify({ summary, issues }, null, 2));
    return;
  }

  console.log(`# Measurements - spec ${summary.spec}\n`);
  for (const [key, value] of Object.entries(summary)) {
    if (key === "spec") continue;
    console.log(`  ${key.padEnd(22)} ${value}`);
  }

  console.log("\n## Per issue\n");
  console.log("  id        phase           cycles  min   criteres  rejets  retours");
  for (const issue of issues) {
    console.log(
      `  ${issue.id.padEnd(9)} ${(issue.phase ?? "-").padEnd(15)} ` +
        `${String(issue.cycles ?? "-").padStart(6)}  ${String(issue.minutes ?? "-").padStart(3)}   ` +
        `${String(`${issue.verified}/${issue.criteria}`).padStart(8)}  ` +
        `${String(issue.qa_code_rejections).padStart(6)}  ${String(issue.returned_to_work).padStart(7)}`,
    );
  }

  console.log("\n## Escaped defects - passed QA, found later\n");
  if (escapes.length > 0) {
    for (const issue of escapes) {
      console.log(`  ${issue.id} escaped from ${issue.escaped_from}`);
    }
  } else if (discoveries.length === 0) {
    console.log(
      "  none recorded, and NO discovery either: this zero measures nothing.\n" +
        "  It says the mechanism was not exercised, not that no defect escaped.",
    );
  } else {
    console.log(
      `  none recorded, out of ${discoveries.length} discovery(ies).\n\n` +
        "  This zero is readable, but read it for what it says: none of the discoveries\n" +
        "  carries `escaped_from`, so all were found DURING the cycle of their\n" +
        "  issue source: caught in time, nothing crossed QA. A finding linked by\n" +
        "  `discovered-from` is NOT an escape: that field says where it appeared, not\n" +
        "  what let it through. Confusing them inflates the indicator exactly when the\n" +
        "  mechanism is being used well.",
    );
  }

  if (instrumented.length < issues.length) {
    console.log(
      `\n  ${issues.length - instrumented.length} issue(s) with no transition history: they predate the instrumentation, so neither cycles nor duration compute.`,
    );
  }
}

/**
 * Returns the duration in minutes between two timestamps.
 *
 * @param start - Starting timestamp, or none.
 * @param end - Ending timestamp, or none.
 * @returns The duration rounded to minutes, or `null` if it cannot be computed.
 */
function durationMinutes(start, end) {
  if (!start || !end) return null;
  const ms = Date.parse(end) - Date.parse(start);
  return Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 60000) : null;
}

main();
