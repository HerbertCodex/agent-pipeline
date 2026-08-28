import { join } from "node:path";
import { loadConfig, loadRules, readJsonl, fail } from "./lib.mjs";
import { unclaimed } from "./unclaimed.mjs";
import { computeWave } from "./next-issues.mjs";

const ESCALATION = "operator_escalation";

/**
 * Orders the non-closed phases by how urgently they need handling.
 *
 * An escalation comes first: it waits on a human, and nothing else should
 * start while it stands. Then comes what is already engaged, blocks then
 * roles in progress, because opening a new front while an issue sits
 * mid-cycle multiplies held reservations without closing anything. New work
 * goes last.
 */
const PRECEDENCE = [ESCALATION, "blocked_", "in_progress", "qa_in_progress", "ready_for_qa", "planned"];

/**
 * Returns a phase's precedence rank.
 *
 * @param phase - The issue's phase.
 * @returns Its rank, or the table length if the phase is unknown.
 */
function rankOf(phase) {
  const index = PRECEDENCE.findIndex((entry) =>
    entry.endsWith("_") ? phase.startsWith(entry) : phase === entry,
  );
  return index === -1 ? PRECEDENCE.length : index;
}

/**
 * Describes what a step must do on an issue, and who runs it.
 *
 * The store records which phase an issue occupies, therefore which role holds
 * it. It does not record whether that role is alive. An issue in
 * `in_progress` for one second and an issue left there by a dead agent are
 * the same record, and no reading separates them: that is why a phase held by
 * a role is redispatched rather than waited on.
 *
 * @param record - The issue record.
 * @param rules - The machine rules, source of the phase owners.
 * @returns The action to run, its actor and its reason.
 */
function actionFor(record, rules) {
  const phase = record.pipeline_state?.phase;
  const owner = rules.phases?.[phase]?.owner ?? "inconnu";

  if (phase === ESCALATION) {
    return { verb: "escalate to", actor: "operator", reason: "three code rejections, or a fault the pipeline cannot route" };
  }
  if (phase.startsWith("blocked_")) {
    return { verb: "unblock via", actor: owner, reason: `blocked phase, held by ${owner}` };
  }
  if (owner === "orchestrator") {
    const next = phase === "planned" ? "implementer" : "qa";
    return { verb: "dispatch", actor: next, reason: `the phase belongs to the orchestrator, which transitions then dispatches ${next}` };
  }
  return {
    verb: "redispatch",
    actor: owner,
    reason: `${owner} has held the phase since ${record.pipeline_state?.last_transition_at ?? "an unknown moment"}; the store cannot tell a live role from a dead one`,
  };
}

/**
 * Checks that a run stayed inside its configured transition budget.
 *
 * A one-transition process maximises cold starts; an unlimited process grows
 * context until it becomes unreliable. The project therefore chooses a small
 * explicit budget, four by default: enough for one nominal issue cycle and
 * never enough for an entire expanding spec.
 *
 * @param records - The store's issue records.
 * @param id - The issue the step was about.
 * @param before - The version read before the run.
 * @param maximum - Maximum transitions allowed in one run.
 */
function assertAdvanced(records, id, before, maximum) {
  const record = records.find((r) => r.id === id);
  if (record == null) fail(`unknown issue: ${id}`);

  const after = record.pipeline_state?.version;
  if (typeof after !== "number") fail(`${id} has no pipeline_state.version`);

  const delta = after - before;
  if (delta >= 1 && delta <= maximum) {
    console.log(`bounded run honoured: ${id} advanced ${delta}/${maximum} transition(s), version ${before} -> ${after}.`);
    return;
  }
  if (delta === 0) {
    fail(`${id} did not advance: still version ${after}. The step persisted nothing.`);
  }
  fail(`${id} advanced by ${delta} transitions (version ${before} -> ${after}), above the run limit ${maximum}.`);
}

/**
 * Returns the pipeline's next step: one issue, one actor, one action.
 *
 * The pipeline's durable state is on disk, not in an agent's conversation.
 * This script reads it back and recomputes what to do now, which allows a
 * fresh orchestrator per transition rather than one for a whole spec. An
 * interruption then costs a step, not a run.
 *
 * Usage: node next-step.mjs [--spec <spec-id>] [--json]
 *        node next-step.mjs --assert-advanced <issue-id> <version-before>
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
    const maximum = Number(config.workflow?.max_transitions_per_run ?? 4);
    if (!Number.isInteger(maximum) || maximum < 1) fail("workflow.max_transitions_per_run must be a positive integer");
    assertAdvanced(records, id, before, maximum);
    return;
  }

  const specIndex = args.indexOf("--spec");
  const specId = specIndex === -1 ? null : args[specIndex + 1];
  const asJson = args.includes("--json");

  const scoped = records.filter((r) => specId == null || r.spec_id === specId);
  const open = scoped.filter((r) => r.pipeline_state?.phase && r.pipeline_state.phase !== "closed");

  const dispatchable = new Set(computeWave(records, rules, specId, config).ready.map((item) => item.id));
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

  if (step != null && step.actor !== "operator" && config.agent_runtime?.command) {
    step.interactive_command = `node agent-pipeline/scripts/dispatch.mjs ${step.issue} ${step.actor}`;
    step.progress_interval_seconds = Number(config.agent_runtime.progress_interval_seconds ?? 20);
  }

  if (asJson) {
    console.log(JSON.stringify({ step, open: open.length, actionable: actionable.length }, null, 2));
    return;
  }

  if (step == null) {
    console.log("no step to run: no open, actionable issue.");
    // « Nothing to do » and « this pipeline has never seen this repository »
    // read the same here, and they are opposite. Observed on a real project:
    // a whole feature built directly, the store at zero lines, and this line
    // printed as if all were well.
    const missed = unclaimed(".", config, records);
    if (missed.length > 0) {
      console.log(
        `\n${missed.length} commit(s) touched the source and no issue claims them: the store never saw ` +
          "this work. Direct work is legitimate; direct work nobody was told about is what this reports. " +
          "Run unclaimed.mjs for the list.",
      );
    }
    return;
  }

  console.log("next bounded run:\n");
  console.log(`  issue    ${step.issue}${step.spec ? `  (${step.spec})` : ""}`);
  console.log(`  phase    ${step.phase}`);
  console.log(`  action   ${step.verb} ${step.actor}`);
  console.log(`  reason   ${step.reason}`);
  console.log(`  version  ${step.version}`);
  if (step.interactive_command != null) {
    console.log(`\ninteractive dispatch (output streamed, Ctrl-C propagated):`);
    console.log(`  ${step.interactive_command}`);
    console.log(`  progress heartbeat every ${step.progress_interval_seconds}s`);
  }
  console.log(`\nafter the run, check it stayed within the transition budget:`);
  console.log(`  node agent-pipeline/scripts/next-step.mjs --assert-advanced ${step.issue} ${step.version}`);

  if (actionable.length > 1) {
    console.log(`\n${actionable.length - 1} autre(s) issue(s) actionnable(s), volontairement non rendues :`);
    for (const record of actionable.slice(1)) {
      console.log(`  ${record.id}  ${record.pipeline_state.phase}`);
    }
  }
}

main();
