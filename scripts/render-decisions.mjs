import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, loadRules, readJsonl, pathAllowed, fail } from "./lib.mjs";
import { esc, pad, shell, SURFACE_HINT, resolvePage, pageText } from "./page.mjs";

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
 * @param t - the page's translated strings
 * @returns the card's HTML fragment
 */
function card(entry, t) {
  const alts = (entry.options ?? []).map((option) => `<li><span>${esc(option)}</span></li>`).join("");
  return `<div class="open${entry.urgent ? " urgent" : ""}">
<h3><span class="qid">${esc(entry.id)}</span>${esc(entry.question)}${
    entry.chip ? `<span class="chip${entry.urgent ? " alarm" : ""}">${esc(entry.chip)}</span>` : ""
  }</h3>
${entry.why ? `<p>${esc(entry.why)}</p>` : ""}
${entry.paths?.length ? `<p class="lbl">${t.scope}</p><p class="paths">${entry.paths.map((p) => esc(p)).join(" · ")}</p>` : ""}
${entry.recommendation ? `<p class="lbl">${t.recommendation}</p><p class="reco">${esc(entry.recommendation)}</p>` : ""}
${alts ? `<p class="lbl">${t.other_options}</p><ul class="alts">${alts}</ul>` : ""}
${
    entry.attempts?.length
      ? `<p class="lbl">${t.already_tried}</p><ul class="alts">${entry.attempts
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
 * @param t - the page's translated strings
 * @returns the section's HTML fragment
 */
function section(heading, blurb, entries, empty, t) {
  const body = entries.length > 0
    ? `<div class="features">${entries.map((entry) => card(entry, t)).join("")}</div>`
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
  const t = pageText(config).pages.decisions;
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
        why: t.blocked_why.replace("{phase}", phase),
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
        chip: t.orphan_chip,
        urgent: true,
        why: t.orphan_why,
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
        question: t.approve.replace("{round}", String(proposal.round)),
        chip: t.chip_settled,
        recommendation:
          t.approve_why,
        options: [t.approve_yes, t.approve_no],
      });
    }
  }

  const counts = [
    [t.counts_pending, pending.length],
    [t.counts_blocked, blocked.length],
    [t.counts_orphan, orphaned.length],
    [t.counts_dispatchable, dispatchable.length],
  ]
    .map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${value}</dd></div>`)
    .join("");

  const total = pending.length + blocked.length + orphaned.length;
  const body = `<header class="masthead">
<p class="eyebrow">${esc(t.eyebrow)} &middot; ${esc(t.store_count.replace("{count}", String(issues.length)))} &middot; ${esc(new Date().toISOString().slice(0, 10))}</p>
<h1>${t.title}</h1>
<p class="lede">${
    total === 0
      ? t.nothing
      : t.waiting.replace("{count}", String(total))
  }</p>
<dl class="stamp">${counts}</dl>
<p class="verbatim">${t.verbatim}</p>
</header>
${section(t.spec_head, t.spec_blurb, pending, t.spec_empty, t)}
${section(t.blocked_head, t.blocked_blurb, blocked, t.blocked_empty, t)}
${section(t.orphan_head, t.orphan_blurb, orphaned, t.orphan_empty, t)}
<section><div class="sec-head"><h2>${t.moves_head}</h2></div>
<p class="note">${t.moves_note.replace("{count}", String(dispatchable.length))} ${
    total > 0 ? t.moves_caveat : ""
  }</p></section>`;

  const written = resolvePage(target, config);
  writeFileSync(written, shell(t.title, body));
  console.log(
    `written: ${written} (${pending.length} spec question(s), ${blocked.length} blocked, ${orphaned.length} with no agent, ${dispatchable.length} dispatchable)`,
  );
  console.log(SURFACE_HINT);
}

main();
