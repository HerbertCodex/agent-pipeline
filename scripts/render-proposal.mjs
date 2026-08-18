import { readFileSync, writeFileSync } from "node:fs";
import { fail, sha256 } from "./lib.mjs";
import { esc, pad, shell, SURFACE_HINT } from "./page.mjs";

/**
 * Digest of what the page shows the operator.
 *
 * It carries the functional scope, the submitted choices and the round, which
 * is what the operator rules on, and nothing else: a formatting field moving
 * without changing the reading must not invalidate a review already done.
 *
 * The computation is the same here and in `validate-handoff`. That is what
 * lets the gate confront the page with the proposal without either having to
 * know the other, and without any document containing its own digest.
 *
 * @param handoff - the proposal being rendered
 * @returns the hexadecimal digest of the content submitted for review
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
 * Renders a features section with their numbered rules.
 *
 * @param features - the scope's list of features
 * @returns the section's HTML fragment, empty if the list is
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
 * Renders the list of declared exclusions.
 *
 * @param entries - content of functional_scope.out_of_scope
 * @returns the HTML fragment, empty if no exclusion is declared
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
 * Renders a list of numbered commitments.
 *
 * @param entries - list of commitment texts
 * @param heading - section title
 * @param blurb - framing sentence under the title
 * @returns the HTML fragment, empty if the list is
 */
function renderPledges(entries, heading, blurb) {
  if (!entries?.length) return "";
  return `<section><div class="sec-head"><h2>${esc(heading)}</h2><p>${esc(blurb)}</p></div>
<ol class="pledges">${entries
    .map((e, i) => `<li><span class="rid">${pad(i)}</span><p>${esc(e)}</p></li>`)
    .join("")}</ol></section>`;
}

/**
 * Renders the choices still awaiting the operator's decision.
 *
 * This section comes before the scope: an open round is read first by what it
 * asks, not by what it proposes.
 *
 * @param decisions - content of decisions_for_operator
 * @returns the HTML fragment, empty once nothing is open
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
 * Renders the titles of the envisaged decomposition.
 *
 * @param titles - content of decomposition_titles
 * @returns the HTML fragment, empty if no title is proposed
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
 * Renders a spec proposal as a self-contained HTML page, ready to publish.
 *
 * The rendering is deterministic, with no formatting decision at publish
 * time: two successive rounds compare by eye because only their substance
 * changes. The text is taken as it is, never reworded, since an obliging
 * re-read would open a gap between what the operator reads and what the
 * `approved_proposal` digest freezes.
 *
 * Usage: node render-proposal.mjs <proposal.json> <output.html>
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
