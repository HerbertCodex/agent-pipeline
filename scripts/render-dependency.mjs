import { readFileSync, writeFileSync } from "node:fs";
import { fail, sha256 } from "./lib.mjs";
import { esc, pad, shell, SURFACE_HINT } from "./page.mjs";

/**
 * Empreinte de ce que la page soumet a l'operateur.
 *
 * Elle porte le besoin, le cout de l'ecrire soi-meme, les candidats, la
 * recommandation et ce qui a ete ecarte — ce sur quoi l'operateur se
 * prononce. Le calcul est le meme ici et dans `validate-handoff`, ce qui
 * permet de confronter la page a la demande sans qu'aucune des deux ne
 * contienne sa propre empreinte.
 *
 * @param handoff - evaluation rendue
 * @returns l'empreinte hexadecimale du contenu soumis
 */
export function dependencyDigest(handoff) {
  return sha256(
    JSON.stringify({
      need: handoff.need ?? null,
      hand_rolled_cost: handoff.hand_rolled_cost ?? null,
      candidates: handoff.candidates ?? null,
      recommendation: handoff.recommendation ?? null,
      alternatives_rejected: handoff.alternatives_rejected ?? null,
    }),
  );
}

/**
 * Rend la fiche d'un candidat, securite comprise.
 *
 * L'ordre n'est pas neutre : ce que la bibliotheque fait vient en premier,
 * puis ce qu'elle coute a heberger, puis qui la maintient, et la securite
 * ferme la fiche parce que c'est le dernier point lu avant de trancher.
 *
 * @param candidate - candidat evalue
 * @param index - rang dans la liste
 * @returns le fragment HTML de la fiche
 */
function card(candidate, index) {
  const weight = candidate.weight ?? {};
  const upkeep = candidate.maintenance ?? {};
  const safety = candidate.security ?? {};
  const rows = [
    ["License", candidate.license],
    ["Transitive dependencies", weight.transitive_dependencies],
    ["Install size", weight.install_size_kb == null ? null : `${weight.install_size_kb} kB`],
    ["Last release", upkeep.last_release],
    ["Open issues", upkeep.open_issues],
    ["Maintainers", upkeep.maintainers],
    ["Open advisories", safety.advisories_open],
    ["Runtime privileges", (safety.runtime_privileges ?? []).join(", ")],
    ["Audited on", safety.audited_on],
  ]
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([label, value]) => `<li><span class="rid">${esc(label)}</span><p>${esc(String(value))}</p></li>`)
    .join("");

  return `<article class="feature">
<header><span class="num">${pad(index)}</span><h3>${esc(candidate.name)} <small>${esc(candidate.version ?? "")}</small></h3></header>
<p class="plain">${esc(candidate.does ?? "")}</p>
<ol class="rules">${rows}</ol>
</article>`;
}

/**
 * Rend une liste de rejets motives.
 *
 * @param entries - alternatives ecartees
 * @returns le fragment HTML, vide si la liste l'est
 */
function rejected(entries) {
  if (!entries?.length) return "";
  const items = entries
    .map(
      (entry, index) =>
        `<li><span class="rid">${pad(index)}</span><p><strong>${esc(entry.name ?? "")}</strong> &mdash; ${esc(entry.why ?? "")}</p></li>`,
    )
    .join("");
  return `<section><div class="sec-head"><h2>What was rejected, and why</h2>
<p>A decision taken in silence is exactly what this page exists to prevent. These were considered and set aside.</p></div>
<ol class="excl">${items}</ol></section>`;
}

/**
 * Rend une demande de dependance en page de relecture.
 */
function main() {
  const [source, target] = process.argv.slice(2);
  if (!source || !target) fail("usage: render-dependency.mjs <assessment.json> <output.html>");

  let handoff;
  try {
    handoff = JSON.parse(readFileSync(source, "utf8"));
  } catch (error) {
    fail(`assessment unreadable: ${error.message}`);
  }
  if (handoff.mode !== "dependency_assessment") {
    fail(`mode ${handoff.mode}: only a dependency_assessment renders as a review page`);
  }

  const candidates = handoff.candidates ?? [];
  const choice = handoff.recommendation ?? {};
  const issue = handoff.scope?.issue_id ?? "issue";

  const body = `<header class="masthead">
<p class="eyebrow">Dependency decision &middot; ${esc(issue)} &middot; ${candidates.length} candidate(s)</p>
<h1>${esc(choice.choice ?? "No recommendation")}</h1>
<p class="lede">${esc(handoff.need ?? "")}</p>
<dl class="stamp">
<div><dt>Writing it here would cost</dt><dd>${esc(handoff.hand_rolled_cost ?? "")}</dd></div>
${choice.why ? `<div style="flex-basis:100%"><dt>Why this one</dt><dd>${esc(choice.why)}</dd></div>` : ""}
</dl>
<p class="verbatim"><strong>Installing is yours, not the pipeline's.</strong> No agent adds a dependency: it argues for one and stops. This page is that argument, taken verbatim from the request, with every field the agent measured rather than assumed.</p>
</header>

<section><div class="sec-head"><h2>The candidates, weighed</h2>
<p>License, weight, upkeep and security surface. A library that does the job and is unmaintained does not do the job.</p></div>
<div class="features">${candidates.map((candidate, index) => card(candidate, index)).join("")}</div></section>

${rejected(handoff.alternatives_rejected)}

<section><div class="sec-head"><h2>What approving commits you to</h2></div>
<p class="note">A dependency on a public input surface becomes part of your security perimeter: its advisories become yours, its maintainers become your maintainers, and removing it later costs more than adding it now. Refusing is a valid answer, and the cost of writing it by hand is stated above so that refusing is an informed choice rather than a reflex.</p></section>
`;

  const page = `<meta name="dependency-review-digest" content="${dependencyDigest(handoff)}">\n` + shell(`Dependency ${issue}`, body);
  writeFileSync(target, page);
  console.log(`written: ${target} (${candidates.length} candidate(s), ${(handoff.alternatives_rejected ?? []).length} rejected)`);
  console.log(SURFACE_HINT);
}

if (process.argv[1]?.endsWith("render-dependency.mjs")) main();
