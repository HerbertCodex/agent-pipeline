import { join } from "node:path";
import { loadConfig, loadRules, readJsonl, patternsMayOverlap, fail } from "./lib.mjs";

/**
 * Refuse le dispatch d'une issue en conflit de reservations.
 *
 * Une issue tient ses chemins dans toute phase listee par
 * reservation_holding_phases, phases bloquees comprises. Une issue sans
 * reservation declaree est signalee comme non gardee, jamais comme
 * sure. Le chevauchement est calcule par patternsMayOverlap, regle
 * conservatrice qui peut sur-bloquer mais jamais sous-bloquer.
 *
 * Usage : node check-reservations.mjs <issue-id>
 */
function main() {
  const issueId = process.argv[2];
  if (!issueId) fail("usage : check-reservations.mjs <issue-id>");
  const config = loadConfig();
  const rules = loadRules();
  const path = join(config.store_dir, "issues.jsonl");
  const entries = readJsonl(path);
  const target = entries.find((e) => e.record.id === issueId);
  if (target == null) fail(`issue introuvable : ${issueId}`);

  const targetReservations = target.record.pipeline_state?.file_reservations ?? [];
  if (targetReservations.length === 0) {
    fail(`issue ${issueId} non gardee : aucune reservation declaree. Declarer un perimetre avant dispatch.`);
  }

  const holding = new Set(rules.reservation_holding_phases);
  const conflicts = [];
  for (const entry of entries) {
    const record = entry.record;
    if (record.id === issueId) continue;
    const state = record.pipeline_state;
    if (state == null || !holding.has(state.phase)) continue;
    for (const theirs of state.file_reservations ?? []) {
      for (const ours of targetReservations) {
        if (patternsMayOverlap(ours, theirs)) {
          conflicts.push(`${record.id} (${state.phase}) tient ${theirs}, chevauche ${ours}`);
        }
      }
    }
  }

  if (conflicts.length > 0) {
    for (const conflict of conflicts) console.error(`conflit : ${conflict}`);
    fail(`dispatch refuse pour ${issueId}`);
  }
  console.log(`aucune collision : ${issueId} peut etre dispatchee (${targetReservations.length} reservation(s))`);
}

main();
