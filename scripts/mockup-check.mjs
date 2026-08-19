import { readFileSync, existsSync } from "node:fs";
import { loadConfig, fail } from "./lib.mjs";

/**
 * Value shapes a mockup can state literally instead of referring to a token.
 *
 * Colour, length and font family are the three that decide whether a screen
 * belongs to the product or to whoever wrote it that afternoon. They are also
 * the three an agent invents most readily, because a plausible value is always
 * within reach and nothing asks where it came from.
 */
const LITERALS = [
  { kind: "colour", pattern: /#[0-9a-f]{3,8}\b|\brgba?\([^)]*\)|\bhsla?\([^)]*\)/gi },
  { kind: "length", pattern: /(?<![\w#-])-?\d*\.?\d+(?:px|rem|em)\b/gi },
  { kind: "font", pattern: /font-family\s*:\s*([^;}]+)/gi },
];

/**
 * Lengths every design carries and no design system declares.
 *
 * Zero is not a spacing decision, and a hairline border is a rendering
 * detail rather than a step on a scale. Refusing them would teach the reader
 * to add noise to the tokens file, which is the opposite of the point.
 */
const EXEMPT_LENGTHS = new Set(["0px", "0rem", "0em", "1px", "100px"]);

/**
 * Reads the values a tokens file declares.
 *
 * The parsing is deliberately shallow: any `--name: value` line counts,
 * whatever the file's language. A tokens file is a list of names and values
 * by definition, and anything that needs a parser to read is already too
 * clever to be one source of truth.
 *
 * @param body - content of the tokens file
 * @returns the declared names and the set of declared values
 */
export function tokensIn(body) {
  const declared = new Map();
  for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;\n}]+)/g)) {
    declared.set(match[1], match[2].trim());
  }
  return declared;
}

/**
 * Returns the declared token whose value is closest to a colour.
 *
 * A refusal that only says no sends the agent looking for a second value it
 * likes. Naming the nearest one turns the fix into a substitution \u2014 but only
 * when there is a real neighbour, otherwise the hint is followed and lies.
 *
 * @param value - the literal found in the mockup
 * @param declared - the declared tokens
 * @returns the name of the nearest token, or null when none is comparable
 */
function nearestToken(value, declared) {
  const parse = (text) => {
    const hex = text.trim().match(/^#([0-9a-f]{6})$/i);
    if (hex == null) return null;
    return [0, 2, 4].map((at) => Number.parseInt(hex[1].slice(at, at + 2), 16));
  };
  const target = parse(value);
  if (target == null) return null;

  // Beyond this, the nearest token is not a neighbour, it is merely the least
  // distant of a set that contains nothing comparable. Suggesting cream for a
  // blue would be followed, and a bad suggestion is worse than none.
  const TOO_FAR = 120;
  let best = null;
  let bestDistance = Infinity;
  for (const [name, declaredValue] of declared) {
    const candidate = parse(declaredValue);
    if (candidate == null) continue;
    const distance = candidate.reduce((sum, part, index) => sum + Math.abs(part - target[index]), 0);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = name;
    }
  }
  return bestDistance <= TOO_FAR ? best : null;
}

/**
 * Collects the literal values a mockup states instead of referring to a token.
 *
 * @param body - content of the mockup file
 * @param declared - the declared tokens
 * @returns the offending values, and how many were examined
 */
export function offenders(body, declared) {
  const values = new Set([...declared.values()].map((value) => value.toLowerCase().trim()));
  const fonts = [...declared.entries()]
    .filter(([name]) => name.includes("font"))
    .map(([, value]) => value.toLowerCase());
  const found = [];
  // A reference to a declared token is a value stated correctly, and it counts
  // as examined. Without this the best possible mockup — one that names no
  // literal at all — would look like a mockup with no styling.
  let checked = [...body.matchAll(/var\(\s*--[\w-]+/g)].length;

  for (const { kind, pattern } of LITERALS) {
    for (const match of body.matchAll(pattern)) {
      const raw = (kind === "font" ? match[1] : match[0]).trim();
      const normalised = raw.toLowerCase();
      if (kind === "font" && normalised.startsWith("var(")) continue;
      checked += 1;
      if (values.has(normalised)) continue;
      if (kind === "length" && EXEMPT_LENGTHS.has(normalised)) continue;
      if (kind === "font" && fonts.some((declaredFont) => declaredFont === normalised)) continue;
      found.push({ kind, raw, nearest: kind === "colour" ? nearestToken(raw, declared) : null });
    }
  }
  return { found, checked };
}

/**
 * Refuses a mockup that states values the design system never declared.
 *
 * The design-system page already says what a mockup is: an assembly of things
 * that exist, not an image to reproduce. Nothing made that true. A mockup
 * drawn with values picked by eye invents a scale, the code copies it because
 * it has nothing else to refer to, and the project ends up with a transcribed
 * mockup rather than a design system.
 *
 * That is also where the machine-made look comes from. An agent asked for a
 * screen reaches for a plausible colour, and plausible converges: the same
 * blue, the same near-black, the same font. Refusing every value that does
 * not trace back to a declared token is what forces the screen to come from
 * this project rather than from habit.
 *
 * Usage: node mockup-check.mjs <mockup-file>
 */
function main() {
  const [target] = process.argv.slice(2);
  if (!target) fail("usage: mockup-check.mjs <mockup-file>");

  const config = loadConfig();
  const tokensPath = config.design_system?.tokens;
  if (typeof tokensPath !== "string" || tokensPath.length === 0) {
    fail("design_system.tokens missing: there is nothing to check a mockup against. Declare the tokens first.");
  }
  if (!existsSync(tokensPath)) {
    fail(`tokens not found: ${tokensPath}. The configuration names it as the single source of truth.`);
  }
  if (!existsSync(target)) fail(`mockup not found: ${target}`);

  const declared = tokensIn(readFileSync(tokensPath, "utf8"));
  if (declared.size === 0) fail(`${tokensPath} declares no token: a mockup checked against nothing passes for free.`);

  const { found, checked } = offenders(readFileSync(target, "utf8"), declared);

  if (checked === 0) {
    fail(
      `${target} states no colour, length or font at all. A mockup with no styling is not a mockup, ` +
        "and it would pass this check for free.",
    );
  }

  if (found.length === 0) {
    console.log(`mockup: ${target}, ${checked} value(s) checked against ${declared.size} token(s), all accounted for.`);
    return;
  }

  for (const item of found) {
    const hint = item.nearest != null ? ` — nearest declared token: ${item.nearest}` : "";
    console.log(`  ${item.kind.padEnd(7)} ${item.raw}${hint}`);
  }
  console.log("");
  console.log(`${found.length} value(s) the design system never declared, out of ${checked} checked.`);
  console.log("A mockup is an assembly of what exists, not an image to reproduce. A value picked by eye");
  console.log("invents a scale, the code copies it for want of anything else, and the project ends up with");
  console.log("a transcribed mockup instead of a design system.");
  console.log("Use a token, or add the value to the tokens file as a deliberate decision — not as a repair.");
  process.exit(1);
}

if (process.argv[1]?.endsWith("mockup-check.mjs")) main();
