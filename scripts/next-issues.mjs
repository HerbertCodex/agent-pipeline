import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig, loadRules, readJsonl, patternsMayOverlap, fail } from "./lib.mjs";

/**
 * Computes the wave of issues dispatchable now, and those that are not yet,
 * with the reason.
 *
 * The order of work is computed, not judged: an issue is ready when it is
 * `planned`, when all its dependencies are `closed`, and when its
 * reservations cross neither those of an issue in progress nor those of
 * another issue in the same wave. The sort is topological by construction, an
 * unclosed dependency excludes, then by priority, then by identifier so that
 * two runs return the same wave.
 *
 * The wave is a pairwise disjoint set: all its issues can start in parallel
 * without one write overwriting another.
 *
 * @param records - The store's issue records.
 * @param rules - The machine rules, for the reservation-holding phases.
 * @param specId - Restrict to one spec, or `null` for all.
 * @returns The ready issues and the waiting ones with their reason.
 */
export function computeWave(records, rules, specId = null) {
  const phaseOf = new Map(records.map((r) => [r.id, r.pipeline_state?.phase]));
  const holding = new Set(rules.reservation_holding_phases);

  const heldElsewhere = records
    .filter((r) => holding.has(r.pipeline_state?.phase))
    .flatMap((r) =>
      (r.pipeline_state?.file_reservations ?? []).map((pattern) => ({
        id: r.id,
        phase: r.pipeline_state.phase,
        pattern,
      })),
    );

  const candidates = records
    .filter((r) => r.pipeline_state?.phase === "planned")
    .filter((r) => specId == null || r.spec_id === specId)
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0) || compare(a.id, b.id));

  const ready = [];
  const waiting = [];
  const claimed = [];

  for (const record of candidates) {
    const blocking = (record.depends_on ?? []).filter((id) => phaseOf.get(id) !== "closed");
    if (blocking.length > 0) {
      waiting.push({ id: record.id, reason: `depend de ${blocking.join(", ")}` });
      continue;
    }

    const reservations = record.pipeline_state?.file_reservations ?? [];
    if (reservations.length === 0) {
      waiting.push({ id: record.id, reason: "unguarded: no reservation declared" });
      continue;
    }

    const busy = heldElsewhere.find((held) =>
      reservations.some((ours) => patternsMayOverlap(ours, held.pattern)),
    );
    if (busy != null) {
      waiting.push({
        id: record.id,
        reason: `${busy.id} (${busy.phase}) tient ${busy.pattern}`,
      });
      continue;
    }

    const sibling = claimed.find((held) =>
      reservations.some((ours) => patternsMayOverlap(ours, held.pattern)),
    );
    if (sibling != null) {
      waiting.push({
        id: record.id,
        reason: `serialised behind ${sibling.id} of the same wave on ${sibling.pattern}`,
      });
      continue;
    }

    ready.push({ id: record.id, reservations });
    for (const pattern of reservations) claimed.push({ id: record.id, pattern });
  }

  return { ready, waiting };
}

/**
 * Prints the dispatchable wave on standard output.
 *
 * Usage: node next-issues.mjs [--spec <spec-id>] [--json]
 */
function main() {
  const args = process.argv.slice(2);
  const specIndex = args.indexOf("--spec");
  const specId = specIndex === -1 ? null : args[specIndex + 1];
  const asJson = args.includes("--json");

  const config = loadConfig();
  const rules = loadRules();
  const records = readJsonl(join(config.store_dir, "issues.jsonl")).map((entry) => entry.record);
  const { ready, waiting } = computeWave(records, rules, specId);

  if (asJson) {
    console.log(JSON.stringify({ ready, waiting }, null, 2));
    return;
  }

  if (ready.length === 0) {
    console.log("no issue dispatchable right now.");
  } else {
    console.log(`vague dispatchable en parallele (${ready.length}) :`);
    for (const item of ready) console.log(`  ${item.id}  [${item.reservations.join(", ")}]`);
  }
  if (waiting.length > 0) {
    console.log("en attente :");
    for (const item of waiting) console.log(`  ${item.id}  ${item.reason}`);
  }
}

/**
 * Compares two identifiers for a stable order.
 *
 * @param a - First identifier.
 * @param b - Second identifier.
 * @returns A negative, zero or positive integer, like a sort comparator.
 */
function compare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

if (process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href) main();
