import { readFileSync, writeFileSync } from "node:fs";
import { fail, sha256 } from "./lib.mjs";
import { esc, pad, shell, SURFACE_HINT, resolvePage, safeConfig, pageText } from "./page.mjs";

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
 * @param t - the page's translated strings
 * @returns the card's HTML fragment
 */
function card(candidate, index, t) {
  const weight = candidate.weight ?? {};
  const upkeep = candidate.maintenance ?? {};
  const safety = candidate.security ?? {};
  const rows = [
    [t.license, candidate.license],
    [t.transitive, weight.transitive_dependencies],
    [t.size, weight.install_size_kb == null ? null : `${weight.install_size_kb} kB`],
    [t.last_release, upkeep.last_release],
    [t.open_issues, upkeep.open_issues],
    [t.maintainers, upkeep.maintainers],
    [t.advisories, safety.advisories_open],
    [t.privileges, (safety.runtime_privileges ?? []).join(", ")],
    [t.audited_on, safety.audited_on],
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
 * @param t - the page's translated strings
 * @returns the HTML fragment, empty if the list is
 */
function rejected(entries, t) {
  if (!entries?.length) return "";
  const items = entries
    .map(
      (entry, index) =>
        `<li><span class="rid">${pad(index)}</span><p><strong>${esc(entry.name ?? "")}</strong> &mdash; ${esc(entry.why ?? "")}</p></li>`,
    )
    .join("");
  return `<section><div class="sec-head"><h2>${esc(t.rejected_head)}</h2>
<p>${esc(t.rejected_blurb)}</p></div>
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

  const config = safeConfig();
  const t = pageText(config).pages.dependency;
  const candidates = handoff.candidates ?? [];
  const choice = handoff.recommendation ?? {};
  const issue = handoff.scope?.issue_id ?? "issue";

  const body = `<header class="masthead">
<p class="eyebrow">${esc(t.eyebrow)} &middot; ${esc(issue)} &middot; ${esc(t.candidate_count.replace("{count}", String(candidates.length)))}</p>
<h1>${esc(choice.choice ?? t.no_reco)}</h1>
<p class="lede">${esc(handoff.need ?? "")}</p>
<dl class="stamp">
<div><dt>${esc(t.hand_rolled)}</dt><dd>${esc(handoff.hand_rolled_cost ?? "")}</dd></div>
${choice.why ? `<div style="flex-basis:100%"><dt>${esc(t.why_this)}</dt><dd>${esc(choice.why)}</dd></div>` : ""}
</dl>
<p class="verbatim">${t.verbatim}</p>
</header>

<section><div class="sec-head"><h2>${esc(t.candidates_head)}</h2>
<p>${esc(t.candidates_blurb)}</p></div>
<div class="features">${candidates.map((candidate, index) => card(candidate, index, t)).join("")}</div></section>

${rejected(handoff.alternatives_rejected, t)}

<section><div class="sec-head"><h2>${esc(t.commits_head)}</h2></div>
<p class="note">${esc(t.commits_note)}</p></section>
`;

  const page = `<meta name="dependency-review-digest" content="${dependencyDigest(handoff)}">\n` + shell(t.doc_title.replace("{issue}", issue), body);
  const written = resolvePage(target, config);
  writeFileSync(written, page);
  console.log(
    `written: ${written} (${candidates.length} candidate(s), ${(handoff.alternatives_rejected ?? []).length} rejected)`);
  console.log(SURFACE_HINT);
}

if (process.argv[1]?.endsWith("render-dependency.mjs")) main();
