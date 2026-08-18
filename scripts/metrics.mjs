import { join } from "node:path";
import { loadConfig, loadRules, readJsonl } from "./lib.mjs";

/**
 * Rend les mesures de debit et de qualite derivables du store.
 *
 * Le seul indicateur de qualite qui compte est l'ECHAPPEE : un defaut qui a
 * franchi QA et qu'on decouvre plus tard. Il se lit dans le champ
 * `escaped_from`, et NON dans la relation `discovered-from` — celle-ci dit ou
 * une trouvaille est apparue, pas ce qui l'a laissee passer. Les confondre
 * gonfle l'indicateur exactement quand le mecanisme est bien utilise, ce qui
 * est arrive : 18 decouvertes attrapees a temps ont ete rapportees comme 18
 * echappees.
 *
 * Le reste — cycles, durees, rejets — mesure le debit, pas la qualite : une QA
 * qui ne rejette jamais ne prouve rien, elle peut aussi bien n'avoir aucune
 * case ou ranger ce qu'elle trouve.
 *
 * Aucune de ces valeurs n'est une statistique. Sur un projet, quelques
 * dizaines d'issues et un seul operateur, ce sont des indications, et la
 * tentation de lire un effet dans du bruit est le risque principal.
 *
 * Usage : node metrics.mjs [--spec <spec-id>] [--json]
 */
function main() {
  const args = process.argv.slice(2);
  const specIndex = args.indexOf("--spec");
  const specId = specIndex === -1 ? null : args[specIndex + 1];
  const asJson = args.includes("--json");

  const config = loadConfig();
  const rules = loadRules();
  const records = readJsonl(join(config.store_dir, "issues.jsonl")).map((e) => e.record);
  const discoveryType = rules.discovery_relationship;

  const inSpec = new Set(
    records.filter((r) => specId == null || r.spec_id === specId).map((r) => r.id),
  );

  const originOf = (record) =>
    (record.relationships ?? [])
      .filter((relation) => relation.type === discoveryType)
      .map((relation) => relation.to);

  const scoped = records.filter(
    (r) => inSpec.has(r.id) || originOf(r).some((origin) => inSpec.has(origin)),
  );

  const issues = scoped.map((record) => {
    const transitions = record.transitions ?? [];
    const stamps = transitions.map((t) => t.at).filter(Boolean).sort();
    const origins = originOf(record);

    return {
      id: record.id,
      phase: record.pipeline_state?.phase ?? null,
      cycles: transitions.length || null,
      qa_code_rejections: record.pipeline_state?.qa_code_rejections ?? 0,
      returned_to_work: transitions.filter((t) => t.from === "qa_in_progress" && t.to !== "closed")
        .length,
      minutes: durationMinutes(stamps[0], record.closed_at ?? stamps[stamps.length - 1]),
      criteria: (record.acceptance_criteria ?? []).length,
      verified: (record.criteria_ledger ?? []).filter((c) => c.status === "verified").length,
      ledger: record.criteria_ledger != null,
      escaped_from: record.escaped_from ?? null,
      discovered_from: origins,
    };
  });

  const escapes = issues.filter((i) => i.escaped_from != null);
  const discoveries = issues.filter((i) => i.discovered_from.length > 0);

  const planned = issues.filter((i) => inSpec.has(i.id));
  const instrumented = planned.filter((i) => i.cycles != null);
  const withLedger = planned.filter((i) => i.ledger);

  const summary = {
    spec: specId ?? "toutes",
    issues: planned.length,
    closed: planned.filter((i) => i.phase === "closed").length,
    decouvertes: discoveries.length,
    echappees: escapes.length,
    rejets_qa_code: planned.reduce((sum, i) => sum + i.qa_code_rejections, 0),
    retours_apres_qa: planned.reduce((sum, i) => sum + i.returned_to_work, 0),
    issues_instrumentees: `${instrumented.length}/${planned.length}`,
    issues_avec_registre: `${withLedger.length}/${planned.length}`,
  };

  if (asJson) {
    console.log(JSON.stringify({ summary, issues }, null, 2));
    return;
  }

  console.log(`# Mesures — spec ${summary.spec}\n`);
  for (const [key, value] of Object.entries(summary)) {
    if (key === "spec") continue;
    console.log(`  ${key.padEnd(22)} ${value}`);
  }

  console.log("\n## Par issue\n");
  console.log("  id        phase           cycles  min   criteres  rejets  retours");
  for (const issue of issues) {
    console.log(
      `  ${issue.id.padEnd(9)} ${(issue.phase ?? "-").padEnd(15)} ` +
        `${String(issue.cycles ?? "-").padStart(6)}  ${String(issue.minutes ?? "-").padStart(3)}   ` +
        `${String(`${issue.verified}/${issue.criteria}`).padStart(8)}  ` +
        `${String(issue.qa_code_rejections).padStart(6)}  ${String(issue.returned_to_work).padStart(7)}`,
    );
  }

  console.log("\n## Echappees — defauts passes par QA, trouves plus tard\n");
  if (escapes.length > 0) {
    for (const issue of escapes) {
      console.log(`  ${issue.id} echappee de ${issue.escaped_from}`);
    }
  } else if (discoveries.length === 0) {
    console.log(
      "  aucune enregistree, et AUCUNE decouverte non plus : ce zero ne mesure rien.\n" +
        "  Il dit que le mecanisme n'a pas servi, pas qu'aucun defaut n'a echappe.",
    );
  } else {
    console.log(
      `  aucune enregistree, sur ${discoveries.length} decouverte(s).\n\n` +
        "  Ce zero est lisible, mais lisez-le pour ce qu'il dit : aucune des decouvertes\n" +
        "  ne porte `escaped_from`, donc toutes ont ete trouvees PENDANT le cycle de leur\n" +
        "  issue source — attrapees a temps, rien n'a franchi QA. Une trouvaille reliee par\n" +
        "  `discovered-from` n'est PAS une echappee : ce champ dit ou elle est apparue, pas\n" +
        "  ce qui l'a laissee passer. Les confondre gonfle l'indicateur exactement quand le\n" +
        "  mecanisme est bien utilise.",
    );
  }

  if (instrumented.length < issues.length) {
    console.log(
      `\n  ${issues.length - instrumented.length} issue(s) sans historique de transitions : anterieures a l'instrumentation, ni cycles ni duree calculables.`,
    );
  }
}

/**
 * Rend la duree en minutes entre deux horodatages.
 *
 * @param start - Horodatage de depart, ou absence.
 * @param end - Horodatage d'arrivee, ou absence.
 * @returns La duree arrondie en minutes, ou `null` si elle n'est pas calculable.
 */
function durationMinutes(start, end) {
  if (!start || !end) return null;
  const ms = Date.parse(end) - Date.parse(start);
  return Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 60000) : null;
}

main();
