import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, readJsonl, fail } from "./lib.mjs";
import { esc, pad, shell, SURFACE_HINT, resolvePage, pageText } from "./page.mjs";
import { split } from "./timings.mjs";

/**
 * Renders what a finished spec actually did.
 *
 * The operator answers the questions, the pipeline runs, and until now
 * nothing came back at the end but a pull request. What was proved, what was
 * found along the way and where it went, what it cost — all of it sat in the
 * store, readable by nobody who had not learnt the store.
 *
 * This page is **computed**, not written. Every line comes from a record: the
 * criteria ledger QA observed, the findings each issue declared with the
 * destination it named, the transitions with their stamps. An agent cannot
 * flatter it, because an agent does not write it.
 *
 * It refuses a spec that is not finished. A report on work still running is a
 * report that will be wrong by the time it is read.
 *
 * Usage: node render-spec.mjs <output.html> <spec-id>
 */
function main() {
  const [target, specId] = process.argv.slice(2);
  if (!target || !specId) fail("usage: render-spec.mjs <output.html> <spec-id>");

  const config = loadConfig();
  const t = pageText(config).pages.spec;

  const spec = readJsonl(join(config.store_dir, "specs.jsonl"))
    .map((entry) => entry.record)
    .find((record) => record.id === specId);
  if (spec == null) fail(`spec not found: ${specId}`);

  const phase = spec.spec_state?.phase;
  if (!["ready_for_pr", "pr_open", "merged"].includes(phase)) {
    fail(
      `${specId} is in ${phase}: this report is for a finished spec. A report on work still running is a ` +
        "report that will be wrong by the time it is read.",
    );
  }

  const issues = readJsonl(join(config.store_dir, "issues.jsonl"))
    .map((entry) => entry.record)
    .filter((record) => record.spec_id === specId);

  const closed = issues.filter((record) => record.pipeline_state?.phase === "closed");
  const criteria = closed.reduce((total, record) => total + (record.acceptance_criteria ?? []).length, 0);
  const rejections = closed.reduce((total, record) => total + (record.pipeline_state?.qa_code_rejections ?? 0), 0);
  const measured = split(issues);

  const found = closed.flatMap((record) =>
    (record.discoveries_declared ?? []).map((item) => ({ ...item, from: record.id })),
  );
  const routes = ["issue", "spec", "pitfall", "framework"];
  const byRoute = routes
    .map((route) => ({ route, items: found.filter((item) => (item.lands ?? "issue") === route) }))
    .filter((group) => group.items.length > 0);

  // What no test reaches, gathered rather than left one handoff at a time.
  // Two issues of one spec closed with the same hole, and nobody could see it
  // was the same one.
  const unproved = closed
    .filter((record) => typeof record.untested_surface === "string" && record.untested_surface.trim().length > 0)
    .map((record) => ({ id: record.id, surface: record.untested_surface }));

  const cards = closed
    .map(
      (record, index) => `<article class="feature">
<header><span class="num">${pad(index)}</span><h3>${esc(record.id)} — ${esc(record.title ?? "")}</h3></header>
<ol class="rules">${(record.criteria_ledger ?? [])
        .map(
          (entry, position) =>
            `<li><span class="rid">${esc(String(entry.index ?? position) + 1)}</span><p>${esc(
              (record.acceptance_criteria ?? [])[entry.index ?? position] ?? "",
            )}<br><em>${esc(entry.evidence ?? "")}</em></p></li>`,
        )
        .join("")}</ol>
</article>`,
    )
    .join("");

  const findings = byRoute
    .map(
      (group) => `<div class="open">
<h3><span class="chip">${esc(t.routes[group.route])}</span>${esc(t.route_count.split("{count}").join(String(group.items.length)))}</h3>
<ul class="alts">${group.items
        .map((item) => `<li><span>${esc(item.title)} <small>(${esc(item.from)})</small></span></li>`)
        .join("")}</ul>
</div>`,
    )
    .join("");

  const counts = [
    [t.count_issues, closed.length],
    [t.count_criteria, criteria],
    [t.count_found, found.length],
    [t.count_rejections, rejections],
  ]
    .map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${value}</dd></div>`)
    .join("");

  const hours = (seconds) => {
    const total = Math.round(seconds / 60);
    return `${Math.floor(total / 60)} h ${String(total % 60).padStart(2, "0")}`;
  };

  const body = `<header class="masthead">
<p class="eyebrow">${esc(t.eyebrow)} &middot; ${esc(specId)} &middot; ${esc(phase)}</p>
<h1>${esc(spec.title ?? specId)}</h1>
<p class="lede">${esc(t.lede)}</p>
<dl class="stamp">${counts}</dl>
<p class="verbatim">${t.verbatim}</p>
</header>

<section><div class="sec-head"><h2>${esc(t.built_head)}</h2>
<p>${esc(t.built_blurb)}</p></div>
<div class="features">${cards}</div></section>

${
  findings.length > 0
    ? `<section><div class="sec-head"><h2>${esc(t.found_head)}</h2>
<p>${esc(t.found_blurb)}</p></div>
<div class="features">${findings}</div></section>`
    : ""
}

${
  unproved.length > 0
    ? `<section><div class="sec-head"><h2>${esc(t.unproved_head)}</h2>
<p>${esc(t.unproved_blurb)}</p></div>
<ol class="excl">${unproved
        .map((entry) => `<li><span class="rid">${esc(entry.id)}</span><p>${esc(entry.surface)}</p></li>`)
        .join("")}</ol></section>`
    : ""
}

<section><div class="sec-head"><h2>${esc(t.cost_head)}</h2>
<p>${esc(t.cost_blurb)}</p></div>
<div class="tablewrap"><table>
<thead><tr><th>${esc(t.cost_what)}</th><th>${esc(t.cost_time)}</th></tr></thead>
<tbody>
<tr><td>${esc(t.cost_agent)}</td><td>${hours(measured.agent)}</td></tr>
<tr><td>${esc(t.cost_validation)}</td><td>${hours(measured.validation)}</td></tr>
<tr><td>${esc(t.cost_waiting)}</td><td>${hours(measured.waiting)}</td></tr>
</tbody></table></div>
${measured.unknown > 0 ? `<p class="note">${esc(t.cost_unknown.split("{count}").join(String(measured.unknown)))}</p>` : ""}</section>`;

  const written = resolvePage(target, config);
  writeFileSync(written, shell(t.doc_title.split("{spec}").join(specId), body));
  console.log(
    `written: ${written} (${closed.length} issue(s), ${criteria} criteria, ${found.length} finding(s), ${rejections} rejection(s))`,
  );
  console.log(SURFACE_HINT);
}

main();
