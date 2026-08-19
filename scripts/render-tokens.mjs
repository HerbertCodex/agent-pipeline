import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { loadConfig, fail } from "./lib.mjs";
import { esc, pad, shell, SURFACE_HINT } from "./page.mjs";
import { tokensIn } from "./mockup-check.mjs";

/**
 * Contrast below which a pair cannot carry body text.
 *
 * The number is not the framework's: it is the ratio the accessibility
 * guidelines require of normal text. It appears here because a palette that
 * hides it is a palette whose first screen has to be redone.
 */
const TEXT_CONTRAST = 4.5;

/**
 * Distance below which two colours are the same colour to a reader.
 *
 * Two swatches nobody can tell apart are two decisions where one was meant,
 * and they are how a palette grows to six greys that all do the same job.
 * The page names them; it does not refuse them, because a hover state may
 * legitimately sit that close.
 */
const SAME_COLOUR = 12;

/**
 * Parses a hexadecimal colour into its three channels.
 *
 * @param value - the declared value
 * @returns the channels, or null when the value is not a plain hex colour
 */
function channels(value) {
  const match = value.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (match == null) return null;
  const hex = match[1].length === 3 ? [...match[1]].map((c) => c + c).join("") : match[1];
  return [0, 2, 4].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
}

/**
 * Computes the contrast ratio between two colours.
 *
 * The formula is the one the accessibility guidelines define, reproduced here
 * rather than imported: the core installs nothing, and a ratio nobody can
 * compute is a ratio nobody checks.
 *
 * @param a - first colour's channels
 * @param b - second colour's channels
 * @returns the ratio, from 1 to 21
 */
function contrast(a, b) {
  const luminance = (rgb) =>
    0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
  const first = luminance(a);
  const second = luminance(b);
  const light = Math.max(first, second);
  const dark = Math.min(first, second);
  return (light + 0.05) / (dark + 0.05);
}

/**
 * Applies the transfer curve to one channel.
 *
 * @param value - channel value, 0 to 255
 * @returns the linearised channel
 */
function channel(value) {
  const ratio = value / 255;
  return ratio <= 0.03928 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
}

/**
 * Renders the colours as swatches, with what is wrong between them.
 *
 * @param colours - declared colours, name and channels
 * @returns the section's HTML fragment
 */
function palette(colours) {
  const swatches = colours
    .map(
      (colour, index) => `<article class="feature">
<header><span class="num">${pad(index)}</span><h3>${esc(colour.name)}</h3></header>
<div style="height:56px;border:1px solid var(--rule);border-radius:4px;background:${esc(colour.value)}"></div>
<p class="plain"><code>${esc(colour.value)}</code></p>
</article>`,
    )
    .join("");

  const pairs = [];
  for (let i = 0; i < colours.length; i += 1) {
    for (let j = i + 1; j < colours.length; j += 1) {
      const ratio = contrast(colours[i].rgb, colours[j].rgb);
      const distance = colours[i].rgb.reduce((sum, part, at) => sum + Math.abs(part - colours[j].rgb[at]), 0);
      pairs.push({ a: colours[i].name, b: colours[j].name, ratio, distance });
    }
  }
  pairs.sort((one, other) => other.ratio - one.ratio);

  const rows = pairs
    .map((pair) => {
      const weak = pair.ratio < TEXT_CONTRAST;
      const same = pair.distance <= SAME_COLOUR;
      const verdict = same
        ? "nearly indistinguishable &mdash; two decisions where one was meant"
        : weak
          ? `too weak for text (needs ${TEXT_CONTRAST}:1)`
          : "carries text";
      return `<tr><td><code>${esc(pair.a)}</code> on <code>${esc(pair.b)}</code></td><td>${pair.ratio.toFixed(2)}:1</td><td>${verdict}</td></tr>`;
    })
    .join("");

  return `<section><div class="sec-head"><h2>The colours, and what happens between them</h2>
<p>Every pair, with its contrast ratio. This is the measurable half of accessibility, and the half a palette can hide until the first screen is built.</p></div>
<div class="features">${swatches}</div>
<div class="tablewrap"><table>
<thead><tr><th>Pair</th><th>Contrast</th><th>Verdict</th></tr></thead>
<tbody>${rows}</tbody></table></div></section>`;
}

/**
 * Renders the lengths in order, so a near-duplicate step shows.
 *
 * @param lengths - declared lengths, name and pixel value
 * @returns the section's HTML fragment
 */
function scale(lengths) {
  if (lengths.length === 0) return "";
  const sorted = [...lengths].sort((a, b) => a.px - b.px);
  const widest = sorted[sorted.length - 1].px || 1;
  const rows = sorted
    .map((entry, index) => {
      const previous = sorted[index - 1];
      const tight = previous != null && Math.abs(entry.px - previous.px) <= 2;
      return `<li><span class="rid">${esc(entry.name)}</span><p><span style="display:inline-block;height:10px;background:var(--stamp);width:${Math.max(2, Math.round((entry.px / widest) * 100))}%"></span> ${esc(entry.value)}${
        tight ? ` &mdash; a step away from <code>${esc(previous.name)}</code>, which is no step at all` : ""
      }</p></li>`;
    })
    .join("");
  return `<section><div class="sec-head"><h2>The spacing scale, in order</h2>
<p>Sorted, because an unordered scale hides its own gaps &mdash; and its own repetitions.</p></div>
<ol class="rules">${rows}</ol></section>`;
}

/**
 * Renders each font as text rather than as a string.
 *
 * @param fonts - declared font families
 * @returns the section's HTML fragment
 */
function typefaces(fonts) {
  if (fonts.length === 0) return "";
  const rows = fonts
    .map(
      (font) => `<li><span class="rid">${esc(font.name)}</span>
<p style="font-family:${esc(font.value)};font-size:1.4rem">The quick brown fox &mdash; 0123456789</p>
<p class="plain"><code>${esc(font.value)}</code></p></li>`,
    )
    .join("");
  return `<section><div class="sec-head"><h2>The typefaces</h2>
<p>Rendered, not quoted. A font named but never shown tells you nothing about it, and two that read alike are one font too many.</p></div>
<ol class="rules">${rows}</ol></section>`;
}

/**
 * Renders the declared tokens as a page, before any screen exists.
 *
 * This is the one artefact of the visual work the framework can produce
 * honestly. A spec page renders fields somebody already wrote; a screen
 * mockup has no such source, because the drawing IS the content — a script
 * that rendered one would be inventing it, and an invented design is the
 * average of everything the model has seen.
 *
 * The tokens do have a source. Showing them side by side catches, in one
 * look, what no reading of the file catches: six greys that all do the same
 * job, a spacing step that repeats the one before it, a pair of colours that
 * cannot carry text.
 *
 * Usage: node render-tokens.mjs <output.html>
 */
function main() {
  const [target] = process.argv.slice(2);
  if (!target) fail("usage: render-tokens.mjs <output.html>");

  const config = loadConfig();
  const tokensPath = config.design_system?.tokens;
  if (typeof tokensPath !== "string" || tokensPath.length === 0) {
    fail("design_system.tokens missing: there is nothing to show. Declare the tokens first.");
  }
  if (!existsSync(tokensPath)) fail(`tokens not found: ${tokensPath}`);

  const declared = tokensIn(readFileSync(tokensPath, "utf8"));
  if (declared.size === 0) fail(`${tokensPath} declares no token: there is nothing to render.`);

  const colours = [];
  const lengths = [];
  const fonts = [];
  for (const [name, value] of declared) {
    const rgb = channels(value);
    if (rgb != null) {
      colours.push({ name, value, rgb });
      continue;
    }
    const length = value.trim().match(/^(-?\d*\.?\d+)(px|rem|em)$/);
    if (length != null) {
      const px = Number.parseFloat(length[1]) * (length[2] === "px" ? 1 : 16);
      lengths.push({ name, value, px });
      continue;
    }
    if (name.includes("font") || /serif|sans|mono/i.test(value)) fonts.push({ name, value });
  }

  const direction = config.design_system?.direction ?? {};
  const body = `<header class="masthead">
<p class="eyebrow">Design system &middot; declared tokens &middot; ${declared.size} entries</p>
<h1>What you are allowed to draw with</h1>
${direction.genre ? `<p class="lede">${esc(direction.genre)} &mdash; ${esc(direction.because ?? "")}</p>` : ""}
<p class="verbatim"><strong>This page does not decide anything and it is not a screen.</strong> It shows the values already declared, side by side, so that what a file hides becomes visible: colours nobody can tell apart, a spacing step that repeats the one before it, a pair that cannot carry text. The screens come after, and they may use nothing that is not here.</p>
</header>

${palette(colours)}
${scale(lengths)}
${typefaces(fonts)}
`;

  writeFileSync(target, shell("Design tokens", body));
  console.log(
    `written: ${target} (${colours.length} colour(s), ${lengths.length} length(s), ${fonts.length} typeface(s))`,
  );
  console.log(SURFACE_HINT);
}

if (process.argv[1]?.endsWith("render-tokens.mjs")) main();
