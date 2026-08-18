import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig, loadRules, readJsonl, patternsMayOverlap, fail } from "./lib.mjs";

/**
 * Calcule la vague d'issues dispatchables maintenant, et celles qui ne le sont
 * pas encore avec leur motif.
 *
 * L'ordre de travail se calcule, il ne se juge pas : une issue est prete
 * quand elle est `planned`, que toutes ses dependances sont `closed`, et que
 * ses reservations ne croisent ni celles d'une issue en cours ni celles d'une
 * autre issue de la meme vague. Le tri est topologique par construction — une
 * dependance non fermee exclut — puis par priorite, puis par identifiant pour
 * que deux executions rendent la meme vague.
 *
 * La vague est un ensemble deux a deux disjoint : toutes ses issues peuvent
 * partir en parallele sans qu'une ecriture en ecrase une autre.
 *
 * @param records - Les enregistrements d'issues du store.
 * @param rules - Les regles machine, pour les phases tenant reservation.
 * @param specId - Restreint a une spec, ou `null` pour toutes.
 * @returns Les issues pretes et celles en attente avec leur motif.
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
 * Rend la vague dispatchable sur la sortie standard.
 *
 * Usage : node next-issues.mjs [--spec <spec-id>] [--json]
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
 * Compare deux identifiants pour un ordre stable.
 *
 * @param a - Premier identifiant.
 * @param b - Second identifiant.
 * @returns Un entier negatif, nul ou positif, comme un comparateur de tri.
 */
function compare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

if (process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href) main();
