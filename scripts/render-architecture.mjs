import { writeFileSync } from "node:fs";
import { fail } from "./lib.mjs";
import { esc, pad, shell, SURFACE_HINT } from "./page.mjs";
import { PROJECT_TYPES, DECISION_AXIS, ARCHITECTURES, FULLSTACK_BOUNDARY } from "./architectures.mjs";
import { readFileSync, existsSync } from "node:fs";
import { BRIEF_QUESTIONS, judge, summarise } from "./discovery.mjs";

/**
 * Renders the dependency direction as a chain of arrowed boxes.
 *
 * An arrow reads in a second where a sentence needs a paragraph: it is the
 * one piece of structural information that must land before anything else is
 * read.
 *
 * @param chain - layers, from the outermost to the innermost
 * @returns the chain's HTML fragment
 */
function arrows(chain) {
  const boxes = chain
    .map((layer, index) => {
      const last = index === chain.length - 1;
      return `<span class="box${last ? " core" : ""}">${esc(layer)}</span>${last ? "" : '<span class="arrow">→</span>'}`;
    })
    .join("");
  return `<div class="chain">${boxes}</div>
<p class="chain-legend">reads as: « ${esc(chain[0])} may use ${esc(chain[1] ?? chain[0])}${
    chain.length > 2 ? " and so on" : ""
  }, never the reverse &raquo;</p>`;
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
 * @returns the card's HTML fragment
 */
function card(entry, index, example) {
  return `<article class="feature">
<header><span class="num">${pad(index)}</span><h3>${esc(entry.name)}</h3></header>
<p class="plain">${esc(entry.plain)}</p>

<div class="split">
<div>
<p class="lbl">À quoi ça ressemble</p>
<pre class="tree">${entry.tree.map((line) => esc(line)).join("\n")}</pre>
</div>
<div>
<p class="lbl">Dependency direction</p>
${arrows(entry.chain)}
</div>
</div>

<p class="lbl">For ${esc(example)}: ${entry.files_for_example.length} files</p>
<ul class="files">${entry.files_for_example.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>

<ol class="rules">
<li><span class="rid">Cost</span><p>${esc(entry.cost)}</p></li>
<li><span class="rid">Buys</span><p>${esc(entry.buys)}</p></li>
<li><span class="rid">Trap</span><p>${esc(entry.wrong_when)}</p></li>
</ol>
<p class="lbl">As the project grows</p>
<p class="grow">${esc(entry.grows_into)}</p>
<ul class="alts">${entry.migration_triggers.map((t) => `<li><span>${esc(t)}</span></li>`).join("")}</ul>
<p class="cost-move"><strong>Migration cost &mdash;</strong> ${esc(entry.migration_cost)}</p>

<p class="note"><strong>En résumé.</strong> ${esc(entry.verdict)}</p>
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
 * @returns the table's HTML fragment
 */
function table(retained, example) {
  const rows = retained
    .map(
      (entry) => `<tr><td><strong>${esc(entry.name)}</strong></td>
<td>${entry.files_for_example.length}</td>
<td>${esc(entry.verdict.split(".")[0])}.</td></tr>`,
    )
    .join("");
  return `<div class="tablewrap"><table>
<thead><tr><th>Option</th><th>Files for ${esc(example)}</th><th>When it is the right call</th></tr></thead>
<tbody>${rows}</tbody></table></div>`;
}

/**
 * Renders the page that explains the architectures and asks for a choice.
 *
 * The framework imposes no architecture: it makes the choice explainable,
 * then enforceable. The project type filters the catalogue because it changes
 * the answer, and an unfiltered catalogue turns a decision into a literature
 * review.
 *
 * Usage: node render-architecture.mjs <output.html> <backend|frontend|mobile|fullstack>
 */
function questionnaire() {
  const items = BRIEF_QUESTIONS.map(
    (item) => `<div class="open">
<h3><span class="qid">${esc(item.id)}</span>${esc(item.question)}</h3>
<p class="short">${esc(item.hint)}</p>
<p class="reveals">Ce que la reponse revele — ${esc(item.reveals)}</p>
</div>`,
  ).join("");
  return `<section><div class="sec-head"><h2>First: what is this project about?</h2>
<p>Eight questions, in plain language. Answer them before looking at any architecture  &mdash; that is what turns a generic recommendation into reasoned advice.</p></div>
<div class="features">${items}</div>
<p class="note"><strong>The question that really decides is B3.</strong> A system that never refuses anything for a reason coming from the real world has no domain: it has a schema. And B4 checks that the refusals quoted really are refusals &mdash; &laquo; this field is required &raquo; is not one.</p></section>`;
}

/**
 * Renders the recommendation grounded in the project analysis.
 *
 * @param retained - architectures relevant to the project type
 * @param analysis - analysis drawn from the rough brief
 * @returns the recommendation's HTML fragment
 */
function recommendation(retained, analysis) {
  const judged = retained
    .map((entry) => ({ entry, ...judge(entry, analysis) }))
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
  return `<section><div class="sec-head"><h2>What your project says about itself</h2>
<p>${esc(summarise(analysis))}</p></div>
${rules.length > 0 ? `<p class="lbl">Regles metier reperees</p><ol class="rules">${rules.map((r, i) => `<li><span class="rid">R${i + 1}</span><p>${esc(r.rule)}${r.why_it_matters ? ` — <em>${esc(r.why_it_matters)}</em>` : ""}</p></li>`).join("")}</ol>` : '<p class="empty">No business rule found: this product stores and returns.</p>'}
${validations.length > 0 ? `<p class="lbl">Ce qui n'is not</p><ul class="files">${validations.map((v) => `<li>${esc(v)}</li>`).join("")}</ul>` : ""}
<div class="sec-head" style="margin-top:1rem"><h2>Our advice, and why</h2>
<p>Fonde sur l'analyse ci-dessus, pas sur une preference generale. Le detail de chaque option reste plus bas.</p></div>
<div class="features">${rows}</div></section>`;
}

function main() {
  const [target, type, analysisPath] = process.argv.slice(2);
  if (!target || !type) {
    fail(`usage : render-architecture.mjs <sortie.html> <${Object.keys(PROJECT_TYPES).join("|")}> [analyse.json]`);
  }
  const project = PROJECT_TYPES[type];
  if (project == null) {
    fail(`unknown project type: ${type} (expected ${Object.keys(PROJECT_TYPES).join(", ")})`);
  }

  const retained = ARCHITECTURES.filter((entry) => entry.applies.includes(type));
  const example = project.example;

  let analysis = null;
  if (analysisPath != null) {
    if (!existsSync(analysisPath)) fail(`analysis not found: ${analysisPath}`);
    analysis = JSON.parse(readFileSync(analysisPath, "utf8"));
    if (!Array.isArray(analysis.business_rules)) {
      fail("the analysis must carry business_rules, even empty: saying there are none is a conclusion, not an omission");
    }
  }

  const axis = DECISION_AXIS.map(
    (item, index) => `<div class="open">
<h3><span class="qid">Q${index + 1}</span>${esc(item.question)}</h3>
<p class="short">${esc(item.short)}</p>
<p>${esc(item.why)}</p>
<ul class="alts">${item.answers
      .map(([answer, effect]) => `<li><span><strong>${esc(answer)}</strong> — ${esc(effect)}</span></li>`)
      .join("")}</ul>
</div>`,
  ).join("");

  const boundary =
    type !== "fullstack"
      ? ""
      : `<section><div class="sec-head"><h2>What crosses between the front and the back</h2>
<p>Sur un dépôt full-stack, cette question compte plus que la structure interne de chaque côté : c'is what decides what breaks when one side moves.</p></div>
<ol class="pledges">${FULLSTACK_BOUNDARY.map(
          (item, index) => `<li><span class="rid">${pad(index)}</span><p><strong>${esc(item.option)}</strong><br>
<em>Coût</em> — ${esc(item.cost)}<br><em>Gain</em> — ${esc(item.buys)}<br><em>Piège</em> — ${esc(item.wrong_when)}</p></li>`,
        ).join("")}</ol></section>`;

  const body = `<header class="masthead">
<p class="eyebrow">Configuration &middot; architecture choice &middot; ${esc(project.label)}</p>
<h1>How should this project's code be arranged?</h1>
<p class="lede">${esc(project.blurb)}</p>
<p class="verbatim">An architecture is <strong>where the files go</strong> and <strong>who is allowed to call whom</strong>. Nothing more. The complicated names are ways of answering those two questions.<br><br>The pipeline <strong>does not choose for you</strong>: the right answer depends on your product. It explains, then makes your choice enforceable &mdash; once declared, a file calling what it should not fails a gate instead of being flagged in review.</p>
</header>

${analysis == null ? questionnaire() : recommendation(retained, analysis)}

<section><div class="sec-head"><h2>At a glance</h2>
<p>${retained.length} options relevant to this project type. The detail is further down if you hesitate between two rows.</p></div>
${table(retained, example)}</section>

<section><div class="sec-head"><h2>The four questions that decide</h2>
<p>Answer them before looking at the names. They are answered without knowing any architecture, and they eliminate most of the options.</p></div>
<div class="features">${axis}</div></section>

<section><div class="sec-head"><h2>Each option in detail</h2>
<p>${retained.length} retained out of ${ARCHITECTURES.length}. The others are not bad: they solve problems this project type does not have.</p></div>
<div class="features">${retained.map((entry, index) => card(entry, index, example)).join("")}</div></section>

${boundary}

<section><div class="sec-head"><h2>&laquo; What if I get it wrong? &raquo;</h2>
<p>That is the right objection. At the start of a project you do not know everything yet, and the files still have to go somewhere.</p></div>
<p class="note"><strong>Do not pick the heaviest option out of caution.</strong> That is the most common mistake: you pay immediately for insurance you may never claim, and the cost is taken out of every file you write, for years.<br><br>
<strong>What decides is an asymmetry.</strong> Starting simple keeps the options open: you harden one folder the day it earns it, without touching the others. Starting complicated closes them: nobody removes layers, they endure them. A bad simple choice is corrected piece by piece; a bad heavy one, you live with.<br><br>
<strong>Here, changing your mind is measured.</strong> Your architecture is declared in the configuration and checked by a gate. The day you change the declaration, the gate prints you <em>the exact list</em> of files that no longer obey the new rule. A migration becomes a task list, not an exploration &mdash; and that is the difference with a project where the architecture lives only in people's heads.</p></section>

<section><div class="sec-head"><h2>What comes next</h2></div>
<p class="note">Your choice becomes one line in the configuration: the folders, and who is allowed to call whom. The profile translates it into an automatically checked rule.<br><br><strong>Worth knowing before you choose:</strong> changing architecture later means moving files across the whole project. The cheapest moment to decide is now, before the first line of code.</p></section>`;

  writeFileSync(target, shell(`Architecture — ${project.label}`, body));
  console.log(`written: ${target} (${type}, ${retained.length} options out of ${ARCHITECTURES.length}, ${analysis == null ? "questionnaire" : "advice grounded in the analysis"})`);
  console.log(SURFACE_HINT);
}

main();
