import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, loadRules, readJsonl, fail } from "./lib.mjs";

/**
 * Checks that declared discoveries really produced an issue.
 *
 * A finding declared in a handoff but never created falls back into PR prose,
 * where it dies. The `discoveries_declared` field, written by the
 * orchestrator when persisting the handoff, makes that debt enforceable: the
 * issue cannot close until every discovery has its issue linked by
 * `discovered-from`. Without this check the mechanism would be an instruction
 * no command can refuse, and so an instruction that never applies.
 *
 * @param record - Issue read from the store.
 * @param all - Every issue record, to find the links.
 * @param rules - Loaded rules, carrying the relation type.
 * @param path - File path, for the error message.
 * @returns The number of invariants violated.
 */
function verifyDiscoveries(record, all, rules, path) {
  const declared = record.discoveries_declared ?? [];
  if (declared.length === 0) return 0;
  if (record.pipeline_state?.phase !== "closed") return 0;

  const type = rules.discovery_relationship;
  const linked = all.filter((other) =>
    (other.relationships ?? []).some(
      (relation) => relation.type === type && relation.to === record.id,
    ),
  );
  if (linked.length >= declared.length) return 0;

  console.error(
    `${path}: issue ${record.id} closed with ${declared.length} declared discovery(ies) and ${linked.length} created issue(s)`,
  );
  return 1;
}

/**
 * Checks an issue's verification ledger.
 *
 * The ledger carries, for each acceptance criterion, what is KNOWN to be true
 * rather than what was declared: a criterion is `verified` only if an audit
 * observed it in the environment, with its evidence. A closed issue with a
 * criterion still unverified is a lie in the store, and that is the invariant
 * this function refuses.
 *
 * @param record - Issue read from the store.
 * @param rules - Loaded rules, carrying the status vocabulary.
 * @param path - File path, for the error message.
 * @returns The number of invariants violated.
 */
function verifyLedger(record, rules, path) {
  const vocabulary = rules.criterion_status;
  if (vocabulary == null) return 0;

  const criteria = record.acceptance_criteria ?? [];
  const ledger = record.criteria_ledger;
  const id = record.id;
  let problems = 0;

  if (ledger == null) {
    if (record.pipeline_state?.phase !== "closed" || criteria.length === 0) return 0;
    const waiver = record.criteria_ledger_waived;
    if (waiver?.reason && waiver?.at) return 0;
    console.error(
      `${path}: issue ${id} closed with no verification ledger and no dated waiver`,
    );
    return 1;
  }

  if (ledger.length !== criteria.length) {
    console.error(
      `${path}: issue ${id} ledger of ${ledger.length} entry(ies) for ${criteria.length} criterion(s)`,
    );
    problems += 1;
  }

  for (const [index, item] of ledger.entries()) {
    if (!vocabulary.values.includes(item.status)) {
      console.error(`${path}: issue ${id} criterion ${index + 1} unknown status ${item.status}`);
      problems += 1;
      continue;
    }
    const needsEvidence = vocabulary.evidence_required_for.includes(item.status);
    if (needsEvidence && !item.evidence) {
      console.error(`${path}: issue ${id} criterion ${index + 1} ${item.status} with no evidence`);
      problems += 1;
    }
    if (record.pipeline_state?.phase === "closed" && item.status !== vocabulary.closable) {
      console.error(
        `${path}: issue ${id} closed while criterion ${index + 1} is ${item.status}`,
      );
      problems += 1;
    }
  }
  return problems;
}


/**
 * Checks that an escaped defect left a rule behind, not only a fix.
 *
 * `escaped_from` marks an issue that repairs a defect QA let through. Until
 * now the pipeline recorded that fact and did nothing with it: the fix
 * shipped, the issue closed, and the next agent could reproduce the same
 * mistake with nothing in the way. Counting escapes is not learning from
 * them.
 *
 * Closure therefore requires a `prevention` block naming what now stops it
 * recurring — either `gate`, a command in the configuration that refuses it,
 * or `pitfall`, a line written into the profile's pitfalls document. Both are
 * verified rather than believed: an unknown command key and a pitfall the
 * document does not carry are refused.
 *
 * A free-text note is not accepted. "We will be careful" is what this whole
 * framework exists to replace.
 *
 * @param record - Issue read from the store.
 * @param config - Project configuration, for the declared commands.
 * @param path - File path, for the error message.
 * @returns The number of invariants violated.
 */
function verifyPrevention(record, config, path) {
  if (record.escaped_from == null) return 0;
  if (record.pipeline_state?.phase !== "closed") return 0;

  const prevention = record.prevention;
  if (prevention == null || typeof prevention !== "object") {
    console.error(
      `${path}: issue ${record.id} escaped from ${record.escaped_from} and closes with no prevention. ` +
        "A defect that crossed QA once crosses it again unless something new refuses it: name the gate " +
        "that now does, or the pitfall now written down.",
    );
    return 1;
  }

  if (typeof prevention.gate === "string" && prevention.gate.length > 0) {
    if (config.commands?.[prevention.gate] == null) {
      console.error(`${path}: issue ${record.id} prevention.gate "${prevention.gate}" is no declared command`);
      return 1;
    }
    return 0;
  }

  if (typeof prevention.pitfall === "string" && prevention.pitfall.length > 0) {
    const document = join(config.profiles_dir, config.profile, "pitfalls.md");
    if (!existsSync(document)) {
      console.error(`${path}: issue ${record.id} prevention.pitfall names ${document}, which does not exist`);
      return 1;
    }
    if (!readFileSync(document, "utf8").includes(prevention.pitfall)) {
      console.error(
        `${path}: issue ${record.id} prevention.pitfall is not in ${document}. ` +
          "A pitfall declared but never written is a pitfall nobody will read.",
      );
      return 1;
    }
    return 0;
  }

  console.error(
    `${path}: issue ${record.id} prevention names neither a gate nor a pitfall. ` +
      "A note saying it will not happen again is what this framework exists to replace.",
  );
  return 1;
}

/**
 * Checks the store invariants after a write.
 *
 * Every line is valid JSON, every id is unique within its file, and every
 * issue carries a state valid against the rules.
 *
 * Usage: node store-verify.mjs
 */
function main() {
  const config = loadConfig();
  const rules = loadRules();
  let problems = 0;

  for (const kind of ["issues", "specs"]) {
    const path = join(config.store_dir, `${kind}.jsonl`);
    let entries;
    try {
      entries = readJsonl(path);
    } catch (error) {
      console.error(`${path}: line invalid JSON (${error.message})`);
      problems += 1;
      continue;
    }
    const seen = new Set();
    for (const entry of entries) {
      const id = entry.record.id;
      if (id == null) {
        console.error(`${path}:${entry.index + 1} record with no id`);
        problems += 1;
        continue;
      }
      if (seen.has(id)) {
        console.error(`${path}: id duplique ${id}`);
        problems += 1;
      }
      seen.add(id);
      if (kind === "issues") {
        const state = entry.record.pipeline_state;
        if (state == null) {
          console.error(`${path}: issue ${id} with no pipeline_state`);
          problems += 1;
        } else if (rules.phases[state.phase] == null) {
          console.error(`${path}: issue ${id} unknown phase ${state.phase}`);
          problems += 1;
        } else if (rules.phases[state.phase].owner !== state.owner) {
          console.error(`${path}: issue ${id} owner ${state.owner} invalid for ${state.phase}`);
          problems += 1;
        }
        problems += verifyLedger(entry.record, rules, path);
        problems += verifyPrevention(entry.record, config, path);
        problems += verifyDiscoveries(
          entry.record,
          entries.map((e) => e.record),
          rules,
          path,
        );
      }
    }
  }

  if (problems > 0) fail(`${problems} invariant(s) viole(s)`);
  console.log("store-verify: invariants respectes.");
}

main();
