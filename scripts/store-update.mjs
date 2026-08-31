import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  acquireStoreLock,
  atomicWrite,
  loadConfig,
  loadRules,
  readJsonl,
  sha256,
  fail,
} from "./lib.mjs";
import {
  projectedStatus,
  readIssueTracker,
  trackerBinding,
  trackerMatch,
} from "./issue-tracker.mjs";

/**
 * Validates a state block against the machine source of the rules.
 *
 * @param state - the proposed pipeline_state block
 * @param rules - rules loaded from <rules_path>
 * @throws {Error} if a required field is missing, if the phase or the owner
 * is unknown, or if they do not match
 */
function validateState(state, rules) {
  for (const field of rules.state_required_fields) {
    if (!(field in state)) throw new Error(`pipeline_state.${field} missing`);
  }
  const phase = rules.phases[state.phase];
  if (phase == null) throw new Error(`unknown phase: ${state.phase}`);
  if (phase.owner !== state.owner) {
    throw new Error(`owner ${state.owner} invalid for phase ${state.phase} (expected ${phase.owner})`);
  }
  if (!Number.isInteger(state.version) || state.version < 1) throw new Error("invalid version");
  if (!Number.isInteger(state.schema_version) || state.schema_version < 1) throw new Error("invalid schema_version");
  if (!Number.isInteger(state.qa_code_rejections) || state.qa_code_rejections < 0) {
    throw new Error("qa_code_rejections must be a non-negative integer");
  }
  if (!Array.isArray(state.file_reservations) || state.file_reservations.some((path) => typeof path !== "string")) {
    throw new Error("file_reservations must be a list of paths");
  }
}

/**
 * Enforces the QA rejection budget and prevents arbitrary counter edits.
 *
 * @param previous - persisted state
 * @param next - proposed state
 * @param reason - request transition_reason
 * @param rules - machine rules
 * @throws {Error} when the counter or route is inconsistent
 */
function validateRejectionBudget(previous, next, reason, rules) {
  if (previous == null) return;
  const from = previous.phase;
  const to = next.phase;
  const before = previous.qa_code_rejections;
  const after = next.qa_code_rejections;
  const returningFromQa = from === "qa_in_progress" && to !== "closed";

  if (!returningFromQa) {
    if (after !== before) throw new Error("qa_code_rejections changes only on a QA code rejection");
    return;
  }

  const fault = reason?.fault;
  if (typeof fault !== "string") throw new Error("transition_reason.fault missing for a QA rejection");
  if (fault !== "code") {
    if (after !== before) throw new Error(`fault ${fault} must not increment qa_code_rejections`);
    if (to === "operator_escalation") throw new Error("operator escalation is reserved for the code rejection budget");
    return;
  }

  if (after !== before + 1) throw new Error(`fault code must increment qa_code_rejections from ${before} to ${before + 1}`);
  const maximum = rules.max_code_rejections;
  if (!Number.isInteger(maximum) || maximum < 1) throw new Error("max_code_rejections missing or invalid in rules");
  if (after >= maximum && to !== "operator_escalation") {
    throw new Error(`code rejection ${after} reaches the limit ${maximum} and must route to operator_escalation`);
  }
  if (after < maximum && to === "operator_escalation") {
    throw new Error(`code rejection ${after} has not reached the limit ${maximum}`);
  }
}

/**
 * Says whether the operator explicitly approved a frozen-scope change.
 *
 * @param value - request scope-change block
 * @returns true when the approval is complete and dated
 */
function approvedScopeChange(value) {
  return value?.approved_by === "operator" &&
    typeof value?.reason === "string" && value.reason.trim().length > 0 &&
    typeof value?.approved_at === "string" && !Number.isNaN(Date.parse(value.approved_at));
}

/**
 * Says whether implementation may already have started for a spec.
 *
 * @param phase - spec phase
 * @returns true when the planned issue list is frozen
 */
function scopeIsFrozen(phase) {
  return ["active", "ready_for_pr", "pr_open", "merged"].includes(phase);
}

/**
 * Decides whether an approved change may still enter the current delivery.
 *
 * Active work may still be renegotiated by the operator. Once the spec is
 * ready for review, only a concrete delivery blocker may join it; ordinary
 * improvements become a follow-up spec. A merged spec is historical and can
 * never change scope.
 *
 * @param phase - current spec phase
 * @param value - request scope-change block
 * @returns true when the change may alter the frozen contract
 */
function scopeChangeAllowed(phase, value) {
  if (!scopeIsFrozen(phase)) return true;
  if (!approvedScopeChange(value)) return false;
  if (phase === "active") return true;
  if (["ready_for_pr", "pr_open"].includes(phase)) return value.kind === "delivery_blocker";
  return false;
}

function scopeChangeInstruction(phase) {
  if (["ready_for_pr", "pr_open"].includes(phase)) {
    return "Only scope_change.kind=delivery_blocker may still join this delivery; create a follow-up spec otherwise.";
  }
  if (phase === "merged") return "A merged spec is immutable; create a follow-up spec.";
  return "Provide scope_change { approved_by: operator, reason, approved_at }.";
}

function trackerSourceFields(kind, entry, snapshot) {
  const source = entry.record;
  const fields = { title: source.title, priority: source.priority ?? null };
  if (kind !== "issue") return fields;
  fields.depends_on = snapshot.dependencies.get(source.id) ?? [];
  const specs = (source.relationships ?? [])
    .filter((relationship) => relationship.to_type === "spec" && relationship.type === "implements")
    .map((relationship) => relationship.to);
  if (specs.length > 1) fail(`Sudocode issue ${source.id} implements more than one spec. Nothing written.`);
  if (specs.length === 1) fields.spec_id = specs[0];
  return fields;
}

function trackerEntry(config, kind, id) {
  const snapshot = readIssueTracker(config);
  if (snapshot == null) return null;
  const entries = kind === "issue" ? snapshot.issues : snapshot.specs;
  const entry = entries.find((candidate) => candidate.record.id === id);
  if (entry == null) fail(`Sudocode ${kind} not found: ${id}. Create it in Sudocode first. Nothing written.`);
  const managedTag = config.issue_tracker?.managed_tag;
  if (kind === "issue" && typeof managedTag === "string" && !entry.record.tags?.includes(managedTag)) {
    fail(`Sudocode issue ${id} is not tagged ${managedTag}. Nothing written.`);
  }
  return { entry, snapshot };
}

function refreshTracker(record, kind, config, request) {
  const source = trackerEntry(config, kind, record.id);
  if (source == null) return;
  const match = trackerMatch(record, source.snapshot, kind);
  if (match.drift == null) return;
  if (match.drift === "identity") {
    fail(
      `tracker identity changed for ${record.id}; a replacement Sudocode entity cannot inherit its history. ` +
        "Create a new control record or restore the original entity. Nothing written.",
    );
  }
  if (request.refresh_tracker !== true) {
    fail(`tracker binding ${match.drift} for ${record.id}; refresh it explicitly. Nothing written.`);
  }
  const active = kind === "issue"
    ? record.pipeline_state?.phase !== "planned"
    : scopeIsFrozen(record.spec_state?.phase);
  const contractPhase = kind === "issue" ? "active" : record.spec_state?.phase;
  if (active && !scopeChangeAllowed(contractPhase, request.scope_change)) {
    fail(
      `tracker scope changed for ${record.id} in ${contractPhase}; ` +
        `${scopeChangeInstruction(contractPhase)} Nothing written.`,
    );
  }
  const previousRevision = record.tracker?.revision ?? null;
  Object.assign(record, trackerSourceFields(kind, source.entry, source.snapshot));
  record.tracker = trackerBinding(source.entry);
  record.tracker_scope_changes = [
    ...(record.tracker_scope_changes ?? []),
    {
      from_revision: previousRevision,
      to_revision: record.tracker.revision,
      approved_by: active ? request.scope_change.approved_by : null,
      reason: active ? request.scope_change.reason : "refreshed before work started",
      at: active ? request.scope_change.approved_at : new Date().toISOString(),
    },
  ];
}

/**
 * Applies a write request to the store under an optimistic lock.
 *
 * The JSON request carries: target {kind, id}, expected_record_hash, and any
 * of pipeline_state, acceptance_criteria, criteria_ledger,
 * discoveries_declared, spec_state {phase, pr_url}, spec_fields,
 * append_context {heading, body}, set_status, or create_record for a
 * creation. Only the targeted line is rewritten; every other line is copied
 * byte for byte.
 *
 * `pipeline_state` confronts the pair (phase left, phase entered) with
 * `rules.transitions` and refuses anything absent from it. An identical phase
 * on both sides is an AMENDMENT: the version advances, the `transitions`
 * journal records nothing, because no transition happened and a false
 * movement would skew the measurements.
 *
 * `acceptance_criteria` rewrites an issue's contract when a spec revision
 * changes it. It then clears `criteria_ledger`: a ledger established against
 * other criteria is not evidence about these. Without this path, a revised
 * issue kept its stale criteria and became unclosable, `store-verify`
 * measuring the ledger's length against them.
 *
 * `spec_fields` merges a spec record's normative fields, excluding fields
 * that already have their own write path.
 *
 * `criteria_ledger` carries what is KNOWN to be true of each criterion, one
 * entry per acceptance criterion, in order. It does not record what an agent
 * says it did: it records what an audit observed in the environment, with its
 * evidence.
 *
 * `discoveries_declared` records the findings a handoff announced. That is
 * what `store-verify` confronts with the issues actually created, in order to
 * refuse a closure that would have lost them. The invariant existed without
 * this write path, and could therefore never refuse anything.
 *
 * Usage: node store-update.mjs <request.json>
 */
function main() {
  const requestPath = process.argv[2];
  if (!requestPath) fail("usage : store-update.mjs <requete.json>");
  const request = JSON.parse(readFileSync(requestPath, "utf8"));
  const config = loadConfig();
  const rules = loadRules();

  let release;
  try {
    release = acquireStoreLock(config.store_dir);
  } catch (error) {
    fail(`${error.message}. Nothing written.`);
  }
  try {
    applyRequest(request, config, rules);
  } finally {
    release();
  }
}

/**
 * Applies a parsed request while the caller holds the store-wide lock.
 *
 * @param request - parsed update request
 * @param config - project configuration
 * @param rules - machine rules
 */
function applyRequest(request, config, rules) {

  if (request.create_record != null) {
    return create(request, config, rules);
  }

  const { kind, id } = request.target ?? {};
  if (kind !== "issue" && kind !== "spec") fail("target.kind must be issue or spec");
  const path = join(config.store_dir, `${kind}s.jsonl`);
  const entries = readJsonl(path);
  const entry = entries.find((e) => e.record.id === id);
  if (entry == null) fail(`record not found: ${id}`);

  const currentHash = sha256(entry.raw);
  if (request.expected_record_hash !== currentHash) {
    fail(`optimistic lock: expected hash ${request.expected_record_hash}, current hash ${currentHash}. Nothing written.`);
  }

  const record = entry.record;
  refreshTracker(record, kind, config, request);
  if (request.pipeline_state != null) {
    try {
      validateState(request.pipeline_state, rules);
    } catch (error) {
      fail(`state refused: ${error.message}. Nothing written.`);
    }
    const previous = record.pipeline_state;
    if (previous != null && request.pipeline_state.version !== previous.version + 1) {
      fail(`expected version ${previous.version + 1}, received ${request.pipeline_state.version}. Nothing written.`);
    }
    const from = previous?.phase ?? null;
    const to = request.pipeline_state.phase;
    try {
      validateRejectionBudget(previous, request.pipeline_state, request.transition_reason, rules);
    } catch (error) {
      fail(`state refused: ${error.message}. Nothing written.`);
    }
    const amendment = from === to;
    if (from != null && !amendment && !(rules.transitions ?? []).includes(`${from}->${to}`)) {
      fail(`transition ${from}->${to} absent from rules.json. Nothing written.`);
    }
    const at = request.pipeline_state.last_transition_at ?? new Date().toISOString();
    record.pipeline_state = request.pipeline_state;
    const projected = projectedStatus(request.pipeline_state.phase, config);
    if (projected != null) {
      record.tracker_sync = {
        provider: "sudocode",
        desired_status: projected,
        requested_at: at,
      };
    }

    if (!amendment) {
      // `at` says when the step was persisted; `started_at` says when it was
      // dispatched. Without the second, the journal cannot tell an agent
      // working from nobody at the keyboard — a real run left fourteen hours
      // between two closures with no block and no way to read them.
      const startedAt = request.started_at;
      if (typeof startedAt !== "string" || Number.isNaN(Date.parse(startedAt))) {
        fail(
          "started_at missing: stamp when you dispatched the step, not only when you persisted it. " +
            "Without it the journal cannot separate a step running from a step waiting. Nothing written.",
        );
      }
      if (Date.parse(startedAt) > Date.parse(at)) {
        fail(`started_at ${startedAt} is later than the transition at ${at}. Nothing written.`);
      }
      // `at` is when you persisted, and that conflates the agent handing its
      // work back with your own validation of it — scope confronted with the
      // diff, red proof replayed, invariants read. `ended_at` is the moment
      // the agent returned, and it is what tells the two apart.
      const endedAt = request.ended_at;
      if (typeof endedAt !== "string" || Number.isNaN(Date.parse(endedAt))) {
        fail(
          "ended_at missing: stamp when the agent handed its work back. Without it the step's total is " +
            "known and its split between the agent and your validation is not. Nothing written.",
        );
      }
      if (Date.parse(endedAt) < Date.parse(startedAt) || Date.parse(endedAt) > Date.parse(at)) {
        fail(`ended_at ${endedAt} falls outside the step ${startedAt} .. ${at}. Nothing written.`);
      }
      record.transitions = [
        ...(record.transitions ?? []),
        { from, to, started_at: startedAt, ended_at: endedAt, at, version: request.pipeline_state.version },
      ];
    }
    if (to === "closed" && record.closed_at == null) record.closed_at = at;
  }
  if (request.acceptance_criteria != null) {
    if (kind !== "issue") fail("acceptance_criteria only applies to an issue");
    const next = request.acceptance_criteria;
    if (!Array.isArray(next) || next.length === 0) {
      fail("acceptance_criteria must be a non-empty list. Nothing written.");
    }
    for (const [index, item] of next.entries()) {
      if (typeof item !== "string" || item.trim().length === 0) {
        fail(`acceptance_criteria[${index}] must be a non-empty string. Nothing written.`);
      }
    }
    record.acceptance_criteria = next;
    if (record.criteria_ledger != null && request.criteria_ledger == null) {
      record.criteria_ledger = null;
    }
  }
  // `store-verify` refuses to close an escaped issue with no prevention, and
  // no request field could set either. A real spec hit it: the agent had to
  // hand-edit a line of the store — the one thing this framework forbids —
  // because its two other ways out were lies, dropping `escaped_from` or
  // naming a gate that does not exist. A gate demanding a field no writer can
  // write is a gate satisfied by forgery.
  if (request.escaped_from != null) {
    if (kind !== "issue") fail("escaped_from only applies to an issue");
    const escaped = request.escaped_from;
    if (typeof escaped !== "string" || escaped.trim().length === 0) {
      fail("escaped_from must name the closed issue the defect belongs to. Nothing written.");
    }
    if (!entries.some((candidate) => candidate.record.id === escaped)) {
      fail(`escaped_from names ${escaped}, which the store does not carry. Nothing written.`);
    }
    record.escaped_from = escaped;
  }
  if (request.prevention != null) {
    if (kind !== "issue") fail("prevention only applies to an issue");
    const prevention = request.prevention;
    const gate = typeof prevention.gate === "string" && prevention.gate.length > 0;
    const pitfall = typeof prevention.pitfall === "string" && prevention.pitfall.length > 0;
    if (!gate && !pitfall) {
      fail(
        "prevention names neither a gate nor a pitfall. A note saying it will not happen again is what " +
          "this framework exists to replace. Nothing written.",
      );
    }
    record.prevention = gate ? { gate: prevention.gate } : { pitfall: prevention.pitfall };
  }
  if (request.untested_surface != null) {
    if (kind !== "issue") fail("untested_surface only applies to an issue");
    const surface = request.untested_surface;
    if (typeof surface !== "string" || surface.trim().length === 0) {
      fail("untested_surface must be a non-empty string. Nothing written.");
    }
    record.untested_surface = surface;
  }
  if (request.claims_to_replay != null) {
    if (kind !== "issue") fail("claims_to_replay only applies to an issue");
    const claims = request.claims_to_replay;
    if (!Array.isArray(claims) || claims.length === 0) {
      fail("claims_to_replay must be a non-empty list. Nothing written.");
    }
    for (const [index, item] of claims.entries()) {
      if (!item?.claim || !item?.how_to_replay) {
        fail(`claims_to_replay[${index}] requires claim and how_to_replay. Nothing written.`);
      }
    }
    record.claims_to_replay = claims.map((item) => ({ claim: item.claim, how_to_replay: item.how_to_replay }));
    if (record.claims_verdict != null && request.claims_verdict == null) {
      record.claims_verdict = null;
    }
  }
  if (request.claims_verdict != null) {
    if (kind !== "issue") fail("claims_verdict only applies to an issue");
    const claims = record.claims_to_replay ?? [];
    if (request.claims_verdict.length !== claims.length) {
      fail(
        `verdict of ${request.claims_verdict.length} entry(ies) for ${claims.length} claim(s). Nothing written.`,
      );
    }
    for (const [index, item] of request.claims_verdict.entries()) {
      if (item?.replayed !== true || !item?.result) {
        fail(`claims_verdict[${index}] : a claim is replayed and carries its result. Nothing written.`);
      }
    }
    record.claims_verdict = request.claims_verdict.map((item, index) => ({
      index,
      claim: item.claim ?? claims[index]?.claim ?? null,
      replayed: true,
      result: item.result,
      at: new Date().toISOString(),
    }));
  }
  if (request.criteria_ledger != null) {
    if (kind !== "issue") fail("criteria_ledger only applies to an issue");
    const vocabulary = rules.criterion_status ?? {};
    const criteria = record.acceptance_criteria ?? [];
    if (request.criteria_ledger.length !== criteria.length) {
      fail(
        `ledger of ${request.criteria_ledger.length} entry(ies) for ${criteria.length} criterion(s). Nothing written.`,
      );
    }
    for (const [index, item] of request.criteria_ledger.entries()) {
      if (!(vocabulary.values ?? []).includes(item.status)) {
        fail(`criterion ${index + 1} : unknown status ${item.status}. Nothing written.`);
      }
      if ((vocabulary.evidence_required_for ?? []).includes(item.status) && !item.evidence) {
        fail(`criterion ${index + 1} : ${item.status} requires evidence. Nothing written.`);
      }
    }
    record.criteria_ledger = request.criteria_ledger.map((item, index) => ({
      index,
      status: item.status,
      evidence: item.evidence ?? null,
      at: new Date().toISOString(),
    }));
  }
  if (request.spec_state != null) {
    if (kind !== "spec") fail("spec_state only applies to a spec record");
    const phases = ["draft", "active", "ready_for_pr", "pr_open", "merged"];
    const next = request.spec_state;
    if (!phases.includes(next.phase)) fail(`unknown spec phase: ${next.phase}`);
    const previous = record.spec_state ?? {};
    if (previous.phase != null) {
      const from = phases.indexOf(previous.phase);
      if (phases.indexOf(next.phase) < from) {
        fail(`spec transition forbidden : ${previous.phase}->${next.phase}. Nothing written.`);
      }
    }
    if (next.phase === "pr_open" && typeof (next.pr_url ?? previous.pr_url) !== "string") {
      fail("pr_open requires spec_state.pr_url. Nothing written.");
    }
    if (next.phase === "merged") {
      if (previous.phase !== "pr_open") {
        fail(`merged requires a recorded pr_open state, not ${previous.phase ?? "no phase"}. Nothing written.`);
      }
      if (!/^[a-f0-9]{7,64}$/i.test(next.merge_sha ?? "")) {
        fail("merged requires spec_state.merge_sha. Nothing written.");
      }
      if (typeof next.merged_at !== "string" || Number.isNaN(Date.parse(next.merged_at))) {
        fail("merged requires a valid spec_state.merged_at. Nothing written.");
      }
      if (typeof (next.pr_url ?? previous.pr_url) !== "string") {
        fail("merged requires the pull request URL recorded by pr_open. Nothing written.");
      }
    }
    record.spec_state = { ...previous, ...next };
  }
  if (request.spec_fields != null) {
    if (kind !== "spec") fail("spec_fields only applies to a spec record");
    const reserved = ["id", "spec_state", "contexts", "transitions", "created_at", "status"];
    for (const key of Object.keys(request.spec_fields)) {
      if (reserved.includes(key)) {
        fail(`spec_fields.${key} has its own write path. Nothing written.`);
      }
    }
    if (
      Object.hasOwn(request.spec_fields, "issues") &&
      scopeIsFrozen(record.spec_state?.phase) &&
      JSON.stringify(request.spec_fields.issues) !== JSON.stringify(record.issues) &&
      !scopeChangeAllowed(record.spec_state?.phase, request.scope_change)
    ) {
      fail(
        `spec issue list is frozen in ${record.spec_state?.phase}. Park findings. ` +
          `${scopeChangeInstruction(record.spec_state?.phase)} Nothing written.`,
      );
    }
    Object.assign(record, request.spec_fields);
  }
  if (request.discoveries_declared != null) {
    if (kind !== "issue") fail("discoveries_declared only applies to an issue");
    if (!Array.isArray(request.discoveries_declared)) {
      fail("discoveries_declared must be a list. Nothing written.");
    }
    for (const [index, item] of request.discoveries_declared.entries()) {
      if (!item?.title || !item?.rationale) {
        fail(`discoveries_declared[${index}] requires title and rationale. Nothing written.`);
      }
    }
    const merged = new Map(
      (record.discoveries_declared ?? []).map((item) => [item.title, { ...item }]),
    );
    const now = new Date().toISOString();
    for (const item of request.discoveries_declared) {
      const previous = merged.get(item.title);
      merged.set(item.title, {
        ...item,
        title: item.title,
        rationale: item.rationale,
        lands: item.lands ?? "parking",
        status: item.status ?? previous?.status ?? "parked",
        at: previous?.at ?? now,
      });
    }
    record.discoveries_declared = [...merged.values()];
  }
  if (request.set_status != null) {
    if (kind === "issue" && config.issue_tracker?.enabled !== false && config.issue_tracker != null) {
      fail("set_status cannot bypass the configured issue tracker. Nothing written.");
    }
    record.status = request.set_status;
  }
  if (request.append_context != null) {
    const { heading, body } = request.append_context;
    if (!heading || !body) fail("append_context requires heading and body");
    record.contexts = record.contexts ?? [];
    record.contexts.push({ heading, body, at: new Date().toISOString() });
  }

  const lines = readFileSync(path, "utf8").split("\n");
  let replaced = 0;
  const output = lines.map((line) => {
    if (line === entry.raw) {
      replaced += 1;
      return JSON.stringify(record);
    }
    return line;
  });
  if (replaced !== 1) fail(`the target line appears ${replaced} times, write refused`);
  atomicWrite(path, output.join("\n"));
  console.log(`written: ${path} record ${id} (1 line remplacee)`);
}

/**
 * Appends a new record at the end of the file, touching no other.
 *
 * `create_record.discovered_from` links the new record to the issue DURING
 * which the finding appeared. A discovery made along the way, a duplication
 * to factor out, a gap between the documented contract and the real
 * behaviour, a debt spotted, dies in a PR's prose if nothing attaches it.
 * This link gives it an owner and a traceable origin.
 *
 * `create_record.escaped_from` is a DISTINCT and optional field: the
 * already-closed issue the defect belongs to. The two are not the same, and
 * confusing them makes the escape measurement wrong; a finding made during
 * its source issue's cycle escaped nothing, it was caught in time. Fill it in
 * only when the named defect belonged to an issue closed before this cycle
 * began: it is then an escape, that is, a defect that crossed QA.
 *
 * @param request - request carrying create_record {kind, record,
 * discovered_from, escaped_from}
 * @param config - project configuration
 * @param rules - pipeline rules
 */
function create(request, config, rules) {
  const {
    kind,
    record,
    discovered_from: discoveredFrom,
    escaped_from: escapedFrom,
  } = request.create_record;
  if (kind !== "issue" && kind !== "spec") fail("create_record.kind must be issue or spec");
  if (!record?.id) fail("create_record.record.id missing");
  const source = trackerEntry(config, kind, record.id);
  if (source != null) {
    Object.assign(record, trackerSourceFields(kind, source.entry, source.snapshot));
    record.tracker = trackerBinding(source.entry);
  }
  if (discoveredFrom != null) {
    const type = rules.discovery_relationship;
    if (type == null) fail("discovery_relationship absent from the rules");
    record.relationships = [
      ...(record.relationships ?? []),
      { from: record.id, from_type: kind, to: discoveredFrom, to_type: "issue", type },
    ];
  }
  if (escapedFrom != null) {
    record.escaped_from = escapedFrom;
  }
  record.created_at = record.created_at ?? new Date().toISOString();
  if (kind === "issue") {
    try {
      validateState(record.pipeline_state ?? {}, rules);
    } catch (error) {
      fail(`state refused: ${error.message}. Nothing written.`);
    }
    const specs = readJsonl(join(config.store_dir, "specs.jsonl"));
    const spec = specs.find((entry) => entry.record.id === record.spec_id)?.record;
    const planned = Array.isArray(spec?.issues) && spec.issues.includes(record.id);
    if (
      spec != null &&
      scopeIsFrozen(spec.spec_state?.phase) &&
      !planned &&
      !scopeChangeAllowed(spec.spec_state?.phase, request.create_record.scope_change)
    ) {
      fail(
        `spec ${spec.id} is in ${spec.spec_state?.phase} and does not plan ${record.id}. ` +
          `Findings are parked by default. ${scopeChangeInstruction(spec.spec_state?.phase)}`,
      );
    }
  }
  const path = join(config.store_dir, `${kind}s.jsonl`);
  const entries = readJsonl(path);
  if (entries.some((e) => e.record.id === record.id)) fail(`id already present: ${record.id}`);
  if (kind === "issue") {
    const projected = projectedStatus(record.pipeline_state.phase, config);
    if (projected != null) {
      record.tracker_sync = {
        provider: "sudocode",
        desired_status: projected,
        requested_at: new Date().toISOString(),
      };
      delete record.status;
    }
  }
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const separator = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
  atomicWrite(path, existing + separator + JSON.stringify(record) + "\n");
  console.log(`written: ${path} record ${record.id} (1 line ajoutee)`);
}

main();
