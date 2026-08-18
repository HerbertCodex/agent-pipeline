import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join, dirname, relative, sep } from "node:path";
import { loadConfig, fail } from "./lib.mjs";

/**
 * File extensions walked when the configuration names none.
 *
 * The list is broad on purpose: a generator that walks nothing produces an
 * empty map, and an empty map passes every check while answering no
 * question. Narrowing it is the project's job, through `project_map.extensions`.
 */
const DEFAULT_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".py", ".go", ".rs", ".rb", ".java", ".kt", ".php", ".cs", ".swift"];

/**
 * Patterns that recognise a public declaration without parsing anything.
 *
 * This is a heuristic and says so. It reads the shapes several ecosystems
 * share for "this name leaves the file", and it will miss what does not look
 * like them: a re-export through an index, a name assembled at runtime, a
 * class member. What it misses stays invisible to whoever reads the map, so
 * the map states its own method rather than implying completeness.
 *
 * The framework ships it so that no project starts with no map at all. A
 * profile that wants roles, routes and types replaces it with a generator
 * that actually parses its language, and `commands.project_map` is the key
 * that swaps one for the other.
 */
const DECLARATIONS = [
  { kind: "class", pattern: /^\s*(?:export\s+(?:default\s+)?)?(?:pub\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/ },
  { kind: "interface", pattern: /^\s*export\s+(?:declare\s+)?interface\s+([A-Za-z_$][\w$]*)/ },
  { kind: "type", pattern: /^\s*export\s+(?:declare\s+)?type\s+([A-Za-z_$][\w$]*)/ },
  { kind: "enum", pattern: /^\s*export\s+(?:declare\s+)?enum\s+([A-Za-z_$][\w$]*)/ },
  { kind: "function", pattern: /^\s*export\s+(?:default\s+)?(?:async\s+)?function\s+\*?\s*([A-Za-z_$][\w$]*)/ },
  { kind: "function", pattern: /^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_$][\w$]*)/ },
  { kind: "function", pattern: /^\s*func\s+(?:\([^)]*\)\s*)?([A-Z][\w$]*)/ },
  { kind: "function", pattern: /^\s*def\s+([A-Za-z_][\w]*)/ },
  { kind: "constant", pattern: /^\s*export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/ },
  { kind: "constant", pattern: /^\s*(?:pub\s+)?(?:const|static)\s+([A-Z][A-Z0-9_]*)\s*[:=]/ },
];

/**
 * Comment markers a documentation line can start with.
 */
const DOC_LINE = /^\s*(?:\/\*\*?|\/\/\/?|\*|#|"""|'''|--)\s?(.*?)\s*(?:\*\/|"""|''')?\s*$/;

/**
 * Walks a root and returns its files, minus the ones skipped.
 *
 * @param root - starting directory
 * @param skip - rejection regular expression, or null
 * @param found - accumulator of retained paths
 * @returns the retained paths
 */
function walk(root, skip, found = []) {
  let entries;
  try {
    entries = readdirSync(root);
  } catch {
    return found;
  }
  for (const entry of entries.sort()) {
    const path = join(root, entry);
    if (skip != null && skip.test(path)) continue;
    if (statSync(path).isDirectory()) walk(path, skip, found);
    else found.push(path);
  }
  return found;
}

/**
 * Returns the documentation line sitting above a declaration.
 *
 * Only the first sentence is kept. A map is read to answer "does this exist
 * already?", and a paragraph per entry turns that answer into a search.
 *
 * A line that only opens or closes a block carries nothing, and reading it
 * would hand back a stray slash as if it were documentation.
 *
 * @param lines - the file's lines
 * @param index - index of the declaration line
 * @returns the documentation line, or an empty string
 */
function docAbove(lines, index) {
  for (let cursor = index - 1; cursor >= 0 && cursor >= index - 6; cursor -= 1) {
    const line = lines[cursor];
    const bare = line.trim();
    if (bare.length === 0 || bare === "/**" || bare === "*/" || bare === "*") continue;
    const match = line.match(DOC_LINE);
    if (match == null) return "";
    const text = match[1].trim().replace(/^\*+\s*/, "");
    if (text.length > 0 && !text.startsWith("@")) return text.replace(/\.$/, "");
  }
  return "";
}

/**
 * Extracts the declarations a file appears to publish.
 *
 * @param body - file content
 * @returns the declarations found, in file order
 */
function declarationsIn(body) {
  const lines = body.split("\n");
  const found = [];
  const seen = new Set();
  lines.forEach((line, index) => {
    for (const { kind, pattern } of DECLARATIONS) {
      const match = line.match(pattern);
      if (match == null) continue;
      const name = match[1];
      if (seen.has(name)) return;
      seen.add(name);
      found.push({ name, kind, doc: docAbove(lines, index) });
      return;
    }
  });
  return found;
}

/**
 * Renders the map as a deterministic Markdown document.
 *
 * @param files - the files scanned, with their declarations
 * @param roots - the configured roots
 * @returns the complete document
 */
function render(files, roots) {
  const total = files.reduce((sum, file) => sum + file.declarations.length, 0);
  const silent = files.filter((file) => file.declarations.length === 0).length;
  const lines = [
    "# Project map",
    "",
    "GENERATED by `agent-pipeline/scripts/project-map.mjs`. Do not edit by hand: the `project_map`",
    "gate replays the generation and fails on any drift.",
    "",
    "This is the answer to \"does this already exist?\". The reuse note demanded of every creation is",
    "judged against it, and the `duplication` gate refuses what it did not stop.",
    "",
    "**How it is built, and what it misses.** This generator recognises declarations by **pattern**,",
    "it does not parse any language. A re-export through an index, a name assembled at runtime and a",
    "class member are invisible to it, and so is anything shaped differently from the idioms it knows.",
    "A profile that needs roles, routes and types points `commands.project_map` at a generator that",
    "really parses its language.",
    "",
    `Roots: ${roots.map((root) => `\`${root}\``).join(", ")}. ${files.length} files, ${total} declarations` +
      `${silent > 0 ? `, ${silent} file(s) with nothing recognised` : ""}.`,
    "",
  ];

  let directory = null;
  for (const file of files) {
    const parent = dirname(file.path);
    if (parent !== directory) {
      directory = parent;
      lines.push(`## ${parent}`, "");
    }
    lines.push(`### ${file.path}`, "");
    if (file.declarations.length === 0) {
      lines.push("- _no declaration recognised by pattern_", "");
      continue;
    }
    for (const entry of file.declarations) {
      lines.push(`- \`${entry.name}\` — ${entry.kind}${entry.doc ? ` — ${entry.doc}` : ""}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Generates the project map, or checks that the rendered one still matches.
 *
 * The failure this guards against is not a missing map, it is an EMPTY one. A
 * generator written for another stack walks a tree it does not recognise,
 * produces a near-empty document, and `--check` then compares empty with
 * empty and exits 0. The result is a green gate asserting nothing, worse than
 * no gate since checking stops. Hence the two refusals below: no file found,
 * and not a single declaration recognised.
 *
 * Usage: node project-map.mjs [--check]
 */
function main() {
  const checkMode = process.argv.includes("--check");
  const config = loadConfig();
  const settings = config.project_map ?? {};
  if (!Array.isArray(settings.roots) || settings.roots.length === 0) {
    fail("project_map.roots missing: name the directories to map. The framework does not guess them.");
  }
  const out = typeof settings.out === "string" ? settings.out : "docs/project-map.md";
  const extensions = Array.isArray(settings.extensions) ? settings.extensions : DEFAULT_EXTENSIONS;
  const skip = typeof settings.skip === "string" ? new RegExp(settings.skip) : null;

  const files = [];
  for (const root of settings.roots) {
    for (const path of walk(root, skip)) {
      if (!extensions.some((extension) => path.endsWith(extension))) continue;
      files.push({ path: relative(".", path).split(sep).join("/"), declarations: declarationsIn(readFileSync(path, "utf8")) });
    }
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  if (files.length === 0) {
    fail(
      `no file to map under ${settings.roots.join(", ")} with extensions ${extensions.join(", ")}. ` +
        "An empty map passes every check while answering nothing: set project_map.extensions to this " +
        "project's source files, or point commands.project_map at a generator that knows them.",
    );
  }

  const total = files.reduce((sum, file) => sum + file.declarations.length, 0);
  if (total === 0) {
    fail(
      `${files.length} file(s) scanned and not one declaration recognised. This generator matches shapes, ` +
        "not syntax, and evidently not this project's. A map that names nothing answers no question, and " +
        "map-coverage would still pass it. Point commands.project_map at a generator for your language.",
    );
  }

  const rendered = render(files, settings.roots);
  const silent = files.filter((file) => file.declarations.length === 0).length;

  if (checkMode) {
    let current = null;
    try {
      current = readFileSync(out, "utf8");
    } catch {
      fail(`map not found: ${out}. Run project-map.mjs without --check.`);
    }
    if (current !== rendered) fail(`${out} is stale: it no longer matches the code. Regenerate it.`);
    console.log(`${out} is current: ${files.length} file(s), ${total} declaration(s).`);
    return;
  }

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, rendered);
  console.log(`written: ${out} (${files.length} file(s), ${total} declaration(s))`);
  if (silent > 0) {
    console.log(`  ${silent} file(s) with no recognised declaration — the map lists them and says so.`);
  }
}

if (process.argv[1]?.endsWith("project-map.mjs")) main();
