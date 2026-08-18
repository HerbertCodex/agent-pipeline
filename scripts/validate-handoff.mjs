import { readFileSync, existsSync } from "node:fs";
import { loadRules, pathAllowed, sha256, fail } from "./lib.mjs";
import { reviewDigest } from "./render-proposal.mjs";

/**
 * Confronte une proposition a la page que l'operateur est cense avoir lue.
 *
 * Le cadre produisait ces pages sans que rien n'oblige a les produire :
 * une habitude, donc une regle qui ne s'applique que les jours ou l'on y
 * pense. Elle est desormais adossee a une commande qui echoue, comme
 * `approved_proposal` l'est deja pour la phase 2.
 *
 * La page porte l'empreinte de ce qu'elle affiche ; on la recalcule ici
 * depuis la proposition. Une page rendue depuis un perimetre plus ancien
 * ne correspond donc plus, et une proposition que personne n'a rendue n'a
 * rien a presenter.
 *
 * @param handoff - proposition soumise
 * @param errors - liste d'erreurs a completer
 */
function checkReviewPage(handoff, errors) {
  const page = handoff.review_page;
  if (page == null || typeof page.path !== "string" || page.path.length === 0) {
    errors.push(
      "review_page.path missing: a proposal nobody rendered is a proposal nobody read. " +
        "Run render-proposal.mjs, hand the page to the operator, then declare it here.",
    );
    return;
  }
  if (!existsSync(page.path)) {
    errors.push(`review_page.path not found: ${page.path}`);
    return;
  }
  const rendered = readFileSync(page.path, "utf8").match(/name="proposal-review-digest" content="([0-9a-f]{64})"/);
  if (rendered == null) {
    errors.push(
      `review_page ${page.path} carries no review digest: it was not produced by render-proposal.mjs, ` +
        "so nothing confronts it with this proposal.",
    );
    return;
  }
  const expected = reviewDigest(handoff);
  if (rendered[1] !== expected) {
    errors.push(
      `review_page ${page.path} does not match this proposal: page ${rendered[1].slice(0, 8)}, ` +
        `proposal ${expected.slice(0, 8)}. The scope moved after rendering — render it again and have it re-read.`,
    );
  }
}

/**
 * Valide un handoff d'agent contre la source machine des regles.
 *
 * Verifie la forme, le role emetteur, la transition demandee, le titre
 * de contexte autorise pour ce role, la coherence du routage de faute
 * QA, et les chemins declares contre la politique de fichiers du role.
 * Ne verifie pas le diff reel : c'est le travail de verify-scope.mjs.
 *
 * Une spec passe par deux modes et l'operateur est entre les deux.
 * `spec_proposal` soumet les choix et ne porte aucune issue ; `spec_plan`
 * exige `approved_proposal` et confronte son `digest_sha256` au contenu
 * reel du fichier approuve. Product ne peut donc pas livrer un plan
 * persistable sur une proposition que personne n'a lue — un decoupage
 * ecrit avant l'accord fait decouvrir le produit a son proprietaire une
 * fois qu'il est trop cher a changer.
 *
 * Usage : node validate-handoff.mjs <handoff.json>
 */
function main() {
  const handoffPath = process.argv[2];
  if (!handoffPath) fail("usage : validate-handoff.mjs <handoff.json>");
  const handoff = JSON.parse(readFileSync(handoffPath, "utf8"));
  const rules = loadRules();
  const errors = [];

  for (const field of ["schema_version", "mode", "agent", "scope", "basis", "outcome"]) {
    if (handoff[field] == null) errors.push(`missing field: ${field}`);
  }
  if (handoff.scope?.issue_id == null && handoff.mode === "issue_handoff") {
    errors.push("scope.issue_id missing");
  }
  if (handoff.basis?.record_hash == null) errors.push("basis.record_hash missing");
  if (handoff.mode === "issue_handoff" && handoff.basis?.pipeline_version == null) {
    errors.push("basis.pipeline_version missing");
  }

  const agent = handoff.agent;
  if (handoff.mode === "issue_handoff") {
    const transition = handoff.requested_transition;
    if (transition?.from == null || transition?.to == null) {
      errors.push("requested_transition.from/to manquants");
    } else {
      if (!rules.transitions.includes(`${transition.from}->${transition.to}`)) {
        errors.push(`transition interdite : ${transition.from}->${transition.to}`);
      }
      const sources = rules.transition_source[agent] ?? [];
      if (!sources.includes(transition.from)) {
        errors.push(`role ${agent} cannot leave phase ${transition.from}`);
      }
    }

    const heading = handoff.context?.heading;
    const isClosure = transition?.to === "closed";
    if (!isClosure) {
      const allowed = rules.context_headings[agent] ?? [];
      if (heading == null) errors.push("context.heading missing");
      else if (!allowed.includes(heading)) errors.push(`heading forbidden for ${agent}: ${heading}`);
      if (!handoff.context?.body) errors.push("context.body missing");
    }

    if (agent === "qa" && !isClosure) {
      const fault = handoff.fault;
      if (fault == null) errors.push("a QA rejection carries a fault");
      else if (fault === "code") {
        const regression = handoff.regression;
        if (regression == null) errors.push("fault code with no regression block");
        else if (regression.required === true) {
          const route = rules.code_fault_routing.regression_required;
          if (transition?.to !== route.to) errors.push(`fault code required:true routes to ${route.to}`);
          if (heading !== route.heading) errors.push(`fault code required:true exige le titre ${route.heading}`);
          if (!regression.criterion) errors.push("regression.criterion missing");
        } else if (regression.required === false) {
          const route = rules.code_fault_routing.regression_waived;
          if (transition?.to !== route.to) errors.push(`fault code required:false routes to ${route.to}`);
          if (heading !== route.heading) errors.push(`fault code required:false exige le titre ${route.heading}`);
          if (!regression.reason) errors.push("regression.reason missing");
        } else errors.push("regression.required must be true or false");
      } else {
        const target = rules.fault_routing[fault];
        if (target == null) errors.push(`fault inconnu : ${fault}`);
        else if (transition?.to !== target) errors.push(`fault ${fault} routes to ${target}, not ${transition?.to}`);
      }
    }
    if (agent === "qa" && isClosure && handoff.fault != null) {
      errors.push("an approval carries no fault");
    }

    const vocabulary = rules.criterion_status;
    if (agent === "qa" && vocabulary != null) {
      const ledger = handoff.criteria_ledger;
      if (ledger == null) {
        errors.push(
          "criteria_ledger missing: QA writes the verified state of every criterion, observed in the environment",
        );
      } else {
        for (const [index, item] of ledger.entries()) {
          if (!vocabulary.values.includes(item?.status)) {
            errors.push(`criteria_ledger[${index}] : statut inconnu ${item?.status}`);
            continue;
          }
          if (vocabulary.evidence_required_for.includes(item.status) && !item.evidence) {
            errors.push(`criteria_ledger[${index}]: ${item.status} requires observed evidence`);
          }
          if (isClosure && item.status !== vocabulary.closable) {
            errors.push(
              `closure requested while criterion ${index + 1} is ${item.status}: an issue does not close on an unverified criterion`,
            );
          }
        }
      }
    }

    if (agent === "implementer" && handoff.evidence?.commit_sha != null) {
      const claims = handoff.claims_to_replay;
      if (!Array.isArray(claims) || claims.length === 0) {
        errors.push(
          "claims_to_replay empty: a handoff carrying a commit enumerates what it ASSERTS, so QA knows what to replay instead of reading a story",
        );
      } else {
        for (const [index, item] of claims.entries()) {
          for (const field of ["claim", "how_to_replay"]) {
            if (!item?.[field]) errors.push(`claims_to_replay[${index}].${field} missing`);
          }
        }
      }
    }

    if (agent === "qa" && transition?.to === "closed") {
      const verdicts = handoff.claims_verdict;
      if (!Array.isArray(verdicts) || verdicts.length === 0) {
        errors.push(
          "claims_verdict empty: a closure confronts every implementer claim, it does not believe it",
        );
      } else {
        for (const [index, item] of verdicts.entries()) {
          if (!item?.claim) errors.push(`claims_verdict[${index}].claim missing`);
          if (item?.replayed !== true) {
            errors.push(
              `claims_verdict[${index}] not replayed: an unreplayed claim blocks the closure, it does not slow it down`,
            );
          }
          if (!item?.result) errors.push(`claims_verdict[${index}].result missing`);
        }
      }
    }

    const redRule = rules.red_proof;
    if (redRule != null && agent === redRule.agent && transition?.to === redRule.outcome) {
      const proof = handoff.evidence?.red_proof;
      if (proof == null) {
        errors.push(
          "evidence.red_proof missing: a role writing both its tests and its code must prove the red phase it observed",
        );
      } else {
        for (const field of redRule.fields) {
          if (proof[field] == null) errors.push(`evidence.red_proof.${field} missing`);
        }
        if (proof.exit === 0) {
          errors.push("evidence.red_proof.exit is 0: the test was never red");
        }
      }
    }
  }

  if (handoff.discoveries != null) {
    if (!Array.isArray(handoff.discoveries)) {
      errors.push("discoveries must be a list");
    } else {
      for (const [index, item] of handoff.discoveries.entries()) {
        if (!item?.title) errors.push(`discoveries[${index}].title missing`);
        if (!item?.rationale) {
          errors.push(
            `discoveries[${index}].rationale missing: a finding with no rationale is not actionable`,
          );
        }
      }
    }
  }

  if (handoff.mode === "spec_proposal") {
    checkReviewPage(handoff, errors);
    if (!Number.isInteger(handoff.round) || handoff.round < 1) {
      errors.push("round missing or invalid: a proposal is counted in rounds, the first one is 1");
    }
    if (handoff.round > 1 && handoff.operator_feedback == null) {
      errors.push(
        `round ${handoff.round} with no operator_feedback: a round that does not say what the operator asked is not a round, it is a rewrite`,
      );
    }
    const answered = handoff.operator_feedback?.decided ?? [];
    if (answered.length >= 2) {
      const check = handoff.answers_composition_check;
      if (check == null) {
        errors.push(
          `answers_composition_check missing: this round answers ${answered.length} decisions, and two answers defensible on their own may not be defensible together`,
        );
      } else {
        if (!Array.isArray(check.pairs_checked) || check.pairs_checked.length === 0) {
          errors.push("answers_composition_check.pairs_checked empty: name the pairs confronted, do not assert that you looked");
        } else {
          for (const [index, pair] of check.pairs_checked.entries()) {
            if (!Array.isArray(pair?.pair) || pair.pair.length < 2) {
              errors.push(`answers_composition_check.pairs_checked[${index}].pair must name at least two decisions`);
            }
            if (typeof pair?.composes !== "boolean") {
              errors.push(`answers_composition_check.pairs_checked[${index}].composes must be true or false`);
            }
            if (pair?.composes === false && !pair?.note) {
              errors.push(
                `answers_composition_check.pairs_checked[${index}]: a non-composing pair carries its reason, otherwise it is lost`,
              );
            }
          }
        }
        if (!Array.isArray(check.conflicts_found)) {
          errors.push("answers_composition_check.conflicts_found missing: an absence of conflict is declared, not assumed");
        }
      }
    }
    const scope = handoff.functional_scope;
    if (scope == null) {
      errors.push(
        "functional_scope missing: the functional scope is validated before any contract and any decomposition",
      );
    } else {
      if (!Array.isArray(scope.features) || scope.features.length === 0) {
        errors.push("functional_scope.features empty");
      } else {
        for (const [index, feature] of scope.features.entries()) {
          for (const field of ["name", "user_value", "rules"]) {
            if (feature?.[field] == null) errors.push(`functional_scope.features[${index}].${field} missing`);
          }
          if (Array.isArray(feature?.rules) && feature.rules.length === 0) {
            errors.push(
              `functional_scope.features[${index}].rules empty: a feature with no business rule cannot be validated`,
            );
          }
        }
      }
      if (!Array.isArray(scope.out_of_scope)) {
        errors.push(
          "functional_scope.out_of_scope missing: what is not built is stated, otherwise the client assumes it is",
        );
      }
    }
    const decisions = handoff.decisions_for_operator;
    if (!Array.isArray(decisions)) {
      errors.push("decisions_for_operator missing or not a list");
    } else if (decisions.length === 0 && handoff.scope_final !== true) {
      errors.push(
        "decisions_for_operator empty: a proposal submitting no choice is a decision already taken. If the scope really is settled, declare scope_final: true. Silence is stated, not assumed",
      );
    } else {
      for (const [index, item] of decisions.entries()) {
        for (const field of ["question", "product_recommendation", "alternatives"]) {
          if (item?.[field] == null) errors.push(`decisions_for_operator[${index}].${field} missing`);
        }
        if (Array.isArray(item?.alternatives) && item.alternatives.length === 0) {
          errors.push(
            `decisions_for_operator[${index}].alternatives empty: a choice with no other option is not a choice`,
          );
        }
      }
    }
    if ((handoff.issues ?? []).length > 0) {
      errors.push(
        "a proposal carries no issues: the decomposition is paid for after the agreement, not before",
      );
    }
  }

  if (handoff.mode === "spec_plan") {
    const approved = handoff.approved_proposal;
    if (approved == null) {
      errors.push(
        "approved_proposal missing: a plan derives from a proposal the operator saw, never from an intention",
      );
    } else {
      if (approved.approved_at == null) errors.push("approved_proposal.approved_at missing");
      if (!Number.isInteger(approved.round) || approved.round < 1) {
        errors.push("approved_proposal.round missing: a precise round is approved, not a conversation");
      }
      const path = approved.path;
      if (path == null) errors.push("approved_proposal.path missing");
      else if (!existsSync(path)) errors.push(`approved_proposal.path not found: ${path}`);
      else {
        const actual = sha256(readFileSync(path, "utf8"));
        if (actual !== approved.digest_sha256) {
          errors.push(
            `approved_proposal.digest_sha256 does not match the content of ${path}: declared ${approved.digest_sha256}, computed ${actual}`,
          );
        }
      }
    }
  }

  const policy = rules.file_policy?.[agent];
  const nonAuthoring = (rules.non_authoring_agents ?? []).includes(agent);
  if (
    !nonAuthoring &&
    handoff.evidence?.commit_sha != null &&
    (handoff.evidence.files ?? []).length === 0
  ) {
    errors.push("a handoff with a commit_sha declares its files in evidence.files");
  }
  if (nonAuthoring && handoff.evidence?.commit_sha != null) {
    errors.push(
      `role ${agent} produces no commit: evidence.commit_sha must be null, the sha lives in pipeline_state.last_commit_sha`,
    );
  }
  for (const file of handoff.evidence?.files ?? []) {
    if (!pathAllowed(file, policy)) errors.push(`path outside role ${agent}: ${file}`);
  }

  if (errors.length > 0) {
    for (const error of errors) console.error(`invalid: ${error}`);
    process.exit(1);
  }
  console.log(`handoff valid (${agent}, ${handoff.mode}, outcome ${handoff.outcome})`);
}

main();
