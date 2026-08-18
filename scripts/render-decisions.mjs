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
${entry.recommendation ? `<p class="lbl">Recommendation</p><p class="reco">${esc(entry.recommendation)}</p>` : ""}
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
  if (!target) fail("usage: render-decisions.mjs <output.html> [proposal.json]");

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
        why: `This issue is stopped in ${phase} and waits to be released. As long as it stays there it holds its reservations and blocks any issue that crosses them.`,
        paths: reservations,
      });
      continue;
    }
    const takers = authoring.filter((role) => roleCanTake(reservations, config.file_policy[role]));
    if (takers.length === 0) {
      orphaned.push({
        id: issue.id,
        question: issue.title,
        chip: "no possible agent",
        urgent: true,
        why: "Its whole scope is outside the file policy of every writing role. No implementer can take it: this is operator work, not an issue waiting to be dispatched.",
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
    if (!existsSync(proposalPath)) fail(`proposal not found: ${proposalPath}`);
    const proposal = JSON.parse(readFileSync(proposalPath, "utf8"));
    if (proposal.mode !== "spec_proposal") fail("the second argument must be a spec proposal");
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
        question: `Approve the scope of round ${proposal.round} for decomposition?`,
        chip: "scope settled",
        recommendation:
          "Product declares the scope settled and submits no further choice. Approving freezes the document: phase 2 is refused if its content moves by a single charactere.",
        options: ["Approve and start the decomposition", "Demander un tour de plus en disant ce qui manque"],
      });
    }
  }

  const counts = [
    ["A trancher", pending.length],
    ["Bloquees", blocked.length],
    ["No possible agent", orphaned.length],
    ["Dispatchables", dispatchable.length],
  ]
    .map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${value}</dd></div>`)
    .join("");

  const total = pending.length + blocked.length + orphaned.length;
  const body = `<header class="masthead">
<p class="eyebrow">Arbitration queue &middot; ${issues.length} issues in the store &middot; ${esc(new Date().toISOString().slice(0, 10))}</p>
<h1>What awaits your decision</h1>
<p class="lede">${
    total === 0
      ? "Nothing awaits arbitration: no blocked issue, none out of reach of the agents, no open spec question."
      : `${total} point(s) cannot move without you. The pipeline carries on with the rest.`
  }</p>
<dl class="stamp">${counts}</dl>
<p class="verbatim">This page is <strong>computed</strong> from the store and the file policy, not written. An issue whose scope no role can take appears here even if nobody reported it.</p>
</header>
${section("Spec questions", "Choices submitted by Product. Nothing is decomposed before your answer.", pending, "No open spec question.")}
${section("Stopped, waiting to be released", "These issues hold their reservations for as long as they stay blocked.", blocked, "No blocked issue.")}
${section("No agent can take these", "Scope entirely outside the file policy of the writing roles. next-issues presents them as dispatchable all the same.", orphaned, "Every open issue has a role able to take it.")}
<section><div class="sec-head"><h2>What moves without you</h2></div>
<p class="note">${dispatchable.length} issue(s) in <code>planned</code> have a role able to take them and await no decision. ${
    total > 0 ? "The points above do not block them, unless their reservations intersect." : ""
  }</p></section>`;

  writeFileSync(target, shell("File d'arbitrage", body));
  console.log(
    `written: ${target} (${pending.length} spec question(s), ${blocked.length} blocked, ${orphaned.length} with no agent, ${dispatchable.length} dispatchable)`,
  );
  console.log(SURFACE_HINT);
}

main();
