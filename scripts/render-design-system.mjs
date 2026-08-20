import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fail } from "./lib.mjs";
import { esc, pad, shell, SURFACE_HINT, resolvePage, safeConfig, pageText } from "./page.mjs";

/**
 * Project types that have screens, and therefore a design system.
 *
 * A back-end service has none: asking there would produce an empty page
 * people learn to skip, and a question people learn to skip ends up hiding
 * the ones that matter.
 */
const WITH_SCREENS = ["frontend", "mobile", "fullstack"];

/**
 * The decisions to take, in the order they constrain each other.
 *
 * The order is this page's main content. Primitives written before the tokens
 * freeze hardcoded values, and a mockup drawn before the tokens invents a
 * scale the code then copies. That order cannot be reversed afterwards
 * without going over everything again.
 */
const LAYERS = ["tokens", "primitives", "components", "screens"];

/**
 * What a mockup drawn before the tokens costs.
 *
 * @param t - the page's translated strings
 * @returns the section's HTML fragment
 */
function mockupSection(t) {
  return `<section><div class="sec-head"><h2>${t.mockup_head}</h2>
<p>${esc(t.mockup_blurb)}</p></div>
<p class="note">${t.mockup_note}</p></section>`;
}

/**
 * Writing your own primitives or taking a library: the recurring choice.
 *
 * @param t - the page's translated strings
 * @returns the section's HTML fragment
 */
function libraryChoice(t) {
  const rows = ["full", "unstyled", "own"]
    .map((id) => t.options[id])
    .map(
      (item, index) => `<article class="feature">
<header><span class="num">${pad(index)}</span><h3>${esc(item.option)}</h3></header>
<ol class="rules">
<li><span class="rid">${esc(t.lbl_cost)}</span><p>${esc(item.cost)}</p></li>
<li><span class="rid">${esc(t.lbl_buys)}</span><p>${esc(item.buys)}</p></li>
<li><span class="rid">${esc(t.lbl_trap)}</span><p>${esc(item.wrong_when)}</p></li>
</ol></article>`,
    )
    .join("");
  return `<section><div class="sec-head"><h2>${esc(t.library_head)}</h2>
<p>${esc(t.library_blurb)}</p></div>
<div class="features">${rows}</div>
<p class="note">${t.library_note}</p></section>`;
}

/**
 * Renders the design system decision page.
 */
function main() {
  const [target, type, analysisPath] = process.argv.slice(2);
  if (!target || !type) fail("usage: render-design-system.mjs <output.html> <frontend|mobile|fullstack> [analysis.json]");
  if (!WITH_SCREENS.includes(type)) {
    fail(
      `no design system for a ${type} project: it has no screen. Recognised types with an interface: ` +
        `${WITH_SCREENS.join(", ")}.`,
    );
  }

  const config = safeConfig();
  const t = pageText(config).pages.design_system;

  let analysis = {};
  if (analysisPath != null) {
    if (!existsSync(analysisPath)) fail(`analysis not found: ${analysisPath}`);
    analysis = JSON.parse(readFileSync(analysisPath, "utf8"));
  }

  const layers = LAYERS.map((id) => t.layers[id])
    .map(
      (layer, index) => `<article class="feature">
<header><span class="num">${pad(index)}</span><h3>${esc(layer.name)}</h3></header>
<p class="plain">${esc(layer.plain)}</p>
<ol class="rules">
<li><span class="rid">${esc(t.lbl_why)}</span><p>${esc(layer.why)}</p></li>
<li><span class="rid">${esc(t.lbl_decide)}</span><p>${esc(layer.decide)}</p></li>
<li><span class="rid">${esc(t.lbl_trap)}</span><p>${esc(layer.trap)}</p></li>
</ol></article>`,
    )
    .join("");

  const known = analysis.existing_library
    ? `<p class="note">${t.already.split("{library}").join(esc(String(analysis.existing_library)))}</p>`
    : "";

  const body = `<header class="masthead">
<p class="eyebrow">${t.eyebrow} &middot; ${esc(type)}</p>
<h1>${esc(t.title)}</h1>
<p class="lede">${esc(t.lede)}</p>
<p class="verbatim">${t.verbatim}</p>
${known}
</header>

<section><div class="sec-head"><h2>${esc(t.layers_head)}</h2>
<p>${esc(t.layers_blurb)}</p></div>
<div class="features">${layers}</div></section>

${mockupSection(t)}

${libraryChoice(t)}

<section><div class="sec-head"><h2>${esc(t.declare_head)}</h2></div>
<p class="note">${t.declare_note}</p></section>
`;

  const written = resolvePage(target, config);
  writeFileSync(written, shell(t.doc_title.split("{type}").join(type), body));
  console.log(
    `written: ${written} (${type}, ${LAYERS.length} layers)`);
  console.log(SURFACE_HINT);
}

if (process.argv[1]?.endsWith("render-design-system.mjs")) main();
