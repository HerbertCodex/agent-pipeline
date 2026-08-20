import { readFileSync } from "node:fs";
import { relative, sep } from "node:path";
import { loadConfig, fail } from "./lib.mjs";
import { DEFAULT_EXTENSIONS, walk } from "./surface.mjs";

/**
 * Declarations that owe a contract, with their parameter list when they take one.
 *
 * Only shapes that publish a name are read. A non-exported function owes
 * nothing: if its body needs to be told, its name or its decomposition is
 * what is wrong.
 */
const CONTRACTED = [
  { kind: "function", pattern: /^\s*export\s+(?:default\s+)?(?:async\s+)?function\s+\*?\s*([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/ },
  { kind: "class", pattern: /^\s*export\s+(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/ },
  { kind: "interface", pattern: /^\s*export\s+(?:declare\s+)?interface\s+([A-Za-z_$][\w$]*)/ },
  { kind: "type", pattern: /^\s*export\s+(?:declare\s+)?type\s+([A-Za-z_$][\w$]*)/ },
  { kind: "constant", pattern: /^\s*export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/ },
];

/**
 * Reads the documentation block sitting immediately above a line.
 *
 * @param lines - the file's lines
 * @param index - index of the declared line
 * @returns the block's lines, outermost markers stripped, or an empty list
 */
function blockAbove(lines, index) {
  let cursor = index - 1;
  while (cursor >= 0 && lines[cursor].trim().length === 0) cursor -= 1;
  if (cursor < 0 || !lines[cursor].trim().endsWith("*/")) return [];
  const collected = [];
  while (cursor >= 0) {
    collected.unshift(lines[cursor]);
    if (lines[cursor].trim().startsWith("/**")) return collected;
    cursor -= 1;
  }
  return [];
}

/**
 * Extracts the parameter names a signature declares.
 *
 * Destructuring, defaults and type annotations are stripped: what a contract
 * owes an entry for is the name the caller reads, not the shape it unpacks.
 *
 * @param signature - the text between the parentheses
 * @returns the parameter names, in order
 */
function parametersOf(signature) {
  if (signature == null || signature.trim().length === 0) return [];
  return signature
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !part.startsWith("{") && !part.startsWith("["))
    .map((part) => part.replace(/^\.\.\./, "").split(/[:=]/)[0].trim())
    .filter((name) => /^[A-Za-z_$][\w$]*$/.test(name));
}

/**
 * Refuses an exported symbol whose contract is absent or out of date.
 *
 * A contract is the one comment that survives: it says what the caller may
 * rely on, and renaming a parameter without touching its entry turns it into
 * a statement about code that no longer exists. That is worse than no
 * comment, because it is believed.
 *
 * The framework ships it so no project starts without the rule. A profile
 * whose language has a real documentation tool replaces it through
 * `commands.doc_lint`.
 *
 * Usage: node doc-lint.mjs
 */
function main() {
  const config = loadConfig();
  const settings = config.doc_lint ?? {};
  const roots = Array.isArray(settings.roots) ? settings.roots : config.project_map?.roots;
  if (!Array.isArray(roots) || roots.length === 0) {
    fail("doc_lint.roots missing, and project_map.roots does not stand in: name the directories to read.");
  }
  const extensions = Array.isArray(settings.extensions)
    ? settings.extensions
    : (config.project_map?.extensions ?? DEFAULT_EXTENSIONS);
  const skipPattern = settings.skip ?? config.project_map?.skip;
  const skip = typeof skipPattern === "string" ? new RegExp(skipPattern) : null;

  const offenders = [];
  let contracted = 0;
  let files = 0;

  for (const root of roots) {
    for (const path of walk(root, skip)) {
      if (!extensions.some((extension) => path.endsWith(extension))) continue;
      files += 1;
      const shown = relative(".", path).split(sep).join("/");
      const lines = readFileSync(path, "utf8").split("\n");
      lines.forEach((line, index) => {
        for (const { kind, pattern } of CONTRACTED) {
          const match = line.match(pattern);
          if (match == null) continue;
          contracted += 1;
          const name = match[1];
          const block = blockAbove(lines, index);
          if (block.length === 0) {
            offenders.push(`${shown}:${index + 1}: ${name} (${kind}) carries no contract`);
            return;
          }
          const text = block.join("\n");
          const documented = [...text.matchAll(/@param\s+([A-Za-z_$][\w$]*)/g)].map((found) => found[1]);
          const declaredParams = kind === "function" ? parametersOf(match[2]) : [];
          for (const parameter of declaredParams) {
            if (!documented.includes(parameter)) {
              offenders.push(`${shown}:${index + 1}: ${name} takes ${parameter}, the contract does not name it`);
            }
          }
          for (const documentedName of documented) {
            if (!declaredParams.includes(documentedName)) {
              offenders.push(`${shown}:${index + 1}: ${name} documents ${documentedName}, which it does not take`);
            }
          }
          return;
        }
      });
    }
  }

  if (files === 0) fail(`no file to read under ${roots.join(", ")} with extensions ${extensions.join(", ")}.`);

  if (offenders.length > 0) {
    console.error(`${offenders.length} contract(s) absent or out of date:`);
    for (const line of offenders) console.error(`  ${line}`);
    fail("A contract describing code that no longer exists is worse than none: it is believed.");
  }
  console.log(`doc-lint: ${files} file(s), ${contracted} exported symbol(s), every contract present and matching.`);
}

main();
