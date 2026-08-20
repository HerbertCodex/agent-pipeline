import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The source extensions a project is assumed to hold, absent a declaration.
 *
 * Shared by every gate that reads the source surface — the map, the dead
 * code sweep, the documentation contract. They must agree on what a source
 * file is, or each one measures a different tree and their verdicts stop
 * being comparable.
 */
export const DEFAULT_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".py", ".go", ".rs", ".rb", ".java", ".kt", ".php", ".cs", ".swift"];

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
export function walk(root, skip, found = []) {
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
 * Each carries whether the line actually publishes the name. The map wants
 * every declaration it can see; a dead-code sweep wants only the ones that
 * leave the file, and reading the same list for both reported every private
 * constant of every script as an orphaned export.
 *
 * @param body - file content
 * @returns the declarations found, in file order
 */
export function declarationsIn(body) {
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
      found.push({ name, kind, doc: docAbove(lines, index), exported: /^\s*(?:export|pub)\b/.test(line) });
      return;
    }
  });
  return found;
}

