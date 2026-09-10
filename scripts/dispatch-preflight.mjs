import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { loadRules, pathAllowed, readJsonl, patternsMayOverlap } from './lib.mjs';

/** Refuses known impossible permissions without claiming to infer files from prose criteria. */
export function reservationFaults(paths, policy) {
  return (paths ?? []).flatMap((path) => {
    if (!/[*?]/.test(path)) return pathAllowed(path, policy) ? [] : [`Reserved path is outside implementer policy: ${path}`];
    const allow = policy?.allow;
    if (allow && !allow.some((pattern) => pattern === path || (pattern.endsWith('/**') && path.startsWith(pattern.slice(0, -2))))) {
      return [`Reservation has no covering allow rule: ${path}`];
    }
    if ((policy?.deny ?? []).some((pattern) => patternsMayOverlap(pattern, path))) return [`Reservation overlaps a deny rule: ${path}`];
    return [];
  });
}

/** Validates the adapter contract without running host-side connectivity probes. */
export function runtimePrerequisites(config) {
  const prerequisites = config.agent_runtime?.prerequisite_commands ?? {};
  for (const [name, command] of Object.entries(prerequisites)) {
    if (!Array.isArray(command) || !command.length || command.some((value) => typeof value !== 'string')) throw new Error(`Runtime prerequisite ${name} must be a nonempty argument array`);
    if (config.agent_runtime?.prerequisites_in_agent !== true) {
      throw new Error(`Runtime prerequisite ${name} is declared, but the adapter does not declare prerequisites_in_agent=true`);
    }
  }
  return prerequisites;
}

/**
 * Returns the transition the orchestrator owes before an agent may work, or null.
 *
 * A phase the orchestrator holds is a phase where nothing is happening: the
 * work starts when the agent does. Dispatching without moving it first leaves
 * the task package built on the held phase, so the agent computes its basis on
 * that record; the transition then changes the hash, and `store-update` refuses
 * the handoff as stale while `dispatch-preflight` refuses every later dispatch
 * for the unconsumed one. The issue is stranded, and the only visible cause is
 * two rules that are each right. Moving first is what makes the chain close.
 *
 * A phase an agent already holds owes nothing: a redispatch after a crash or a
 * block resumes the same phase, and inventing a transition there would record
 * work that never changed hands.
 *
 * @param record - the issue record
 * @param role - the role about to be dispatched
 * @returns the phase and owner to write before dispatch, or null
 */
export function dispatchTransition(record, role) {
  const phase = record?.pipeline_state?.phase;
  if (phase === "planned" && role === "implementer") return { phase: "in_progress", owner: "implementer" };
  if (phase === "ready_for_qa" && role === "qa") return { phase: "qa_in_progress", owner: "qa" };
  return null;
}

/** Checks trust synchronization, prerequisite contracts and unconsumed handoffs before spending an agent run. */
export function dispatchPreflight(issueId, role, config) {
  const rules = loadRules();
  if (!isDeepStrictEqual(config.file_policy, rules.file_policy)) throw new Error('File policy drift: run apply-profile before dispatch');
  for (const script of ['apply-profile.mjs', 'sync-briefs.mjs']) {
    try { execFileSync(process.execPath, [fileURLToPath(new URL(script, import.meta.url)), '--check'], { encoding: 'utf8' }); }
    catch (error) { throw new Error(`Generated policy is stale: ${script}: ${error.stdout ?? ''}${error.stderr ?? ''}`); }
  }
  const records = readJsonl(join(config.store_dir, 'issues.jsonl')).map((entry) => entry.record);
  const record = records.find((entry) => entry.id === issueId);
  if (!record) throw new Error(`Unknown issue: ${issueId}`);
  const phase = record.pipeline_state?.phase;
  const expected = ['planned', 'in_progress'].includes(phase) ? 'implementer' : phase === 'ready_for_qa' ? 'qa' : rules.phases?.[phase]?.owner;
  if (role !== expected) throw new Error(`Phase ${phase} expects ${expected}, not ${role}`);
  if (role === 'implementer') {
    const paths = record.pipeline_state?.file_reservations ?? [];
    if (!paths.length) throw new Error('No file reservation declared');
    const faults = reservationFaults(paths, config.file_policy?.implementer);
    if (faults.length) throw new Error(faults.join('\n'));
  }
  for (const id of record.depends_on ?? []) {
    if (records.find((item) => item.id === id)?.pipeline_state?.phase !== 'closed') throw new Error(`Dependency is not closed: ${id}`);
  }
  const directory = config.agent_runtime?.runs_dir ?? join(config.store_dir, 'runs');
  if (existsSync(directory)) for (const file of readdirSync(directory).filter((name) => name.endsWith('.json'))) {
    const run = JSON.parse(readFileSync(join(directory, file), 'utf8'));
    if (run.issue_id === issueId && run.handoff && !run.handoff_error && !(record.handoffs ?? []).some((entry) => entry.sha256 === run.handoff.sha256)) {
      throw new Error(`Consume the previous handoff with store-update.handoff_path before redispatch, or record it as abandoned with store-update.abandon_handoff and say why: ${run.handoff.path}`);
    }
  }
  runtimePrerequisites(config);
  return record;
}
