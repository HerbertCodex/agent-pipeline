import { readFileSync, writeFileSync } from "node:fs";
import { fail, sha256 } from "./lib.mjs";
import { esc, pad, shell, SURFACE_HINT } from "./page.mjs";

/**
 * Empreinte de ce que la page montre a l'operateur.
 *
 * Elle porte le perimetre fonctionnel, les choix soumis et le tour — ce sur
 * quoi l'operateur se prononce — et rien d'autre : un champ de forme qui
 * bougerait sans changer la lecture ne doit pas invalider une relecture
 * deja faite.
 *
 * Le calcul est le meme ici et dans `validate-handoff`. C'est ce qui permet
 * a la porte de confronter la page a la proposition sans que l'une ait a
 * connaitre l'autre, et sans qu'un document contienne sa propre empreinte.
 *
 * @param handoff - proposition rendue
 * @returns l'empreinte hexadecimale du contenu soumis a relecture
 */
export function reviewDigest(handoff) {
  return sha256(
    JSON.stringify({
      round: handoff.round ?? null,
      functional_scope: handoff.functional_scope ?? null,
      decisions_for_operator: handoff.decisions_for_operator ?? null,
      scope_final: handoff.scope_final === true,
    }),
  );
}

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
  return `<section><div class="sec-head"><h2>What the product does</h2>
<p>${features.length} features. Every numbered rule is a binding commitment, not an intention.</p></div>
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
  return `<section><div class="sec-head"><h2>What the product does not do</h2>
<p>${entries.length} named exclusions. What is not written here is assumed built &mdash; which is why these are explicit.</p></div>
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
<p class="lbl">Recommendation</p><p class="reco">${esc(d.product_recommendation)}</p>
<p class="lbl">Autres options</p>
<ul class="alts">${(d.alternatives ?? []).map((a) => `<li><span>${esc(a)}</span></li>`).join("")}</ul>
</div>`,
    )
    .join("");
  return `<section><div class="sec-head"><h2>What awaits your decision</h2>
<p>${decisions.length} choices submitted. Nothing is decomposed before your answer.</p></div>
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
  return `<section><div class="sec-head"><h2>Envisaged decomposition</h2>
<p>${list.length} issues. No issue content is written before the agreement.</p></div>
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
  if (!source || !target) fail("usage: render-proposal.mjs <proposal.json> <output.html>");

  let handoff;
  try {
    handoff = JSON.parse(readFileSync(source, "utf8"));
  } catch (error) {
    fail(`proposal unreadable: ${error.message}`);
  }
  if (handoff.mode !== "spec_proposal") {
    fail(`mode ${handoff.mode} : only a spec_proposal renders as a review page`);
  }

  const scope = handoff.functional_scope ?? {};
  const open = handoff.decisions_for_operator ?? [];
  const features = scope.features ?? [];
  const rules = features.reduce((total, f) => total + (f.rules?.length ?? 0), 0);
  const pledges =
    (handoff.design_commitments_carried_into_issues ?? []).length + (handoff.pr_commitments ?? []).length;
  const specId = handoff.scope?.spec_id ?? "spec";
  const status = handoff.scope_final === true ? "scope settled" : `${open.length} open question(s)`;
  const title = handoff.title ?? `Scope ${specId}`;

  const counts = [
    ["Features", features.length],
    ["Rules", rules],
    ["Exclusions", (scope.out_of_scope ?? []).length],
    ["Commitments", pledges],
    ["Issues planned", (handoff.decomposition_titles?.titles ?? []).length],
    ["Open questions", open.length],
  ]
    .filter(([, value]) => value > 0 || value === 0)
    .map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${value}</dd></div>`)
    .join("");

  const digest = handoff.handoff_file?.digest_sha256;
  const feedback = handoff.operator_feedback?.summary;

  const body = `<header class="masthead">
<p class="eyebrow">Spec ${esc(specId)} &middot; phase 1 &middot; round ${esc(handoff.round ?? "?")} &middot; ${esc(status)}</p>
<h1>${esc(title)}</h1>
${scope.intent ? `<p class="lede">${esc(scope.intent)}</p>` : ""}
<dl class="stamp">${counts}${
    digest
      ? `<div style="flex-basis:100%"><dt>Document digest</dt><dd class="digest">${esc(digest)}</dd></div>`
      : ""
  }</dl>
<p class="verbatim">Text taken <strong>verbatim</strong> from the proposal, with no rewording: an obliging re-read would open a gap between what you read and what the digest freezes.</p>
${feedback ? `<p class="note"><strong>Since the previous round.</strong> ${esc(feedback)}</p>` : ""}
</header>
${renderDecisions(open)}
${renderFeatures(features)}
${renderExclusions(scope.out_of_scope)}
${renderPledges(handoff.design_commitments_carried_into_issues, "Design commitments", "Constraints carried into the issues and enforceable in review. These are not suggestions.")}
${renderPledges(handoff.pr_commitments, "What the PR will say", "Transparency commitments. The exposed surfaces are named, not softened.")}
${renderTitles(handoff.decomposition_titles)}
<section><div class="sec-head"><h2>What approving commits you to</h2></div>
<p class="note">Approving this document freezes its content. ${
    digest ? `Digest <code>${esc(digest.slice(0, 8))}&hellip;</code> binds phase 2: ` : "Phase 2 is bound to this document: "
  }any decomposition derived from another document, or from this one modified afterwards, is refused by <code>validate-handoff</code> with a non-zero exit code. <strong>What this document does not say will not be built; what it says wrongly will be built wrongly.</strong></p></section>
`;

  const page =
    `<meta name="proposal-review-digest" content="${reviewDigest(handoff)}">\n` +
    shell(`Scope ${specId}`, body);
  writeFileSync(target, page);
  console.log(
    `written: ${target} (round ${handoff.round}, ${features.length} features, ${rules} rules, ${open.length} open question(s))`,
  );
  console.log(SURFACE_HINT);
}

if (process.argv[1]?.endsWith("render-proposal.mjs")) main();
