import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, loadRules, readJsonl, pathAllowed, fail } from "./lib.mjs";
import { esc, pad, shell, SURFACE_HINT, resolvePage } from "./page.mjs";

/**
 * Says whether a role can take on all of an issue's reservations.
 *
 * An accepted approximation: the comparison is on the reservation pattern
 * itself, not on the files it will designate, which do not exist yet. It is
 * enough to tell an entirely forbidden scope from an open one, and that is
 * the only question asked here.
 *
 * @param reservations - patterns reserved by the issue
 * @param policy - the role's file policy
 * @returns true if no reserved pattern falls outside the policy
 */
function roleCanTake(reservations, policy) {
  if (reservations.length === 0) return false;
  return reservations.every((reservation) => pathAllowed(reservation, policy));
}

/**
 * Renders one decision card.
 *
 * @param entry - the card's content
 * @returns the card's HTML fragment
 */
function card(entry) {
  const alts = (entry.options ?? []).map((option) => `<li><span>${esc(option)}</span></li>`).join("");
  return `<div class="open${entry.urgent ? " urgent" : ""}">
<h3><span class="qid">${esc(entry.id)}</span>${esc(entry.question)}${
    entry.chip ? `<span class="chip${entry.urgent ? " alarm" : ""}">${esc(entry.chip)}</span>` : ""
  }</h3>
${entry.why ? `<p>${esc(entry.why)}</p>` : ""}
${entry.paths?.length ? `<p class="lbl">Scope</p><p class="paths">${entry.paths.map((p) => esc(p)).join(" · ")}</p>` : ""}
${entry.recommendation ? `<p class="lbl">Recommendation</p><p class="reco">${esc(entry.recommendation)}</p>` : ""}
${alts ? `<p class="lbl">Other options</p><ul class="alts">${alts}</ul>` : ""}
${
    entry.attempts?.length
      ? `<p class="lbl">Already tried</p><ul class="alts">${entry.attempts
          .map((attempt) => `<li><span><strong>${esc(attempt.approach)}</strong> &mdash; ${esc(attempt.failed_because)}</span></li>`)
          .join("")}</ul>`
      : ""
  }
</div>`;
}

/**
 * Renders a section of cards, or one sentence when there is nothing.
 *
 * @param heading - section title
 * @param blurb - framing sentence
 * @param entries - cards to render
 * @param empty - sentence shown when the list is empty
 * @returns the section's HTML fragment
 */
function section(heading, blurb, entries, empty) {
  const body = entries.length > 0
    ? `<div class="features">${entries.map(card).join("")}</div>`
    : `<p class="empty">${esc(empty)}</p>`;
  return `<section><div class="sec-head"><h2>${esc(heading)}</h2><p>${esc(blurb)}</p></div>${body}</section>`;
}

/**
 * Renders the queue of arbitrations waiting on the operator.
 *
 * What the operator must decide is derived from the store and the file
 * policy: an issue whose scope no role can take is operator work, whether it
 * says so or not. `next-issues` presents it as dispatchable all the same,
 * because it computes reservation disjointness without reading `file_policy`.
 * This page fills that gap instead of asking everyone to remember it.
 *
 * Usage: node render-decisions.mjs <output.html> [proposal.json]
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
        attempts: issue.attempts ?? [],
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

  const written = resolvePage(target, config);
  writeFileSync(written, shell("File d'arbitrage", body));
  console.log(
    `written: ${written} (${pending.length} spec question(s), ${blocked.length} blocked, ${orphaned.length} with no agent, ${dispatchable.length} dispatchable)`,
  );
  console.log(SURFACE_HINT);
}

main();
