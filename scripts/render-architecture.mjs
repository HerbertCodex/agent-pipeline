import { writeFileSync } from "node:fs";
import { fail } from "./lib.mjs";
import { esc, pad, shell, SURFACE_HINT, resolvePage, safeConfig, pageText } from "./page.mjs";
import { PROJECT_TYPES, ARCHITECTURES, FULLSTACK_BOUNDARY, catalogue } from "./architectures.mjs";
import { readFileSync, existsSync } from "node:fs";
import { briefQuestions, judge, summarise, unanswered } from "./discovery.mjs";

/**
 * Renders the dependency direction as a chain of arrowed boxes.
 *
 * An arrow reads in a second where a sentence needs a paragraph: it is the
 * one piece of structural information that must land before anything else is
 * read.
 *
 * @param chain - layers, from the outermost to the innermost
 * @param t - the page's translated strings
 * @returns the chain's HTML fragment
 */
function arrows(chain, t) {
  const boxes = chain
    .map((layer, index) => {
      const last = index === chain.length - 1;
      return `<span class="box${last ? " core" : ""}">${esc(layer)}</span>${last ? "" : '<span class="arrow">→</span>'}`;
    })
    .join("");
  return `<div class="chain">${boxes}</div>
<p class="chain-legend">${t.reads_as
    .split("{outer}").join(esc(chain[0]))
    .split("{inner}").join(esc(chain[1] ?? chain[0]))
    .split("{more}").join(chain.length > 2 ? t.and_so_on : "")}</p>`;
}

/**
 * Renders an architecture as a card readable at a glance.
 *
 * The order is deliberate: plain language, then the file tree, then the real
 * cost in files, and only then the nuances. Whoever stops after the first
 * three blocks already has enough to choose.
 *
 * @param entry - catalogue architecture
 * @param index - display rank
 * @param example - concrete action used as the unit of cost
 * @param t - the page's translated strings
 * @returns the card's HTML fragment
 */
function card(entry, index, example, t) {
  return `<article class="feature">
<header><span class="num">${pad(index)}</span><h3>${esc(entry.name)}</h3></header>
<p class="plain">${esc(entry.plain)}</p>

<div class="split">
<div>
<p class="lbl">${esc(t.looks_like)}</p>
<pre class="tree">${entry.tree.map((line) => esc(line)).join("\n")}</pre>
</div>
<div>
<p class="lbl">${esc(t.direction)}</p>
${arrows(entry.chain, t)}
</div>
</div>

<p class="lbl">${t.files_for.split("{example}").join(esc(example)).split("{count}").join(String(entry.files_for_example.length))}</p>
<ul class="files">${entry.files_for_example.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>

<ol class="rules">
<li><span class="rid">${esc(t.lbl_cost)}</span><p>${esc(entry.cost)}</p></li>
<li><span class="rid">${esc(t.lbl_buys)}</span><p>${esc(entry.buys)}</p></li>
<li><span class="rid">${esc(t.lbl_trap)}</span><p>${esc(entry.wrong_when)}</p></li>
</ol>
<p class="lbl">${esc(t.grows)}</p>
<p class="grow">${esc(entry.grows_into)}</p>
<ul class="alts">${entry.migration_triggers.map((t) => `<li><span>${esc(t)}</span></li>`).join("")}</ul>
<p class="cost-move"><strong>${t.migration_cost}</strong> ${esc(entry.migration_cost)}</p>

<p class="note"><strong>${esc(t.verdict_label)}</strong> ${esc(entry.verdict)}</p>
</article>`;
}

/**
 * Renders the comparison table placed before the detailed cards.
 *
 * It exists so a choice can be made without reading everything: the detail
 * comes after, for whoever hesitates between two rows.
 *
 * @param retained - architectures retained for this project type
 * @param example - concrete action used as the unit of cost
 * @param t - the page's translated strings
 * @returns the table's HTML fragment
 */
function table(retained, example, t) {
  const rows = retained
    .map(
      (entry) => `<tr><td><strong>${esc(entry.name)}</strong></td>
<td>${entry.files_for_example.length}</td>
<td>${esc(entry.verdict.split(".")[0])}.</td></tr>`,
    )
    .join("");
  return `<div class="tablewrap"><table>
<thead><tr><th>${esc(t.col_option)}</th><th>${t.col_files.split("{example}").join(esc(example))}</th><th>${esc(t.col_when)}</th></tr></thead>
<tbody>${rows}</tbody></table></div>`;
}

/**
 * Renders the brief: the questions asked when no analysis is supplied.
 *
 * @param t - the page's translated strings
 * @param text - the whole language dictionary
 * @returns the section's HTML fragment
 */
function questionnaire(t, text) {
  const items = briefQuestions(text).map(
    (item) => `<div class="open">
<h3><span class="qid">${esc(item.id)}</span>${esc(item.question)}</h3>
<p class="short">${esc(item.hint)}</p>
<p class="reveals">${esc(t.brief_reveals)} — ${esc(item.reveals)}</p>
</div>`,
  ).join("");
  return `<section><div class="sec-head"><h2>${esc(t.brief_head)}</h2>
<p>${t.brief_blurb}</p></div>
<div class="features">${items}</div>
<p class="note">${t.brief_note}</p></section>`;
}

/**
 * Renders the recommendation grounded in the project analysis.
 *
 * @param retained - architectures relevant to the project type
 * @param analysis - analysis drawn from the rough brief
 * @param t - the page's translated strings
 * @param text - the whole language dictionary
 * @returns the recommendation's HTML fragment
 */
function recommendation(retained, analysis, t, text) {
  const judged = retained
    .map((entry) => ({ entry, ...judge(entry, analysis, text) }))
    .sort((a, b) => a.rank - b.rank);
  const rows = judged
    .map(
      (item) => `<div class="open${item.verdict === "recommande" ? "" : " muted"}">
<h3><span class="chip${item.verdict === "recommande" ? "" : " alarm"}">${esc(item.label)}</span>${esc(item.entry.name)}</h3>
<ul class="alts">${item.reasons.map((reason) => `<li><span>${esc(reason)}</span></li>`).join("")}</ul>
</div>`,
    )
    .join("");
  const rules = analysis.business_rules ?? [];
  const validations = analysis.validations ?? [];
  // What the description did not cover, and only that. Asking the eight
  // questions again to someone who has just described their product is how a
  // conversation turns into a form.
  const open = new Set(unanswered(analysis));
  const remaining = briefQuestions(text)
    .filter((item) => open.has(item.id))
    .map(
      (item) => `<div class="open">
<h3><span class="qid">${esc(item.id)}</span>${esc(item.question)}</h3>
<p class="short">${esc(item.hint)}</p>
<p class="reveals">${esc(t.brief_reveals)} — ${esc(item.reveals)}</p>
</div>`,
    )
    .join("");
  return `<section><div class="sec-head"><h2>${esc(t.says_head)}</h2>
<p>${esc(summarise(analysis, text))}</p></div>
${rules.length > 0 ? `<p class="lbl">${esc(t.rules_found)}</p><ol class="rules">${rules.map((r, i) => `<li><span class="rid">R${i + 1}</span><p>${esc(r.rule)}${r.why_it_matters ? ` — <em>${esc(r.why_it_matters)}</em>` : ""}</p></li>`).join("")}</ol>` : `<p class="empty">${esc(t.no_rule_found)}</p>`}
${validations.length > 0 ? `<p class="lbl">${esc(t.validations_label)}</p><ul class="files">${validations.map((v) => `<li>${esc(v)}</li>`).join("")}</ul>` : ""}
${remaining.length > 0
    ? `<div class="sec-head" style="margin-top:1rem"><h2>${esc(t.remaining_head)}</h2>
<p>${esc(t.remaining_blurb)}</p></div>
<div class="features">${remaining}</div>`
    : `<p class="note">${esc(t.remaining_none)}</p>`}
<div class="sec-head" style="margin-top:1rem"><h2>${esc(t.advice_head)}</h2>
<p>${esc(t.advice_blurb)}</p></div>
<div class="features">${rows}</div></section>`;
}

/**
 * Lists the project types with what each one is.
 *
 * The type is a decision, and it was answered with four bare words. It
 * silently removes architectures from the catalogue — `frontend` and
 * `fullstack` are one word apart and do not offer the same options — and the
 * distinction was got wrong on a real bootstrap, where a project declared
 * itself a web interface while owning the database it expected to replace.
 *
 * The descriptions existed all along. They were shown only AFTER the choice,
 * as the page's opening line, which is the wrong order for a decision aid.
 *
 * @param spoken - the catalogue in the operator's language
 * @param t - the page's translated strings
 * @returns the four types, one per line, with what each one is
 */
function typeHelp(spoken, t) {
  const width = Math.max(...PROJECT_TYPES.map((id) => id.length));
  const lines = PROJECT_TYPES.map((id) => {
    const project = spoken.projectTypes[id];
    return `  ${id.padEnd(width)}  ${project.label} — ${project.blurb}`;
  });
  return `\n${t.type_help}\n${lines.join("\n")}\n\n${t.type_decides}`;
}

/**
 * Renders the page that explains the architectures and asks for a choice.
 *
 * The framework imposes no architecture: it makes the choice explainable,
 * then enforceable. The project type filters the catalogue because it changes
 * the answer, and an unfiltered catalogue turns a decision into a literature
 * review.
 *
 * The entry is a DESCRIPTION, not a form. The operator says what the product
 * is, in their own words; an analysis is drawn from that; and the page asks
 * only what the description left open. Handing eight questions to someone
 * before they have said anything turns a conversation into paperwork, and
 * their answers into the shape of the questions.
 *
 * Without an analysis the eight questions are asked in full — that is the
 * degraded mode, not the intended one.
 *
 * Usage: node render-architecture.mjs <output.html> <backend|frontend|mobile|fullstack>
 */
function main() {
  const [target, type, analysisPath] = process.argv.slice(2);
  // The prose comes from the declared language's dictionary; the structure
  // stays the catalogue's. The two meet here and nowhere else.
  const config = safeConfig();
  const text = pageText(config);
  const t = text.pages.architecture;
  const spoken = catalogue(config);

  if (!target || !type) {
    fail(
      `usage : render-architecture.mjs <sortie.html> <${PROJECT_TYPES.join("|")}> [analyse.json]\n` +
        typeHelp(spoken, t),
    );
  }
  const project = spoken.projectTypes[type];
  if (project == null) {
    fail(`${t.type_unknown.split("{type}").join(type)}\n${typeHelp(spoken, t)}`);
  }

  const retained = spoken.architectures.filter((entry) => entry.applies.includes(type));
  const removed = spoken.architectures.filter((entry) => !entry.applies.includes(type));
  const example = project.example;

  let analysis = null;
  if (analysisPath != null) {
    if (!existsSync(analysisPath)) fail(`analysis not found: ${analysisPath}`);
    analysis = JSON.parse(readFileSync(analysisPath, "utf8"));
    if (!Array.isArray(analysis.business_rules)) {
      fail("the analysis must carry business_rules, even empty: saying there are none is a conclusion, not an omission");
    }
  }

  const axis = spoken.decisionAxis.map(
    (item, index) => `<div class="open">
<h3><span class="qid">Q${index + 1}</span>${esc(item.question)}</h3>
<p class="short">${esc(item.short)}</p>
<p>${esc(item.why)}</p>
<ul class="alts">${item.answers
      .map(([answer, effect]) => `<li><span><strong>${esc(answer)}</strong> — ${esc(effect)}</span></li>`)
      .join("")}</ul>
</div>`,
  ).join("");

  // A contradiction between the two declarations the operator made: the
  // analysis RECOMMENDS an option, and the project type removed it without a
  // word. Observed on a real bootstrap — a project declared `frontend` while
  // its analysis carried a database it expected to replace, so hexagonal, the
  // option that exists for exactly that, disappeared silently.
  //
  // Only `recommande` is surfaced. `possible` is not a contradiction, and
  // listing it would offer MVVM to a back-end service — the catalogue review
  // this page exists to replace.
  const filtered =
    analysis == null
      ? ""
      : (() => {
          const worth = removed
            .map((entry) => ({ entry, ...judge(entry, analysis, text) }))
            .filter((item) => item.verdict === "recommande")
            .sort((a, b) => a.rank - b.rank);
          if (worth.length === 0) return "";
          const cards = worth
            .map(
              (item) => `<div class="open muted">
<h3><span class="chip">${esc(item.label)}</span>${esc(item.entry.name)}</h3>
<ul class="alts">${item.reasons.map((reason) => `<li><span>${esc(reason)}</span></li>`).join("")}</ul>
</div>`,
            )
            .join("");
          return `<section><div class="sec-head"><h2>${esc(t.removed_head)}</h2>
<p>${esc(t.removed_blurb.split("{type}").join(type))}</p></div>
<div class="features">${cards}</div>
<p class="note">${esc(t.removed_note)}</p></section>`;
        })();

  const boundary =
    type !== "fullstack"
      ? ""
      : `<section><div class="sec-head"><h2>${esc(t.boundary_head)}</h2>
<p>${esc(t.boundary_blurb)}</p></div>
<ol class="pledges">${FULLSTACK_BOUNDARY.map((id) => text.fullstack_boundary[id]).map(
          (item, index) => `<li><span class="rid">${pad(index)}</span><p><strong>${esc(item.option)}</strong><br>
<em>${esc(t.boundary_cost)}</em> — ${esc(item.cost)}<br><em>${esc(t.boundary_buys)}</em> — ${esc(item.buys)}<br><em>${esc(t.boundary_trap)}</em> — ${esc(item.wrong_when)}</p></li>`,
        ).join("")}</ol></section>`;

  const body = `<header class="masthead">
<p class="eyebrow">${t.eyebrow} &middot; ${esc(project.label)}</p>
<h1>${esc(t.title)}</h1>
<p class="lede">${esc(project.blurb)}</p>
<p class="verbatim">${t.verbatim}</p>
</header>

${analysis == null ? questionnaire(t, text) : recommendation(retained, analysis, t, text)}

<section><div class="sec-head"><h2>${esc(t.glance_head)}</h2>
<p>${esc(t.glance_blurb.split("{count}").join(String(retained.length)))}</p></div>
${table(retained, example, t)}</section>

<section><div class="sec-head"><h2>${esc(t.axis_head)}</h2>
<p>${esc(t.axis_blurb)}</p></div>
<div class="features">${axis}</div></section>

<section><div class="sec-head"><h2>${esc(t.detail_head)}</h2>
<p>${esc(t.detail_blurb.split("{kept}").join(String(retained.length)).split("{total}").join(String(ARCHITECTURES.length)))}</p></div>
<div class="features">${retained.map((entry, index) => card(entry, index, example, t)).join("")}</div></section>

${filtered}

${boundary}

<section><div class="sec-head"><h2>${t.wrong_head}</h2>
<p>${esc(t.wrong_blurb)}</p></div>
<p class="note">${t.wrong_note}</p></section>

<section><div class="sec-head"><h2>${esc(t.next_head)}</h2></div>
<p class="note">${t.next_note}</p></section>`;

  const written = resolvePage(target, config);
  writeFileSync(written, shell(t.doc_title.split("{label}").join(project.label), body));
  console.log(
    `written: ${written} (${type}, ${retained.length} options out of ${ARCHITECTURES.length}, ${analysis == null ? "questionnaire" : "advice grounded in the analysis"})`);
  console.log(SURFACE_HINT);
}

main();
