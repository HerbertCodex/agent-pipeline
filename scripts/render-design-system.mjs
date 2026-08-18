import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fail } from "./lib.mjs";
import { esc, pad, shell, SURFACE_HINT } from "./page.mjs";

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
const LAYERS = [
  {
    name: "1. Tokens",
    plain:
      "The raw values: colours, spacing, type sizes, radii, durations. A list of names and values, no component.",
    why: "Everything else refers to them. Putting them last means everything before carries hardcoded values, and a change of brand is made file by file.",
    decide: "Where they live, and in what form. A file of CSS variables, a TypeScript object, a style engine's configuration: it does not matter, as long as there is ONE.",
    trap: "Two sources of truth. Tokens in the code and a palette in the mockup tool, drifting apart in silence.",
  },
  {
    name: "2. Primitives",
    plain:
      "The bricks with no domain: button, field, label, modal. They know no product rule, only the tokens.",
    why: "This is the layer where duplication starts. An agent that finds none writes one more button, then another.",
    decide: "Write them yourself, or take an existing library. See below: that choice is weighed, not guessed.",
    trap: "A primitive taking a domain prop. From then on it is no longer reusable, and the next one gets copied.",
  },
  {
    name: "3. Product components",
    plain: "What knows the domain: a book card, a loan form. They assemble primitives.",
    why: "They change often, and that is fine. What must not change often is the two layers beneath.",
    decide: "Where they live: your architecture answers that, not this page.",
    trap: "A product component redefining a colour instead of using a token.",
  },
  {
    name: "4. Screens and journeys",
    plain: "The final assembly, and the navigation between assemblies.",
    why: "It is what a user sees, so it is what gets discussed first, and yet it is what gets decided last.",
    decide: "Nothing structural here if the three layers above hold.",
    trap: "Starting here. That is the mockup drawn before the tokens.",
  },
];

/**
 * What a mockup drawn before the tokens costs.
 */
const MOCKUP = `<section><div class="sec-head"><h2>&laquo; Do we draw the mockup first? &raquo;</h2>
<p>Short answer: a mockup, yes. THE finished mockup, no.</p></div>
<p class="note"><strong>An exploratory mockup is drawn right now</strong> &mdash; on paper, in grey, with no precise value. It exists to agree on what the product does, and that is exactly what phase 1 of a spec asks for.<br><br>
<strong>A finished mockup drawn before the tokens invents a scale.</strong> Spacings picked by eye, half a dozen slightly different greys, three type sizes close together. The code copies them, because it has nothing else to refer to. You then do not have a design system: you have a transcribed mockup, and the first change request is paid for everywhere.<br><br>
<strong>The order that holds:</strong> agreement on what the product does &rarr; tokens &rarr; primitives &rarr; finished mockup built from the primitives that exist &rarr; screens. The mockup then becomes an assembly of things that exist, not an image to reproduce.</p></section>`;

/**
 * Writing your own primitives or taking a library: the recurring choice.
 *
 * @returns the section's HTML fragment
 */
function libraryChoice() {
  const options = [
    {
      option: "Take a full component library",
      cost: "You inherit its visual choices, its weight and its upgrades. Getting out later costs more than getting in.",
      buys: "Primitives that work with a keyboard and a screen reader from day one. That is the most underestimated work in this list.",
      wrong_when: "When the brand is strong and specific: you will spend more time fighting the library than using it.",
    },
    {
      option: "Take an unstyled library, and dress it yourself",
      cost: "You write every appearance. The behaviour is given to you.",
      buys: "Accessibility and focus management without inheriting a visual identity. The best ratio for a brand of your own.",
      wrong_when: "On three screens: setting it up costs more than it protects.",
    },
    {
      option: "Write everything",
      cost: "Accessibility is entirely yours. Focus traps, screen reader announcements, focus restoration: it is a craft.",
      buys: "No dependency, no inheritance. Justified when the product IS its interface.",
      wrong_when: "Almost always, at the start. It is the choice that looks cheapest and is not.",
    },
  ];
  const rows = options
    .map(
      (item, index) => `<article class="feature">
<header><span class="num">${pad(index)}</span><h3>${esc(item.option)}</h3></header>
<ol class="rules">
<li><span class="rid">Cost</span><p>${esc(item.cost)}</p></li>
<li><span class="rid">Buys</span><p>${esc(item.buys)}</p></li>
<li><span class="rid">Trap</span><p>${esc(item.wrong_when)}</p></li>
</ol></article>`,
    )
    .join("");
  return `<section><div class="sec-head"><h2>Write the primitives, or take an existing component library</h2>
<p>The pipeline installs nothing: it argues and stops. This choice is submitted like any dependency, with its licence, its upkeep and its security surface.</p></div>
<div class="features">${rows}</div>
<p class="note"><strong>The criterion that decides is accessibility.</strong> A library that handles neither focus, nor the keyboard, nor screen reader announcements is not a component library: it is a set of styles, and the hard work is still entirely ahead of you. Check that before the colours, not after.</p></section>`;
}

/**
 * Rend la page de decision du design system.
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

  let analysis = {};
  if (analysisPath != null) {
    if (!existsSync(analysisPath)) fail(`analysis not found: ${analysisPath}`);
    analysis = JSON.parse(readFileSync(analysisPath, "utf8"));
  }

  const layers = LAYERS.map(
    (layer, index) => `<article class="feature">
<header><span class="num">${pad(index)}</span><h3>${esc(layer.name)}</h3></header>
<p class="plain">${esc(layer.plain)}</p>
<ol class="rules">
<li><span class="rid">Why here</span><p>${esc(layer.why)}</p></li>
<li><span class="rid">Decide</span><p>${esc(layer.decide)}</p></li>
<li><span class="rid">Trap</span><p>${esc(layer.trap)}</p></li>
</ol></article>`,
  ).join("");

  const known = analysis.existing_library
    ? `<p class="note"><strong>Already in place:</strong> ${esc(String(analysis.existing_library))}. The choice below then reads as &laquo; keep or leave &raquo;, and leaving costs more than entering.</p>`
    : "";

  const body = `<header class="masthead">
<p class="eyebrow">Configuration &middot; design system &middot; ${esc(type)}</p>
<h1>What is settled before the first screen</h1>
<p class="lede">Four layers, and an order. The order is the content of this page: you do not reverse it afterwards without going over everything again.</p>
<p class="verbatim">The pipeline <strong>does not choose for you</strong>. It explains, then makes your choice enforceable: once declared it is read back by a gate instead of being recalled in review.</p>
${known}
</header>

<section><div class="sec-head"><h2>The four layers, in order</h2>
<p>Each knows only the ones above it. A layer that jumps over its neighbour is an interface's first debt.</p></div>
<div class="features">${layers}</div></section>

${MOCKUP}

${libraryChoice()}

<section><div class="sec-head"><h2>What you declare next</h2></div>
<p class="note">Three values in <code>pipeline.config.json</code>, under <code>design_system</code>: <code>tokens</code> (the path of the single source of truth), <code>primitives</code> (<code>own</code>, or the name of the library retained) and <code>decided_at</code>.<br><br>Without them, <code>apply-profile</code> refuses to run on a project with screens. The reason is the same as for the architecture: a choice that lives only in a page binds nobody, the agent taking the first issue will settle it alone, and every one after inherits it without anyone having approved it.</p></section>
`;

  writeFileSync(target, shell(`Design system ${type}`, body));
  console.log(`written: ${target} (${type}, ${LAYERS.length} layers)`);
  console.log(SURFACE_HINT);
}

if (process.argv[1]?.endsWith("render-design-system.mjs")) main();
