import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { loadConfig, fail } from "./lib.mjs";

/**
 * A class name in selector position: the dot, then an identifier.
 */
const CLASS = /\.(-?[_a-zA-Z][\w-]*)/g;

/**
 * Walks a root and returns its stylesheets, minus the ones skipped.
 *
 * Only `.css` is read: a preprocessor sheet nests rules by its own grammar,
 * and this script knows none.
 *
 * @param root - starting directory
 * @param skip - rejection regular expression, or null
 * @param found - accumulator of retained paths
 * @returns the retained paths, in directory order
 */
function stylesheets(root, skip, found = []) {
  let entries;
  try {
    entries = readdirSync(root).sort();
  } catch {
    return found;
  }
  for (const entry of entries) {
    const path = join(root, entry);
    if (skip != null && skip.test(path)) continue;
    if (statSync(path).isDirectory()) stylesheets(path, skip, found);
    else if (extname(path) === ".css") found.push(path);
  }
  return found;
}

/**
 * Blanks the comments of a stylesheet, keeping every newline.
 *
 * Removing a comment outright would shift every line number after it, and a
 * gate that names the wrong line sends the reader to a rule it did not refuse.
 *
 * @param source - the stylesheet text
 * @returns the text with comments replaced by spaces of the same shape
 */
function blankComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
}

/**
 * Returns the selector preludes of a stylesheet, at-rules excluded.
 *
 * Brace depth is tracked rather than matched by pattern: a rule inside a
 * media query is nested, and a pattern pairing the first `{` with the first
 * `}` would read the query itself as a selector. What accumulates between two
 * braces is a prelude; what follows a prelude is a body, and a body is never
 * read — a class name inside `content` or a `url()` declares nothing.
 *
 * @param source - the stylesheet text, comments already blanked
 * @returns one entry per rule, in file order, with the line it opens on
 */
function preludes(source) {
  const found = [];
  let buffer = "";
  let line = 1;
  for (const character of source) {
    if (character === "\n") line += 1;
    if (character === "{" || character === "}") {
      const prelude = buffer.trim();
      if (character === "{" && prelude.length > 0 && !prelude.startsWith("@")) found.push({ prelude, line });
      buffer = "";
    } else buffer += character;
  }
  return found;
}

/**
 * Returns the class names one stylesheet claims in selector position.
 *
 * @param path - the stylesheet to read
 * @returns a map from class name to the first line claiming it
 */
function claims(path) {
  const named = new Map();
  for (const { prelude, line } of preludes(blankComments(readFileSync(path, "utf8")))) {
    for (const match of prelude.matchAll(CLASS)) {
      if (!named.has(match[1])) named.set(match[1], line);
    }
  }
  return named;
}

/**
 * Reads the primitives sheet and the roots holding the sheets it arbitrates.
 *
 * @param config - the project configuration
 * @returns the primitives sheet, the skip pattern and the roots
 */
function settings(config) {
  const primitives = config.design_system?.primitives_sheet;
  if (typeof primitives !== "string" || primitives.trim().length === 0) {
    fail(
      "design_system.primitives_sheet missing: name the stylesheet that declares the shared primitives, " +
        "the one every other stylesheet is allowed to extend. Without it no name has an owner, and the " +
        "gate could only refuse everything or nothing.",
    );
  }
  if (!existsSync(primitives)) fail(`design_system.primitives_sheet does not name a readable file: ${primitives}`);
  const roots = config.project_map?.roots;
  if (!Array.isArray(roots) || roots.length === 0) {
    fail("project_map.roots missing: the gate reads every stylesheet under those roots and has nowhere to look.");
  }
  const skip = typeof config.project_map?.skip === "string" ? new RegExp(config.project_map.skip) : null;
  return { primitives, roots, skip };
}

/**
 * Reports the class names two stylesheets claim without a primitive to share.
 *
 * @param owned - the names the primitives sheet declares
 * @param byFile - each stylesheet with the names it claims
 * @returns one entry per contested name, with the sites claiming it
 */
function contested(owned, byFile) {
  const holders = new Map();
  for (const { path, named } of byFile) {
    for (const [name, line] of named) {
      if (!holders.has(name)) holders.set(name, []);
      holders.get(name).push(`${path}:${line}`);
    }
  }
  return [...holders]
    .filter(([name, sites]) => sites.length > 1 && !owned.has(name))
    .map(([name, sites]) => ({ name, sites }));
}

function main() {
  const config = loadConfig();
  const { primitives, roots, skip } = settings(config);
  const normalized = (path) => path.split("\\").join("/");
  const sheets = roots
    .flatMap((root) => stylesheets(root, skip))
    .map(normalized)
    .filter((path) => path !== normalized(primitives));
  const owned = claims(primitives);
  const byFile = sheets.map((path) => ({ path, named: claims(path) }));
  const total = new Set(byFile.flatMap(({ named }) => [...named.keys()]));

  const offences = contested(owned, byFile);
  if (offences.length > 0) {
    const lines = [
      `css ownership: ${offences.length} class name(s) claimed by two stylesheets with no primitive to share.`,
      "",
      "Stylesheets are global and loaded per route: the last one to arrive wins, on every page already",
      "displayed. The defect therefore shows after a preload, never on the page alone.",
      "",
    ];
    for (const { name, sites } of offences) {
      lines.push(`  .${name}`);
      for (const site of sites) lines.push(`      ${site}`);
    }
    lines.push("", `Rename one, or declare the primitive in ${primitives} and let the stylesheets extend it.`);
    fail(lines.join("\n"));
  }

  if (total.size === 0) {
    fail(
      `${sheets.length} stylesheet(s) name no class at all. A gate with nothing to compare is green by ` +
        "emptiness, which reads as a proof and is not one.",
    );
  }

  const extended = [...total].filter((name) => owned.has(name)).length;
  console.log(
    `css ownership: ${sheets.length} stylesheet(s), ${total.size} class name(s), ${extended} extended from ` +
      `${primitives}, none claimed twice.`,
  );
}

main();
