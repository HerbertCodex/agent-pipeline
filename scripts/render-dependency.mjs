import { readFileSync, writeFileSync } from "node:fs";
import { fail, sha256 } from "./lib.mjs";
import { esc, pad, shell, SURFACE_HINT, resolvePage, safeConfig } from "./page.mjs";

/**
 * Digest of what the page submits to the operator.
 *
 * It carries the need, the cost of writing it yourself, the candidates, the
 * recommendation and what was set aside, which is what the operator rules on.
 * The computation is the same here and in `validate-handoff`, which allows
 * confronting the page with the request without either containing its own
 * digest.
 *
 * @param handoff - the assessment being rendered
 * @returns the hexadecimal digest of the submitted content
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
 * Renders a candidate's card, security included.
 *
 * The order is not neutral: what the library does comes first, then what it
 * costs to host, then who maintains it, and security closes the card because
 * it is the last point read before deciding.
 *
 * @param candidate - the candidate assessed
 * @param index - rank in the list
 * @returns the card's HTML fragment
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
 * Renders a list of rejections with their reasons.
 *
 * @param entries - alternatives set aside
 * @returns the HTML fragment, empty if the list is
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
 * Renders a dependency request as a review page.
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
  const written = resolvePage(target, safeConfig());
  writeFileSync(written, page);
  console.log(
    `written: ${written} (${candidates.length} candidate(s), ${(handoff.alternatives_rejected ?? []).length} rejected)`);
  console.log(SURFACE_HINT);
}

if (process.argv[1]?.endsWith("render-dependency.mjs")) main();
