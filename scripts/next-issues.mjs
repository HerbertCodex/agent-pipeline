import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig, loadRules, readJsonl, patternsMayOverlap, generatedPaths, pathAllowed } from "./lib.mjs";

/**
 * Returns the authoring roles that can write an issue's complete scope.
 *
 * A reservation-safe issue is not necessarily dispatchable: the real store
 * carried several planned issues whose paths no single role could write.
 * Advertising those issues as ready made the orchestrator dispatch them to
 * an agent that could only stop at its boundary. Eligibility belongs in the
 * scheduler, where readiness is decided, rather than on a separate page the
 * driver may or may not consult.
 *
 * `eligible_roles` lets a plan narrow authorship deliberately. Existing
 * records default to the Implementer, the only role that authors ordinary
 * issue work. When no file policy is supplied (unit use of `computeWave`),
 * the historical default remains available.
 *
 * @param record - candidate issue
 * @param reservations - generated paths already removed
 * @param config - project configuration
 * @returns roles able to write every reservation
 */
function eligibleRoles(record, reservations, config) {
  const requested = Array.isArray(record.eligible_roles) && record.eligible_roles.length > 0
    ? record.eligible_roles
    : ["implementer"];
  const policies = config.file_policy;
  if (policies == null) return requested;
  return requested.filter((role) => {
    const policy = policies[role];
    return policy != null && reservations.every((path) => pathAllowed(path, policy));
  });
}

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
 * @param config - The project configuration, for its generated paths.
 * @returns The ready issues and the waiting ones with their reason.
 */
export function computeWave(records, rules, specId = null, config = {}) {
  const phaseOf = new Map(records.map((r) => [r.id, r.pipeline_state?.phase]));
  const holding = new Set(rules.reservation_holding_phases);
  // A generated path is nobody's to hold: it is rewritten from the source
  // tree after the fact. Counted as a reservation it makes every issue that
  // adds an export collide with every other, which is a whole wave
  // serialised by a file no agent authored.
  const generated = new Set(generatedPaths(config));
  const guarded = (record) =>
    (record.pipeline_state?.file_reservations ?? []).filter((pattern) => !generated.has(pattern));

  const heldElsewhere = records
    .filter((r) => holding.has(r.pipeline_state?.phase))
    .flatMap((r) =>
      guarded(r).map((pattern) => ({
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
      waiting.push({ id: record.id, reason: `depends on ${blocking.join(", ")}` });
      continue;
    }

    const reservations = guarded(record);
    if (reservations.length === 0) {
      waiting.push({ id: record.id, reason: "unguarded: no reservation declared" });
      continue;
    }

    const roles = eligibleRoles(record, reservations, config);
    if (roles.length === 0) {
      waiting.push({
        id: record.id,
        reason: "no eligible role can write the complete reserved scope",
      });
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

    ready.push({ id: record.id, role: roles[0], reservations });
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
  const { ready, waiting } = computeWave(records, rules, specId, config);

  if (asJson) {
    console.log(JSON.stringify({ ready, waiting }, null, 2));
    return;
  }

  if (ready.length === 0) {
    console.log("no issue dispatchable right now.");
  } else {
    console.log(`vague dispatchable en parallele (${ready.length}) :`);
    for (const item of ready) console.log(`  ${item.id}  ${item.role}  [${item.reservations.join(", ")}]`);
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
