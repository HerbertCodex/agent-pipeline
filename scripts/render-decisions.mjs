import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, loadRules, readJsonl, pathAllowed, fail } from "./lib.mjs";
import { esc, pad, shell, SURFACE_HINT } from "./page.mjs";

/**
 * Dit si un role peut prendre en charge toutes les reservations d'une issue.
 *
 * Approximation assumee : la comparaison porte sur le motif de reservation
 * lui-meme et non sur les fichiers qu'il designera, qui n'existent pas
 * encore. Elle suffit a distinguer un perimetre entierement interdit d'un
 * perimetre ouvert, et c'est la seule question posee ici.
 *
 * @param reservations - motifs reserves par l'issue
 * @param policy - politique de fichiers du role
 * @returns vrai si aucun motif reserve n'est hors de la politique
 */
function roleCanTake(reservations, policy) {
  if (reservations.length === 0) return false;
  return reservations.every((reservation) => pathAllowed(reservation, policy));
}

/**
 * Rend une carte de decision.
 *
 * @param entry - contenu de la carte
 * @returns le fragment HTML de la carte
 */
function card(entry) {
  const alts = (entry.options ?? []).map((option) => `<li><span>${esc(option)}</span></li>`).join("");
  return `<div class="open${entry.urgent ? " urgent" : ""}">
<h3><span class="qid">${esc(entry.id)}</span>${esc(entry.question)}${
    entry.chip ? `<span class="chip${entry.urgent ? " alarm" : ""}">${esc(entry.chip)}</span>` : ""
  }</h3>
${entry.why ? `<p>${esc(entry.why)}</p>` : ""}
${entry.paths?.length ? `<p class="lbl">Perimetre</p><p class="paths">${entry.paths.map((p) => esc(p)).join(" · ")}</p>` : ""}
${entry.recommendation ? `<p class="lbl">Recommandation</p><p class="reco">${esc(entry.recommendation)}</p>` : ""}
${alts ? `<p class="lbl">Autres options</p><ul class="alts">${alts}</ul>` : ""}
</div>`;
}

/**
 * Rend une section de cartes, ou une phrase quand il n'y a rien.
 *
 * @param heading - titre de la section
 * @param blurb - phrase de cadrage
 * @param entries - cartes a rendre
 * @param empty - phrase affichee quand la liste est vide
 * @returns le fragment HTML de la section
 */
function section(heading, blurb, entries, empty) {
  const body = entries.length > 0
    ? `<div class="features">${entries.map(card).join("")}</div>`
    : `<p class="empty">${esc(empty)}</p>`;
  return `<section><div class="sec-head"><h2>${esc(heading)}</h2><p>${esc(blurb)}</p></div>${body}</section>`;
}

/**
 * Rend la file des arbitrages qui attendent l'operateur.
 *
 * Ce que l'operateur doit trancher se derive du store et de la politique de
 * fichiers : une issue dont aucun role ne peut prendre le perimetre est du
 * travail operateur, qu'elle le dise ou non. `next-issues` la presente
 * pourtant comme dispatchable, parce qu'il calcule la disjonction des
 * reservations sans lire `file_policy` — cette page comble cet ecart au lieu
 * de demander a chacun de s'en souvenir.
 *
 * Usage : node render-decisions.mjs <sortie.html> [proposition.json]
 */
function main() {
  const [target, proposalPath] = process.argv.slice(2);
  if (!target) fail("usage : render-decisions.mjs <sortie.html> [proposition.json]");

  const config = loadConfig();
  const rules = loadRules();
  const issues = readJsonl(join(config.store_dir, "issues.jsonl")).map((entry) => entry.record);
  const blockingPhases = Object.entries(rules.phases ?? {})
    .filter(([name]) => name.startsWith("blocked_") || name === "operator_escalation")
    .map(([name]) => name);

  const authoring = Object.keys(config.file_policy ?? {}).filter((role) => role !== "orchestrator");

  const orphaned = [];
  const blocked = [];
  for (const issue of issues) {
    const phase = issue.pipeline_state?.phase;
    if (phase === "closed") continue;
    const reservations = issue.pipeline_state?.file_reservations ?? [];
    if (blockingPhases.includes(phase)) {
      blocked.push({
        id: issue.id,
        question: issue.title,
        chip: phase,
        urgent: true,
        why: `Cette issue est arretee en ${phase} et attend une levee. Tant qu'elle y reste, elle tient ses reservations et bloque toute issue qui les croise.`,
        paths: reservations,
      });
      continue;
    }
    const takers = authoring.filter((role) => roleCanTake(reservations, config.file_policy[role]));
    if (takers.length === 0) {
      orphaned.push({
        id: issue.id,
        question: issue.title,
        chip: "aucun agent possible",
        urgent: true,
        why: "Tout son perimetre est hors de la politique de fichiers de chaque role qui ecrit. Aucun implementer ne peut la prendre : c'est du travail operateur, pas une issue en attente de dispatch.",
        paths: reservations,
      });
    }
  }

  const dispatchable = issues.filter((issue) => {
    const phase = issue.pipeline_state?.phase;
    if (phase !== "planned") return false;
    const reservations = issue.pipeline_state?.file_reservations ?? [];
    return authoring.some((role) => roleCanTake(reservations, config.file_policy[role]));
  });

  const pending = [];
  if (proposalPath != null) {
    if (!existsSync(proposalPath)) fail(`proposition introuvable : ${proposalPath}`);
    const proposal = JSON.parse(readFileSync(proposalPath, "utf8"));
    if (proposal.mode !== "spec_proposal") fail("le second argument doit etre une proposition de spec");
    for (const decision of proposal.decisions_for_operator ?? []) {
      pending.push({
        id: decision.id ?? "?",
        question: decision.question,
        recommendation: decision.product_recommendation,
        options: decision.alternatives ?? [],
      });
    }
    if (proposal.scope_final === true) {
      pending.push({
        id: "OK",
        question: `Approuver le perimetre du tour ${proposal.round} pour decoupage ?`,
        chip: "perimetre arrete",
        recommendation:
          "Product declare le perimetre arrete et ne soumet plus aucun choix. Approuver fige le document : la phase 2 est refusee si son contenu bouge d'un caractere.",
        options: ["Approuver et lancer le decoupage", "Demander un tour de plus en disant ce qui manque"],
      });
    }
  }

  const counts = [
    ["A trancher", pending.length],
    ["Bloquees", blocked.length],
    ["Sans agent possible", orphaned.length],
    ["Dispatchables", dispatchable.length],
  ]
    .map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${value}</dd></div>`)
    .join("");

  const total = pending.length + blocked.length + orphaned.length;
  const body = `<header class="masthead">
<p class="eyebrow">File d'arbitrage · ${issues.length} issues au store · ${esc(new Date().toISOString().slice(0, 10))}</p>
<h1>Ce qui attend votre decision</h1>
<p class="lede">${
    total === 0
      ? "Rien n'attend d'arbitrage : aucune issue bloquee, aucune hors de portee des agents, aucune question de spec ouverte."
      : `${total} point(s) ne peuvent avancer sans vous. Le pipeline continue sur le reste.`
  }</p>
<dl class="stamp">${counts}</dl>
<p class="verbatim">Cette page est <strong>calculee</strong> depuis le store et la politique de fichiers, pas redigee. Une issue dont aucun role ne peut prendre le perimetre y figure meme si personne ne l'a signalee.</p>
</header>
${section("Questions de spec", "Choix soumis par Product. Rien n'est decoupe avant votre reponse.", pending, "Aucune question de spec ouverte.")}
${section("Arretees, en attente d'une levee", "Ces issues tiennent leurs reservations tant qu'elles sont bloquees.", blocked, "Aucune issue bloquee.")}
${section("Aucun agent ne peut les prendre", "Perimetre entierement hors de la politique de fichiers des roles qui ecrivent. next-issues les presente pourtant comme dispatchables.", orphaned, "Toute issue ouverte a un role capable de la prendre.")}
<section><div class="sec-head"><h2>Ce qui avance sans vous</h2></div>
<p class="note">${dispatchable.length} issue(s) <code>planned</code> ont un role capable de les prendre et n'attendent aucun arbitrage. ${
    total > 0 ? "Les points ci-dessus ne les bloquent pas, sauf si leurs reservations se croisent." : ""
  }</p></section>`;

  writeFileSync(target, shell("File d'arbitrage", body));
  console.log(
    `ecrit : ${target} (${pending.length} question(s) de spec, ${blocked.length} bloquee(s), ${orphaned.length} sans agent, ${dispatchable.length} dispatchable(s))`,
  );
  console.log(SURFACE_HINT);
}

main();
