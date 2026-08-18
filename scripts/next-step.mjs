import { join } from "node:path";
import { loadConfig, loadRules, readJsonl, fail } from "./lib.mjs";
import { computeWave } from "./next-issues.mjs";

const ESCALATION = "operator_escalation";

/**
 * Ordonne les phases non fermees par urgence de traitement.
 *
 * Une escalade passe avant tout : elle attend un humain, et rien d'autre ne
 * doit partir tant qu'elle tient. Vient ensuite ce qui est deja engage —
 * blocages puis roles en cours — parce qu'ouvrir un nouveau front pendant
 * qu'une issue est a mi-cycle multiplie les reservations tenues sans rien
 * fermer. Le travail neuf part en dernier.
 */
const PRECEDENCE = [ESCALATION, "blocked_", "in_progress", "qa_in_progress", "ready_for_qa", "planned"];

/**
 * Rend le rang de precedence d'une phase.
 *
 * @param phase - La phase de l'issue.
 * @returns Son rang, ou la longueur de la table si la phase est inconnue.
 */
function rankOf(phase) {
  const index = PRECEDENCE.findIndex((entry) =>
    entry.endsWith("_") ? phase.startsWith(entry) : phase === entry,
  );
  return index === -1 ? PRECEDENCE.length : index;
}

/**
 * Decrit ce qu'un pas doit faire sur une issue, et qui l'execute.
 *
 * Le store enregistre quelle phase une issue occupe, donc quel role la tient.
 * Il n'enregistre pas si ce role est vivant. Une issue en `in_progress` depuis
 * une seconde et une issue laissee la par un agent mort sont le meme
 * enregistrement, et aucune lecture ne les separe : c'est pourquoi une phase
 * tenue par un role se redispatche au lieu de s'attendre.
 *
 * @param record - L'enregistrement d'issue.
 * @param rules - Les regles machine, source des proprietaires de phase.
 * @returns L'action a executer, son acteur et son motif.
 */
function actionFor(record, rules) {
  const phase = record.pipeline_state?.phase;
  const owner = rules.phases?.[phase]?.owner ?? "inconnu";

  if (phase === ESCALATION) {
    return { verb: "escalade", actor: "operator", reason: "three code rejections, or a fault the pipeline cannot route" };
  }
  if (phase.startsWith("blocked_")) {
    return { verb: "debloquer", actor: owner, reason: `phase de blocage, tenue par ${owner}` };
  }
  if (owner === "orchestrator") {
    const next = phase === "planned" ? "implementer" : "qa";
    return { verb: "dispatcher", actor: next, reason: `la phase appartient a l'orchestrateur, qui transitionne puis dispatche ${next}` };
  }
  return {
    verb: "redispatcher",
    actor: owner,
    reason: `${owner} has held the phase since ${record.pipeline_state?.last_transition_at ?? "an unknown moment"}; the store cannot tell a live role from a dead one`,
  };
}

/**
 * Verifie qu'un pas n'a persiste qu'une seule transition.
 *
 * C'est la porte du pas unique. Sans elle, la consigne « une invocation, une
 * transition » n'est qu'une phrase dans un prompt : un orchestrateur qui
 * enchaine dix transitions dans la meme conversation ne fait echouer personne,
 * et le contexte non borne que le decoupage devait supprimer revient intact.
 * `pipeline_state.version` s'incremente de un a chaque persistance, donc un
 * ecart different de un est un pas qui a deborde.
 *
 * @param records - Les enregistrements d'issues du store.
 * @param id - L'issue sur laquelle le pas portait.
 * @param before - La version lue avant le pas.
 */
function assertAdvanced(records, id, before) {
  const record = records.find((r) => r.id === id);
  if (record == null) fail(`issue inconnue : ${id}`);

  const after = record.pipeline_state?.version;
  if (typeof after !== "number") fail(`${id} has no pipeline_state.version`);

  const delta = after - before;
  if (delta === 1) {
    console.log(`single step honoured : ${id} version ${before} -> ${after}.`);
    return;
  }
  if (delta === 0) {
    fail(`${id} did not advance: still version ${after}. The step persisted nothing.`);
  }
  fail(
    `${id} a avance de ${delta} transitions (version ${before} -> ${after}). ` +
      `A step persists exactly one: the orchestrator chained them in the same conversation.`,
  );
}

/**
 * Rend le pas suivant du pipeline : une issue, un acteur, une action.
 *
 * L'etat durable du pipeline est sur le disque, pas dans la conversation d'un
 * agent. Ce script le relit et recalcule quoi faire maintenant, ce qui permet
 * d'invoquer un orchestrateur neuf par transition plutot qu'un seul pour toute
 * une spec. Une coupure coute alors un pas, pas un run.
 *
 * Usage : node next-step.mjs [--spec <spec-id>] [--json]
 *         node next-step.mjs --assert-advanced <issue-id> <version-avant>
 */
function main() {
  const args = process.argv.slice(2);
  const config = loadConfig();
  const rules = loadRules();
  const records = readJsonl(join(config.store_dir, "issues.jsonl")).map((entry) => entry.record);

  const assertIndex = args.indexOf("--assert-advanced");
  if (assertIndex !== -1) {
    const id = args[assertIndex + 1];
    const before = Number(args[assertIndex + 2]);
    if (!id || !Number.isInteger(before)) {
      fail("usage : next-step.mjs --assert-advanced <issue-id> <version-avant>");
    }
    assertAdvanced(records, id, before);
    return;
  }

  const specIndex = args.indexOf("--spec");
  const specId = specIndex === -1 ? null : args[specIndex + 1];
  const asJson = args.includes("--json");

  const scoped = records.filter((r) => specId == null || r.spec_id === specId);
  const open = scoped.filter((r) => r.pipeline_state?.phase && r.pipeline_state.phase !== "closed");

  const dispatchable = new Set(computeWave(records, rules, specId).ready.map((item) => item.id));
  const actionable = open.filter(
    (r) => r.pipeline_state.phase !== "planned" || dispatchable.has(r.id),
  );

  actionable.sort(
    (a, b) =>
      rankOf(a.pipeline_state.phase) - rankOf(b.pipeline_state.phase) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  const next = actionable[0] ?? null;
  const step =
    next == null
      ? null
      : {
          issue: next.id,
          spec: next.spec_id ?? null,
          phase: next.pipeline_state.phase,
          version: next.pipeline_state.version ?? null,
          ...actionFor(next, rules),
        };

  if (asJson) {
    console.log(JSON.stringify({ step, open: open.length, actionable: actionable.length }, null, 2));
    return;
  }

  if (step == null) {
    console.log("no step to run: no open, actionable issue.");
    return;
  }

  console.log("next step, exactly one:\n");
  console.log(`  issue    ${step.issue}${step.spec ? `  (${step.spec})` : ""}`);
  console.log(`  phase    ${step.phase}`);
  console.log(`  action   ${step.verb} ${step.actor}`);
  console.log(`  reason   ${step.reason}`);
  console.log(`  version  ${step.version}`);
  console.log(`\nafter the step, check it did not overflow:`);
  console.log(`  node agent-pipeline/scripts/next-step.mjs --assert-advanced ${step.issue} ${step.version}`);

  if (actionable.length > 1) {
    console.log(`\n${actionable.length - 1} autre(s) issue(s) actionnable(s), volontairement non rendues :`);
    for (const record of actionable.slice(1)) {
      console.log(`  ${record.id}  ${record.pipeline_state.phase}`);
    }
  }
}

main();
