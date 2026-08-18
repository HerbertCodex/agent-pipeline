import { readFileSync, writeFileSync } from "node:fs";
import { fail } from "./lib.mjs";
import { esc, pad, shell, SURFACE_HINT } from "./page.mjs";

/**
 * Rend une section de fonctionnalites avec leurs regles numerotees.
 *
 * @param features - liste des fonctionnalites du perimetre
 * @returns le fragment HTML de la section, vide si la liste l'est
 */
function renderFeatures(features) {
  if (!features?.length) return "";
  const items = features
    .map(
      (f, i) => `<article class="feature">
<header><span class="num">${pad(i)}</span><h3>${esc(f.name)}</h3></header>
<p class="value">${esc(f.user_value)}</p>
<ol class="rules">${(f.rules ?? [])
        .map((r, j) => `<li><span class="rid">R${j + 1}</span><p>${esc(r)}</p></li>`)
        .join("")}</ol>
</article>`,
    )
    .join("");
  return `<section><div class="sec-head"><h2>Ce que le produit fait</h2>
<p>${features.length} fonctionnalites. Chaque regle numerotee est un engagement contraignant, pas une intention.</p></div>
<div class="features">${items}</div></section>`;
}

/**
 * Rend la liste des exclusions declarees.
 *
 * @param entries - contenu de functional_scope.out_of_scope
 * @returns le fragment HTML, vide si aucune exclusion n'est declaree
 */
function renderExclusions(entries) {
  if (!entries?.length) return "";
  return `<section><div class="sec-head"><h2>Ce que le produit ne fait pas</h2>
<p>${entries.length} exclusions nommees. Ce qui n'est pas ecrit ici est suppose fait — c'est pourquoi elles sont explicites.</p></div>
<ol class="excl">${entries
    .map((e, i) => `<li><span class="rid">${pad(i)}</span><p>${esc(e)}</p></li>`)
    .join("")}</ol></section>`;
}

/**
 * Rend une liste d'engagements numerotes.
 *
 * @param entries - liste de textes d'engagement
 * @param heading - titre de la section
 * @param blurb - phrase de cadrage sous le titre
 * @returns le fragment HTML, vide si la liste l'est
 */
function renderPledges(entries, heading, blurb) {
  if (!entries?.length) return "";
  return `<section><div class="sec-head"><h2>${esc(heading)}</h2><p>${esc(blurb)}</p></div>
<ol class="pledges">${entries
    .map((e, i) => `<li><span class="rid">${pad(i)}</span><p>${esc(e)}</p></li>`)
    .join("")}</ol></section>`;
}

/**
 * Rend les choix qui attendent encore l'arbitrage de l'operateur.
 *
 * Cette section vient avant le perimetre : un tour ouvert se lit d'abord par
 * ce qu'il demande, pas par ce qu'il propose.
 *
 * @param decisions - contenu de decisions_for_operator
 * @returns le fragment HTML, vide quand plus rien n'est ouvert
 */
function renderDecisions(decisions) {
  if (!decisions?.length) return "";
  const cards = decisions
    .map(
      (d) => `<div class="open">
<h3><span class="qid">${esc(d.id ?? "?")}</span>${esc(d.question)}</h3>
<p class="lbl">Recommandation</p><p class="reco">${esc(d.product_recommendation)}</p>
<p class="lbl">Autres options</p>
<ul class="alts">${(d.alternatives ?? []).map((a) => `<li><span>${esc(a)}</span></li>`).join("")}</ul>
</div>`,
    )
    .join("");
  return `<section><div class="sec-head"><h2>Ce qui attend votre arbitrage</h2>
<p>${decisions.length} choix soumis. Rien n'est decoupe avant votre reponse.</p></div>
<div class="features">${cards}</div></section>`;
}

/**
 * Rend les titres du decoupage envisage.
 *
 * @param titles - contenu de decomposition_titles
 * @returns le fragment HTML, vide si aucun titre n'est propose
 */
function renderTitles(titles) {
  const list = titles?.titles;
  if (!list?.length) return "";
  const note = titles.parallelism_intent ?? titles.effect_of_n5 ?? titles.note;
  return `<section><div class="sec-head"><h2>Decoupage envisage</h2>
<p>${list.length} issues. Aucun contenu d'issue n'est ecrit avant l'accord.</p></div>
<div class="waves">${list
    .map((t, i) => `<div class="wave"><span class="rid">${pad(i)}</span><p>${esc(t)}</p></div>`)
    .join("")}</div>
${note ? `<p class="note">${esc(note)}</p>` : ""}</section>`;
}

/**
 * Rend une proposition de spec en page HTML autonome, prete a publier.
 *
 * Le rendu est deterministe et sans decision de mise en forme au moment de
 * publier : deux tours successifs se comparent a l'oeil parce que seule leur
 * substance change. Le texte est repris tel quel, jamais reformule — une
 * relecture obligeante creerait un ecart entre ce que l'operateur lit et ce
 * que l'empreinte de `approved_proposal` fige.
 *
 * Usage : node render-proposal.mjs <proposition.json> <sortie.html>
 */
function main() {
  const [source, target] = process.argv.slice(2);
  if (!source || !target) fail("usage : render-proposal.mjs <proposition.json> <sortie.html>");

  let handoff;
  try {
    handoff = JSON.parse(readFileSync(source, "utf8"));
  } catch (error) {
    fail(`proposition illisible : ${error.message}`);
  }
  if (handoff.mode !== "spec_proposal") {
    fail(`mode ${handoff.mode} : seul un spec_proposal se rend en page de relecture`);
  }

  const scope = handoff.functional_scope ?? {};
  const open = handoff.decisions_for_operator ?? [];
  const features = scope.features ?? [];
  const rules = features.reduce((total, f) => total + (f.rules?.length ?? 0), 0);
  const pledges =
    (handoff.design_commitments_carried_into_issues ?? []).length + (handoff.pr_commitments ?? []).length;
  const specId = handoff.scope?.spec_id ?? "spec";
  const status = handoff.scope_final === true ? "perimetre arrete" : `${open.length} question(s) ouverte(s)`;
  const title = handoff.title ?? `Perimetre ${specId}`;

  const counts = [
    ["Fonctionnalites", features.length],
    ["Regles", rules],
    ["Exclusions", (scope.out_of_scope ?? []).length],
    ["Engagements", pledges],
    ["Issues prevues", (handoff.decomposition_titles?.titles ?? []).length],
    ["Questions ouvertes", open.length],
  ]
    .filter(([, value]) => value > 0 || value === 0)
    .map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${value}</dd></div>`)
    .join("");

  const digest = handoff.handoff_file?.digest_sha256;
  const feedback = handoff.operator_feedback?.summary;

  const body = `<header class="masthead">
<p class="eyebrow">Spec ${esc(specId)} · phase 1 · tour ${esc(handoff.round ?? "?")} · ${esc(status)}</p>
<h1>${esc(title)}</h1>
${scope.intent ? `<p class="lede">${esc(scope.intent)}</p>` : ""}
<dl class="stamp">${counts}${
    digest
      ? `<div style="flex-basis:100%"><dt>Empreinte du document</dt><dd class="digest">${esc(digest)}</dd></div>`
      : ""
  }</dl>
<p class="verbatim">Texte repris <strong>verbatim</strong> de la proposition, sans reformulation : une relecture obligeante creerait un ecart entre ce que vous lisez et ce que l'empreinte fige.</p>
${feedback ? `<p class="note"><strong>Depuis le tour precedent.</strong> ${esc(feedback)}</p>` : ""}
</header>
${renderDecisions(open)}
${renderFeatures(features)}
${renderExclusions(scope.out_of_scope)}
${renderPledges(handoff.design_commitments_carried_into_issues, "Engagements de conception", "Contraintes portees dans les issues et opposables en revue. Ce ne sont pas des conseils.")}
${renderPledges(handoff.pr_commitments, "Ce que la PR dira", "Engagements de transparence. Les surfaces exposees sont nommees, pas attenuees.")}
${renderTitles(handoff.decomposition_titles)}
<section><div class="sec-head"><h2>Ce que l'approbation engage</h2></div>
<p class="note">Approuver ce document en fige le contenu. ${
    digest ? `L'empreinte <code>${esc(digest.slice(0, 8))}…</code> lie la phase 2 : ` : "La phase 2 est liee a ce document : "
  }tout decoupage derive d'un autre document, ou de celui-ci modifie apres coup, est refuse par <code>validate-handoff</code> avec un code de sortie non nul. <strong>Ce que ce document ne dit pas ne sera pas construit ; ce qu'il dit de travers sera construit de travers.</strong></p></section>
`;

  const page = shell(`Perimetre ${specId}`, body);
  writeFileSync(target, page);
  console.log(
    `ecrit : ${target} (tour ${handoff.round}, ${features.length} fonctionnalites, ${rules} regles, ${open.length} question(s) ouverte(s))`,
  );
  console.log(SURFACE_HINT);
}

main();
