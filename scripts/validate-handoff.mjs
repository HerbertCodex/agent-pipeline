import { readFileSync, existsSync } from "node:fs";
import { loadRules, pathAllowed, sha256, fail } from "./lib.mjs";

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
    if (handoff[field] == null) errors.push(`champ manquant : ${field}`);
  }
  if (handoff.scope?.issue_id == null && handoff.mode === "issue_handoff") {
    errors.push("scope.issue_id manquant");
  }
  if (handoff.basis?.record_hash == null) errors.push("basis.record_hash manquant");
  if (handoff.mode === "issue_handoff" && handoff.basis?.pipeline_version == null) {
    errors.push("basis.pipeline_version manquant");
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
        errors.push(`le role ${agent} ne peut pas quitter la phase ${transition.from}`);
      }
    }

    const heading = handoff.context?.heading;
    const isClosure = transition?.to === "closed";
    if (!isClosure) {
      const allowed = rules.context_headings[agent] ?? [];
      if (heading == null) errors.push("context.heading manquant");
      else if (!allowed.includes(heading)) errors.push(`titre interdit pour ${agent} : ${heading}`);
      if (!handoff.context?.body) errors.push("context.body manquant");
    }

    if (agent === "qa" && !isClosure) {
      const fault = handoff.fault;
      if (fault == null) errors.push("un rejet QA porte un fault");
      else if (fault === "code") {
        const regression = handoff.regression;
        if (regression == null) errors.push("fault code sans bloc regression");
        else if (regression.required === true) {
          const route = rules.code_fault_routing.regression_required;
          if (transition?.to !== route.to) errors.push(`fault code required:true route vers ${route.to}`);
          if (heading !== route.heading) errors.push(`fault code required:true exige le titre ${route.heading}`);
          if (!regression.criterion) errors.push("regression.criterion manquant");
        } else if (regression.required === false) {
          const route = rules.code_fault_routing.regression_waived;
          if (transition?.to !== route.to) errors.push(`fault code required:false route vers ${route.to}`);
          if (heading !== route.heading) errors.push(`fault code required:false exige le titre ${route.heading}`);
          if (!regression.reason) errors.push("regression.reason manquant");
        } else errors.push("regression.required doit etre true ou false");
      } else {
        const target = rules.fault_routing[fault];
        if (target == null) errors.push(`fault inconnu : ${fault}`);
        else if (transition?.to !== target) errors.push(`fault ${fault} route vers ${target}, pas ${transition?.to}`);
      }
    }
    if (agent === "qa" && isClosure && handoff.fault != null) {
      errors.push("une validation ne porte pas de fault");
    }

    const vocabulary = rules.criterion_status;
    if (agent === "qa" && vocabulary != null) {
      const ledger = handoff.criteria_ledger;
      if (ledger == null) {
        errors.push(
          "criteria_ledger manquant : QA ecrit l'etat verifie de chaque critere, constate dans l'environnement",
        );
      } else {
        for (const [index, item] of ledger.entries()) {
          if (!vocabulary.values.includes(item?.status)) {
            errors.push(`criteria_ledger[${index}] : statut inconnu ${item?.status}`);
            continue;
          }
          if (vocabulary.evidence_required_for.includes(item.status) && !item.evidence) {
            errors.push(`criteria_ledger[${index}] : ${item.status} exige une preuve observee`);
          }
          if (isClosure && item.status !== vocabulary.closable) {
            errors.push(
              `cloture demandee alors que le critere ${index + 1} est ${item.status} : une issue ne se ferme pas sur un critere non verifie`,
            );
          }
        }
      }
    }

    if (agent === "implementer" && handoff.evidence?.commit_sha != null) {
      const claims = handoff.claims_to_replay;
      if (!Array.isArray(claims) || claims.length === 0) {
        errors.push(
          "claims_to_replay vide : un handoff qui porte un commit enumere ce qu'il AFFIRME, pour que QA sache quoi rejouer au lieu de lire un recit",
        );
      } else {
        for (const [index, item] of claims.entries()) {
          for (const field of ["claim", "how_to_replay"]) {
            if (!item?.[field]) errors.push(`claims_to_replay[${index}].${field} manquant`);
          }
        }
      }
    }

    if (agent === "qa" && transition?.to === "closed") {
      const verdicts = handoff.claims_verdict;
      if (!Array.isArray(verdicts) || verdicts.length === 0) {
        errors.push(
          "claims_verdict vide : une cloture confronte chaque affirmation de l'implementer, elle ne la croit pas",
        );
      } else {
        for (const [index, item] of verdicts.entries()) {
          if (!item?.claim) errors.push(`claims_verdict[${index}].claim manquant`);
          if (item?.replayed !== true) {
            errors.push(
              `claims_verdict[${index}] non rejoue : une affirmation non rejouee bloque la cloture, elle ne la ralentit pas`,
            );
          }
          if (!item?.result) errors.push(`claims_verdict[${index}].result manquant`);
        }
      }
    }

    const redRule = rules.red_proof;
    if (redRule != null && agent === redRule.agent && transition?.to === redRule.outcome) {
      const proof = handoff.evidence?.red_proof;
      if (proof == null) {
        errors.push(
          "evidence.red_proof manquant : un role qui ecrit ses tests et son code doit prouver la phase rouge observee",
        );
      } else {
        for (const field of redRule.fields) {
          if (proof[field] == null) errors.push(`evidence.red_proof.${field} manquant`);
        }
        if (proof.exit === 0) {
          errors.push("evidence.red_proof.exit vaut 0 : le test n'a jamais ete rouge");
        }
      }
    }
  }

  if (handoff.discoveries != null) {
    if (!Array.isArray(handoff.discoveries)) {
      errors.push("discoveries doit etre une liste");
    } else {
      for (const [index, item] of handoff.discoveries.entries()) {
        if (!item?.title) errors.push(`discoveries[${index}].title manquant`);
        if (!item?.rationale) {
          errors.push(
            `discoveries[${index}].rationale manquant : une trouvaille sans motif n'est pas actionnable`,
          );
        }
      }
    }
  }

  if (handoff.mode === "spec_proposal") {
    if (!Number.isInteger(handoff.round) || handoff.round < 1) {
      errors.push("round manquant ou invalide : une proposition se compte en tours, le premier vaut 1");
    }
    if (handoff.round > 1 && handoff.operator_feedback == null) {
      errors.push(
        `round ${handoff.round} sans operator_feedback : un tour qui ne dit pas ce que l'operateur a demande n'est pas un tour, c'est une reecriture`,
      );
    }
    const answered = handoff.operator_feedback?.decided ?? [];
    if (answered.length >= 2) {
      const check = handoff.answers_composition_check;
      if (check == null) {
        errors.push(
          `answers_composition_check manquant : ce tour repond a ${answered.length} decisions, et deux reponses defendables separement peuvent ne pas l'etre ensemble`,
        );
      } else {
        if (!Array.isArray(check.pairs_checked) || check.pairs_checked.length === 0) {
          errors.push("answers_composition_check.pairs_checked vide : nommer les paires confrontees, pas affirmer qu'on a regarde");
        } else {
          for (const [index, pair] of check.pairs_checked.entries()) {
            if (!Array.isArray(pair?.pair) || pair.pair.length < 2) {
              errors.push(`answers_composition_check.pairs_checked[${index}].pair doit nommer au moins deux decisions`);
            }
            if (typeof pair?.composes !== "boolean") {
              errors.push(`answers_composition_check.pairs_checked[${index}].composes doit valoir true ou false`);
            }
            if (pair?.composes === false && !pair?.note) {
              errors.push(
                `answers_composition_check.pairs_checked[${index}] : une paire qui ne compose pas se motive, sinon elle se perd`,
              );
            }
          }
        }
        if (!Array.isArray(check.conflicts_found)) {
          errors.push("answers_composition_check.conflicts_found manquant : l'absence de conflit se declare, elle ne se suppose pas");
        }
      }
    }
    const scope = handoff.functional_scope;
    if (scope == null) {
      errors.push(
        "functional_scope manquant : le perimetre fonctionnel se valide avant tout contrat et tout decoupage",
      );
    } else {
      if (!Array.isArray(scope.features) || scope.features.length === 0) {
        errors.push("functional_scope.features vide");
      } else {
        for (const [index, feature] of scope.features.entries()) {
          for (const field of ["name", "user_value", "rules"]) {
            if (feature?.[field] == null) errors.push(`functional_scope.features[${index}].${field} manquant`);
          }
          if (Array.isArray(feature?.rules) && feature.rules.length === 0) {
            errors.push(
              `functional_scope.features[${index}].rules vide : une fonctionnalite sans regle metier n'est pas validable`,
            );
          }
        }
      }
      if (!Array.isArray(scope.out_of_scope)) {
        errors.push(
          "functional_scope.out_of_scope manquant : ce qu'on ne fait pas se dit, sinon le client le suppose fait",
        );
      }
    }
    const decisions = handoff.decisions_for_operator;
    if (!Array.isArray(decisions)) {
      errors.push("decisions_for_operator manquant ou n'est pas une liste");
    } else if (decisions.length === 0 && handoff.scope_final !== true) {
      errors.push(
        "decisions_for_operator vide : une proposition qui ne soumet aucun choix est une decision deja prise. Si le perimetre est vraiment stabilise, declarer scope_final: true — le silence se dit, il ne se suppose pas",
      );
    } else {
      for (const [index, item] of decisions.entries()) {
        for (const field of ["question", "product_recommendation", "alternatives"]) {
          if (item?.[field] == null) errors.push(`decisions_for_operator[${index}].${field} manquant`);
        }
        if (Array.isArray(item?.alternatives) && item.alternatives.length === 0) {
          errors.push(
            `decisions_for_operator[${index}].alternatives vide : un choix sans autre option n'en est pas un`,
          );
        }
      }
    }
    if ((handoff.issues ?? []).length > 0) {
      errors.push(
        "une proposition ne porte pas d'issues : le decoupage se paie apres l'accord, pas avant",
      );
    }
  }

  if (handoff.mode === "spec_plan") {
    const approved = handoff.approved_proposal;
    if (approved == null) {
      errors.push(
        "approved_proposal manquant : un plan se derive d'une proposition que l'operateur a vue, jamais d'une intention",
      );
    } else {
      if (approved.approved_at == null) errors.push("approved_proposal.approved_at manquant");
      if (!Number.isInteger(approved.round) || approved.round < 1) {
        errors.push("approved_proposal.round manquant : on approuve un tour precis, pas une conversation");
      }
      const path = approved.path;
      if (path == null) errors.push("approved_proposal.path manquant");
      else if (!existsSync(path)) errors.push(`approved_proposal.path introuvable : ${path}`);
      else {
        const actual = sha256(readFileSync(path, "utf8"));
        if (actual !== approved.digest_sha256) {
          errors.push(
            `approved_proposal.digest_sha256 ne correspond pas au contenu de ${path} : declare ${approved.digest_sha256}, calcule ${actual}`,
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
    errors.push("un handoff avec commit_sha declare ses fichiers dans evidence.files");
  }
  if (nonAuthoring && handoff.evidence?.commit_sha != null) {
    errors.push(
      `le role ${agent} ne produit aucun commit : evidence.commit_sha doit etre null, le sha vit dans pipeline_state.last_commit_sha`,
    );
  }
  for (const file of handoff.evidence?.files ?? []) {
    if (!pathAllowed(file, policy)) errors.push(`chemin hors role pour ${agent} : ${file}`);
  }

  if (errors.length > 0) {
    for (const error of errors) console.error(`invalide : ${error}`);
    process.exit(1);
  }
  console.log(`handoff valide (${agent}, ${handoff.mode}, outcome ${handoff.outcome})`);
}

main();
