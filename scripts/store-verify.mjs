import { join } from "node:path";
import { loadConfig, loadRules, readJsonl, fail } from "./lib.mjs";

/**
 * Verifie que les decouvertes declarees ont bien donne une issue.
 *
 * Une trouvaille declaree dans un handoff mais jamais creee retombe dans la
 * prose de PR, ou elle meurt. Le champ `discoveries_declared`, ecrit par
 * l'orchestrateur en persistant le handoff, rend cette dette opposable :
 * l'issue ne peut pas se fermer tant que chaque decouverte n'a pas son issue
 * reliee par `discovered-from`. Sans cette verification, le mecanisme serait
 * une consigne que rien ne fait mordre, donc une consigne qui s'auto-annule.
 *
 * @param record - Issue lue depuis le store.
 * @param all - Tous les records d'issues, pour retrouver les liens.
 * @param rules - Regles chargees, portant le type de relation.
 * @param path - Chemin du fichier, pour le message d'erreur.
 * @returns Le nombre d'invariants violes.
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
 * Verifie le registre de verification d'une issue.
 *
 * Le registre porte, pour chaque critere d'acceptation, ce qui est CONNU
 * comme vrai plutot que ce qui a ete declare : un critere n'est `verified`
 * que si un audit l'a constate dans l'environnement, avec sa preuve. Une
 * issue fermee dont un critere reste non verifie est un mensonge du store,
 * et c'est l'invariant que cette fonction refuse.
 *
 * @param record - Issue lue depuis le store.
 * @param rules - Regles chargees, portant le vocabulaire des statuts.
 * @param path - Chemin du fichier, pour le message d'erreur.
 * @returns Le nombre d'invariants violes.
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
 * Verifie les invariants du store apres une ecriture.
 *
 * Chaque ligne est un JSON valide, chaque id est unique dans son
 * fichier, chaque issue porte un etat valide au regard des regles.
 *
 * Usage : node store-verify.mjs
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
          console.error(`${path}: issue ${id} phase inconnue ${state.phase}`);
          problems += 1;
        } else if (rules.phases[state.phase].owner !== state.owner) {
          console.error(`${path}: issue ${id} owner ${state.owner} invalid for ${state.phase}`);
          problems += 1;
        }
        problems += verifyLedger(entry.record, rules, path);
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
