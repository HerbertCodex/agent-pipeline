import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, loadRules, readJsonl, sha256, sudocodeStatus, fail } from "./lib.mjs";

/**
 * Valide un bloc d'etat contre la source machine des regles.
 *
 * @param state - bloc pipeline_state propose
 * @param rules - regles chargees depuis <rules_path>
 * @throws {Error} si un champ obligatoire manque, si la phase ou le
 * proprietaire sont inconnus, ou s'ils ne correspondent pas
 */
function validateState(state, rules) {
  for (const field of rules.state_required_fields) {
    if (!(field in state)) throw new Error(`pipeline_state.${field} manquant`);
  }
  const phase = rules.phases[state.phase];
  if (phase == null) throw new Error(`phase inconnue : ${state.phase}`);
  if (phase.owner !== state.owner) {
    throw new Error(`proprietaire ${state.owner} invalide pour la phase ${state.phase} (attendu ${phase.owner})`);
  }
  if (!Number.isInteger(state.version) || state.version < 1) throw new Error("version invalide");
}

/**
 * Applique une requete d'ecriture au store avec verrou optimiste.
 *
 * La requete JSON contient : target {kind, id}, expected_record_hash, et au
 * choix pipeline_state, acceptance_criteria, criteria_ledger,
 * discoveries_declared, spec_state {phase, pr_url}, spec_fields,
 * append_context {heading, body}, set_status, ou create_record pour une
 * creation. Seule la ligne visee est reecrite ; toute autre ligne est
 * recopiee octet pour octet.
 *
 * `pipeline_state` confronte le couple (phase quittee, phase visee) a
 * `rules.transitions` et refuse ce qui n'y figure pas. Une phase identique de
 * part et d'autre est un AMENDEMENT : la version avance, le journal
 * `transitions` n'enregistre rien, parce qu'aucune transition n'a eu lieu et
 * qu'un faux mouvement fausserait la mesure.
 *
 * `acceptance_criteria` reecrit le contrat d'une issue quand une revision de
 * spec le change. Il efface alors `criteria_ledger` : un registre etabli
 * contre d'autres criteres n'est pas une preuve sur ceux-la. Sans ce chemin,
 * une issue revisee gardait ses criteres perimes et devenait inclosable,
 * `store-verify` mesurant la longueur du registre contre eux.
 *
 * `spec_fields` fusionne les champs normatifs d'un record de spec, hors
 * champs qui ont deja leur propre chemin d'ecriture.
 *
 * `criteria_ledger` porte ce qui est CONNU comme vrai de chaque critere, une
 * entree par critere d'acceptation, dans l'ordre. Il n'enregistre pas ce
 * qu'un agent declare avoir fait : il enregistre ce qu'un audit a constate
 * dans l'environnement, avec sa preuve.
 *
 * `discoveries_declared` inscrit les trouvailles annoncees par un handoff.
 * C'est ce que `store-verify` confronte aux issues reellement creees pour
 * refuser une cloture qui les aurait perdues. L'invariant existait sans ce
 * chemin d'ecriture : il ne pouvait donc jamais mordre.
 *
 * Usage : node store-update.mjs <requete.json>
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
  if (kind !== "issue" && kind !== "spec") fail("target.kind doit etre issue ou spec");
  const path = join(config.store_dir, `${kind}s.jsonl`);
  const entries = readJsonl(path);
  const entry = entries.find((e) => e.record.id === id);
  if (entry == null) fail(`record introuvable : ${id}`);

  const currentHash = sha256(entry.raw);
  if (request.expected_record_hash !== currentHash) {
    fail(`verrou optimiste : hash attendu ${request.expected_record_hash}, hash courant ${currentHash}. Aucune ecriture.`);
  }

  const record = entry.record;
  if (request.pipeline_state != null) {
    try {
      validateState(request.pipeline_state, rules);
    } catch (error) {
      fail(`etat refuse : ${error.message}. Aucune ecriture.`);
    }
    const previous = record.pipeline_state;
    if (previous != null && request.pipeline_state.version !== previous.version + 1) {
      fail(`version attendue ${previous.version + 1}, recue ${request.pipeline_state.version}. Aucune ecriture.`);
    }
    const from = previous?.phase ?? null;
    const to = request.pipeline_state.phase;
    const amendment = from === to;
    if (from != null && !amendment && !(rules.transitions ?? []).includes(`${from}->${to}`)) {
      fail(`transition ${from}->${to} absente de rules.json. Aucune ecriture.`);
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
    if (kind !== "issue") fail("acceptance_criteria ne s'applique qu'a une issue");
    const next = request.acceptance_criteria;
    if (!Array.isArray(next) || next.length === 0) {
      fail("acceptance_criteria doit etre une liste non vide. Aucune ecriture.");
    }
    for (const [index, item] of next.entries()) {
      if (typeof item !== "string" || item.trim().length === 0) {
        fail(`acceptance_criteria[${index}] doit etre une chaine non vide. Aucune ecriture.`);
      }
    }
    record.acceptance_criteria = next;
    if (record.criteria_ledger != null && request.criteria_ledger == null) {
      record.criteria_ledger = null;
    }
  }
  if (request.claims_to_replay != null) {
    if (kind !== "issue") fail("claims_to_replay ne s'applique qu'a une issue");
    const claims = request.claims_to_replay;
    if (!Array.isArray(claims) || claims.length === 0) {
      fail("claims_to_replay doit etre une liste non vide. Aucune ecriture.");
    }
    for (const [index, item] of claims.entries()) {
      if (!item?.claim || !item?.how_to_replay) {
        fail(`claims_to_replay[${index}] exige claim et how_to_replay. Aucune ecriture.`);
      }
    }
    record.claims_to_replay = claims.map((item) => ({ claim: item.claim, how_to_replay: item.how_to_replay }));
    if (record.claims_verdict != null && request.claims_verdict == null) {
      record.claims_verdict = null;
    }
  }
  if (request.claims_verdict != null) {
    if (kind !== "issue") fail("claims_verdict ne s'applique qu'a une issue");
    const claims = record.claims_to_replay ?? [];
    if (request.claims_verdict.length !== claims.length) {
      fail(
        `verdict de ${request.claims_verdict.length} entree(s) pour ${claims.length} affirmation(s). Aucune ecriture.`,
      );
    }
    for (const [index, item] of request.claims_verdict.entries()) {
      if (item?.replayed !== true || !item?.result) {
        fail(`claims_verdict[${index}] : une affirmation se rejoue et porte son resultat. Aucune ecriture.`);
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
    if (kind !== "issue") fail("criteria_ledger ne s'applique qu'a une issue");
    const vocabulary = rules.criterion_status ?? {};
    const criteria = record.acceptance_criteria ?? [];
    if (request.criteria_ledger.length !== criteria.length) {
      fail(
        `registre de ${request.criteria_ledger.length} entree(s) pour ${criteria.length} critere(s). Aucune ecriture.`,
      );
    }
    for (const [index, item] of request.criteria_ledger.entries()) {
      if (!(vocabulary.values ?? []).includes(item.status)) {
        fail(`critere ${index + 1} : statut inconnu ${item.status}. Aucune ecriture.`);
      }
      if ((vocabulary.evidence_required_for ?? []).includes(item.status) && !item.evidence) {
        fail(`critere ${index + 1} : ${item.status} exige une preuve. Aucune ecriture.`);
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
    if (kind !== "spec") fail("spec_state ne s'applique qu'a un record de spec");
    const phases = ["draft", "active", "ready_for_pr", "pr_open", "merged"];
    const next = request.spec_state;
    if (!phases.includes(next.phase)) fail(`phase de spec inconnue : ${next.phase}`);
    const previous = record.spec_state ?? {};
    if (previous.phase != null) {
      const from = phases.indexOf(previous.phase);
      if (phases.indexOf(next.phase) < from) {
        fail(`transition de spec interdite : ${previous.phase}->${next.phase}. Aucune ecriture.`);
      }
    }
    record.spec_state = { ...previous, ...next };
  }
  if (request.spec_fields != null) {
    if (kind !== "spec") fail("spec_fields ne s'applique qu'a un record de spec");
    const reserved = ["id", "spec_state", "contexts", "transitions", "created_at", "status"];
    for (const key of Object.keys(request.spec_fields)) {
      if (reserved.includes(key)) {
        fail(`spec_fields.${key} a son propre chemin d'ecriture. Aucune ecriture.`);
      }
    }
    Object.assign(record, request.spec_fields);
  }
  if (request.discoveries_declared != null) {
    if (kind !== "issue") fail("discoveries_declared ne s'applique qu'a une issue");
    if (!Array.isArray(request.discoveries_declared)) {
      fail("discoveries_declared doit etre une liste. Aucune ecriture.");
    }
    for (const [index, item] of request.discoveries_declared.entries()) {
      if (!item?.title || !item?.rationale) {
        fail(`discoveries_declared[${index}] exige title et rationale. Aucune ecriture.`);
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
    if (!heading || !body) fail("append_context exige heading et body");
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
  if (replaced !== 1) fail(`la ligne cible apparait ${replaced} fois, ecriture refusee`);
  writeFileSync(path, output.join("\n"));
  console.log(`ecrit : ${path} record ${id} (1 ligne remplacee)`);
}

/**
 * Ajoute un nouveau record en fin de fichier, sans toucher aux autres.
 *
 * `create_record.discovered_from` relie le nouveau record a l'issue PENDANT
 * laquelle la trouvaille est apparue. Une decouverte faite en route — un
 * doublon a mutualiser, un ecart entre le contrat documente et le
 * comportement reel, une dette apercue — meurt dans la prose d'une PR si rien
 * ne l'attache. Ce lien lui donne un porteur et une origine consultable.
 *
 * `create_record.escaped_from` est un champ DISTINCT et facultatif : l'issue
 * deja fermee a laquelle le defaut appartient. Les deux ne se confondent pas,
 * et les confondre rend la mesure d'echappees fausse — une trouvaille faite
 * pendant le cycle de son issue source n'a rien echappe, elle a ete attrapee
 * a temps. Ne le renseigner que lorsque le defaut nomme relevait d'une issue
 * close avant que ce cycle ne commence : c'est alors une echappee, c'est-a-dire
 * un defaut qui a franchi QA.
 *
 * @param request - requete portant create_record {kind, record,
 * discovered_from, escaped_from}
 * @param config - configuration du projet
 * @param rules - regles du pipeline
 */
function create(request, config, rules) {
  const {
    kind,
    record,
    discovered_from: discoveredFrom,
    escaped_from: escapedFrom,
  } = request.create_record;
  if (kind !== "issue" && kind !== "spec") fail("create_record.kind doit etre issue ou spec");
  if (!record?.id) fail("create_record.record.id manquant");
  if (discoveredFrom != null) {
    const type = rules.discovery_relationship;
    if (type == null) fail("discovery_relationship absent des regles");
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
      fail(`etat refuse : ${error.message}. Aucune ecriture.`);
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
  console.log(`ecrit : ${path} record ${record.id} (1 ligne ajoutee)`);
}

main();
