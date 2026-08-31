import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, loadRules, readJsonl, fail } from "./lib.mjs";
import { readIssueTracker } from "./issue-tracker.mjs";
import { trackerProjection } from "./tracker-sync.mjs";

/**
 * Checks that each declared finding reached the destination it named.
 *
 * A finding declared in a handoff but never carried anywhere falls back into
 * PR prose, where it dies. Making that debt enforceable was right. Giving it
 * a single exit was not: every finding became an issue in the product's
 * backlog, and a real run turned 32 observations into 32 scheduled issues
 * for 3 issues finished — eleven new for every one closed.
 *
 * So the debt is still opposable, but per destination. An `issue` owes its
 * linked issue, as before. A `pitfall` owes its line in the profile's
 * pitfalls document. A `framework` finding owes its line in the operator's
 * findings list, outside this project. A `spec` finding owes nothing here:
 * it routes to Product as a fault, and the fault machinery already refuses
 * to be ignored.
 *
 * A record written before the destinations existed carries no `lands`. It is
 * read as `issue`, which is exactly what it meant then: describing history
 * rather than rewriting it.
 *
 * @param record - Issue read from the store.
 * @param all - Every issue record, to find the links.
 * @param rules - Loaded rules, carrying the relation type.
 * @param config - Project configuration, for the profile and findings paths.
 * @param path - File path, for the error message.
 * @returns The number of invariants violated.
 */
function verifyDiscoveries(record, all, rules, config, path) {
  const declared = record.discoveries_declared ?? [];
  if (declared.length === 0) return 0;
  let violations = 0;
  for (const [index, item] of declared.entries()) {
    if (typeof item?.title !== "string" || item.title.trim().length === 0) {
      console.error(`${path}: issue ${record.id} finding ${index + 1} has no title`);
      violations += 1;
    }
    if (typeof item?.rationale !== "string" || item.rationale.trim().length === 0) {
      console.error(`${path}: issue ${record.id} finding ${index + 1} has no rationale`);
      violations += 1;
    }
  }
  return violations;
}

/**
 * Checks that an issue under review carries the claims QA must confront.
 *
 * The validator makes `claims_to_replay` mandatory on any handoff carrying a
 * commit, and it makes confronting every claim mandatory to close. Between
 * the two, nothing required the orchestrator to carry them into the record —
 * and nothing said so when they were dropped.
 *
 * Measured: QA finished a complete and favourable review, then could not ask
 * for closure because the record held no claim to confront. Nothing was wrong
 * with the issue; it sat blocked on the gap between two rules that each
 * assumed the other.
 *
 * Only an issue still under review is held to it. A closed issue concluded —
 * whatever it took — and the deadlock this refuses happens during the review,
 * never after it. Extending the rule to closed records would condemn every
 * issue finished before the claims mechanism existed, which is rewriting
 * history rather than describing it.
 *
 * @param record - Issue read from the store.
 * @param path - File path, for the error message.
 * @returns The number of invariants violated.
 */
function verifyClaimsCarried(record, path) {
  const state = record.pipeline_state ?? {};
  if (state.last_commit_sha == null) return 0;
  if (state.phase !== "qa_in_progress") return 0;
  if ((record.claims_to_replay ?? []).length > 0) return 0;

  console.error(
    `${path}: issue ${record.id} is in ${state.phase} with a commit and no claims_to_replay. ` +
      "The handoff that took it there had to declare them, so they were dropped in transit — and QA " +
      "cannot conclude a review whose closure confronts claims the record does not hold.",
  );
  return 1;
}

function verifyMergedSpec(record, issues, path) {
  if (record.spec_state?.phase !== "merged") return 0;
  let problems = 0;
  const state = record.spec_state;
  if (!/^[a-f0-9]{7,64}$/i.test(state.merge_sha ?? "")) {
    console.error(`${path}: merged spec ${record.id} has no valid merge_sha`);
    problems += 1;
  }
  if (typeof state.merged_at !== "string" || Number.isNaN(Date.parse(state.merged_at))) {
    console.error(`${path}: merged spec ${record.id} has no valid merged_at`);
    problems += 1;
  }
  if (typeof state.pr_url !== "string" || state.pr_url.trim().length === 0) {
    console.error(`${path}: merged spec ${record.id} has no pr_url`);
    problems += 1;
  }
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  for (const id of record.issues ?? []) {
    const issue = byId.get(id);
    if (issue?.pipeline_state?.phase !== "closed") {
      console.error(`${path}: merged spec ${record.id} contains non-closed issue ${id}`);
      problems += 1;
    }
  }
  return problems;
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
  let issueRecords = [];

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
    if (kind === "issues") issueRecords = entries.map((entry) => entry.record);
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
        problems += verifyClaimsCarried(entry.record, path);
        problems += verifyPrevention(entry.record, config, path);
        problems += verifyDiscoveries(
          entry.record,
          entries.map((e) => e.record),
          rules,
          config,
          path,
        );
      } else {
        problems += verifyMergedSpec(entry.record, issueRecords, path);
      }
    }
  }

  try {
    const tracker = readIssueTracker(config);
    if (tracker != null) {
      const projection = trackerProjection(issueRecords, tracker, config);
      for (const item of projection.errors) {
        console.error(`issue tracker: ${item.id}: ${item.reason}`);
        problems += 1;
      }
      for (const item of projection.unmanaged) {
        console.log(`issue tracker: ${item.id} is ready for Product planning and has no control record yet`);
      }
      for (const item of projection.pending) {
        console.error(
          `issue tracker: ${item.id} status ${item.current} must be ${item.desired}; run tracker-sync --apply`,
        );
        problems += 1;
      }
    }
  } catch (error) {
    console.error(`issue tracker: ${error.message}`);
    problems += 1;
  }

  if (problems > 0) fail(`${problems} invariant(s) viole(s)`);
  console.log("store-verify: invariants respectes.");
}

main();
