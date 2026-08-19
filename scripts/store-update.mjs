import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, loadRules, readJsonl, sha256, sudocodeStatus, fail } from "./lib.mjs";

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
    const amendment = from === to;
    if (from != null && !amendment && !(rules.transitions ?? []).includes(`${from}->${to}`)) {
      fail(`transition ${from}->${to} absent from rules.json. Nothing written.`);
    }
    const at = request.pipeline_state.last_transition_at ?? new Date().toISOString();
    record.pipeline_state = request.pipeline_state;
    const mirrored = sudocodeStatus(request.pipeline_state.phase, config.sudocode);
    if (mirrored != null) record.status = mirrored;

    if (!amendment) {
      record.transitions = [
        ...(record.transitions ?? []),
        { from, to, at, version: request.pipeline_state.version },
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
        title: item.title,
        rationale: item.rationale,
        at: previous?.at ?? now,
      });
    }
    record.discoveries_declared = [...merged.values()];
  }
  if (request.set_status != null) record.status = request.set_status;
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
  writeFileSync(path, output.join("\n"));
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
  }
  const path = join(config.store_dir, `${kind}s.jsonl`);
  const entries = readJsonl(path);
  if (entries.some((e) => e.record.id === record.id)) fail(`id deja present : ${record.id}`);
  if (kind === "issue") {
    const mirrored = sudocodeStatus(record.pipeline_state.phase, config.sudocode);
    if (mirrored != null && record.status == null) record.status = mirrored;
  }
  mkdirSync(config.store_dir, { recursive: true });
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const separator = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
  writeFileSync(path, existing + separator + JSON.stringify(record) + "\n");
  console.log(`written: ${path} record ${record.id} (1 line ajoutee)`);
}

main();
