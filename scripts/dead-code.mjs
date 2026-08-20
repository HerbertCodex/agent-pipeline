import { readFileSync } from "node:fs";
import { relative, sep } from "node:path";
import { loadConfig, fail } from "./lib.mjs";
import { DEFAULT_EXTENSIONS, walk, declarationsIn } from "./surface.mjs";

/**
 * Refuses an export nothing in the project cites.
 *
 * An export kept "for later" is dead code with an excuse: nobody imports it,
 * nothing proves it, and it will be maintained by whoever assumes it counts.
 *
 * What this sweep does NOT see, and says so rather than implying otherwise:
 * a name reached through a string built at runtime, a module the framework
 * loads by convention, a re-export through an index. Entry points are
 * therefore exempted BY NAME, never guessed — guessing them would quietly
 * exempt whatever happened to look like one.
 *
 * The framework ships it so no project starts with no sweep at all. A
 * profile with a real tool for its language — one that resolves imports
 * instead of matching shapes — replaces it through `commands.dead_code`.
 *
 * Usage: node dead-code.mjs
 */
function main() {
  const config = loadConfig();
  const settings = config.dead_code ?? {};
  const roots = Array.isArray(settings.roots) ? settings.roots : config.project_map?.roots;
  if (!Array.isArray(roots) || roots.length === 0) {
    fail("dead_code.roots missing, and project_map.roots does not stand in: name the directories to sweep.");
  }
  const extensions = Array.isArray(settings.extensions)
    ? settings.extensions
    : (config.project_map?.extensions ?? DEFAULT_EXTENSIONS);
  const skipPattern = settings.skip ?? config.project_map?.skip;
  const skip = typeof skipPattern === "string" ? new RegExp(skipPattern) : null;
  const entry = new Set(Array.isArray(settings.entry) ? settings.entry : []);

  const files = [];
  for (const root of roots) {
    for (const path of walk(root, skip)) {
      if (!extensions.some((extension) => path.endsWith(extension))) continue;
      files.push({ path: relative(".", path).split(sep).join("/"), body: readFileSync(path, "utf8") });
    }
  }
  if (files.length === 0) {
    fail(`no file to sweep under ${roots.join(", ")} with extensions ${extensions.join(", ")}.`);
  }

  const declared = [];
  for (const file of files) {
    if (entry.has(file.path)) continue;
    for (const declaration of declarationsIn(file.body)) {
      // Only what leaves the file. A module-private constant is invisible
      // elsewhere by construction, and reporting it as an orphaned export
      // is how a sweep produces fifty findings and gets switched off.
      if (!declaration.exported) continue;
      declared.push({ ...declaration, path: file.path });
    }
  }
  if (declared.length === 0 && files.length > 0) {
    const total = files.reduce((sum, file) => sum + declarationsIn(file.body).length, 0);
    if (total === 0) {
      fail(
        `${files.length} file(s) swept and not one declaration recognised. This sweep matches shapes, not ` +
          "syntax, and evidently not this project's. A gate that reads nothing reports nothing and looks " +
          "exactly like a clean codebase. Point commands.dead_code at a tool that parses your language.",
      );
    }
  }

  const orphans = [];
  for (const declaration of declared) {
    const cited = files.some(
      (file) => file.path !== declaration.path && new RegExp(`(?<![\\w$])${declaration.name}(?![\\w$])`).test(file.body),
    );
    if (!cited) orphans.push(`${declaration.path}: ${declaration.name} (${declaration.kind})`);
  }

  if (orphans.length > 0) {
    console.error(`${orphans.length} export(s) nothing cites:`);
    for (const line of orphans) console.error(`  ${line}`);
    fail("Delete them, or cite them. An export kept for later is maintained by someone who assumes it counts.");
  }
  console.log(`dead-code: ${files.length} file(s), ${declared.length} export(s), none orphaned.`);
  console.log(
    "  Not seen: a name reached at runtime, a module loaded by convention, a re-export through an index.",
  );
}

main();
