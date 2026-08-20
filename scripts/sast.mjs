import { readFileSync } from "node:fs";
import { relative, sep } from "node:path";
import { loadConfig, fail } from "./lib.mjs";
import { DEFAULT_EXTENSIONS, walk } from "./surface.mjs";

/**
 * The shapes that carry an injection, whatever the surrounding language.
 *
 * Each one is a construction that turns data into code or into a command.
 * The list is short on purpose: a scanner that flags everything is a scanner
 * that gets switched off, and every entry here has a concrete exploit behind
 * it rather than a style preference.
 */
const DANGEROUS = [
  { why: "eval turns data into code", pattern: /(?<![\w$.])eval\s*\(/ },
  { why: "new Function compiles a string", pattern: /new\s+Function\s*\(/ },
  { why: "a command assembled from a value", pattern: /\b(?:exec|execSync|spawnSync|system|popen|shell_exec)\s*\(\s*[`"'][^`"')]*\$\{/ },
  { why: "a command assembled by concatenation", pattern: /\b(?:exec|execSync|system|popen|shell_exec)\s*\([^)]*\+\s*[A-Za-z_$]/ },
  { why: "markup injected as raw HTML", pattern: /\b(?:innerHTML|outerHTML|dangerouslySetInnerHTML)\s*[:=]/ },
  { why: "a query assembled from a value", pattern: /\b(?:query|execute)\s*\(\s*[`"'][^`"')]*(?:SELECT|INSERT|UPDATE|DELETE)[^`"')]*\$\{/i },
];

/**
 * Refuses the classic dangerous constructs in the source tree.
 *
 * It reads **patterns, not intentions**. It does not know your domain, so it
 * will never see an authorisation check that was never written, and it will
 * flag a construct that is safe in its context. Both are the same limit, and
 * the second is the price of the first.
 *
 * One shape is deliberately absent: `shell: true` alone. The command it
 * runs almost always comes from elsewhere in the file, so a line-by-line
 * scan cannot tell an interpolated command from a fixed one — and a rule
 * whose message claims more than its pattern checks is the kind of gate
 * this framework refuses. It is a documented blind spot, not an oversight.
 *
 * A finding is not automatically a defect: it is a line whose safety has to
 * be argued rather than assumed. Suppressing one is a gate change, therefore
 * human review — and it belongs in the committed configuration, where it is
 * read, not inline in the file it excuses.
 *
 * The framework ships it so no project starts with nothing. A profile with a
 * real analyser for its language replaces it through `commands.sast`.
 *
 * Usage: node sast.mjs
 */
function main() {
  const config = loadConfig();
  const settings = config.sast ?? {};
  const roots = Array.isArray(settings.roots) ? settings.roots : config.project_map?.roots;
  if (!Array.isArray(roots) || roots.length === 0) {
    fail("sast.roots missing, and project_map.roots does not stand in: name the directories to scan.");
  }
  const extensions = Array.isArray(settings.extensions)
    ? settings.extensions
    : (config.project_map?.extensions ?? DEFAULT_EXTENSIONS);
  const skipPattern = settings.skip ?? config.project_map?.skip;
  const skip = typeof skipPattern === "string" ? new RegExp(skipPattern) : null;
  const allowed = new Set(Array.isArray(settings.allow) ? settings.allow : []);

  const findings = [];
  let files = 0;

  for (const root of roots) {
    for (const path of walk(root, skip)) {
      if (!extensions.some((extension) => path.endsWith(extension))) continue;
      files += 1;
      const shown = relative(".", path).split(sep).join("/");
      readFileSync(path, "utf8").split("\n").forEach((line, index) => {
        if (line.includes("sast-allow")) return;
        for (const { why, pattern } of DANGEROUS) {
          if (!pattern.test(line)) continue;
          const place = `${shown}:${index + 1}`;
          if (allowed.has(place)) continue;
          findings.push(`${place}: ${why} — ${line.trim().slice(0, 100)}`);
        }
      });
    }
  }

  if (files === 0) fail(`no file to scan under ${roots.join(", ")} with extensions ${extensions.join(", ")}.`);

  if (findings.length > 0) {
    console.error(`${findings.length} dangerous construct(s):`);
    for (const line of findings) console.error(`  ${line}`);
    fail(
      "Each one is a line whose safety has to be argued, not assumed. A suppression belongs in " +
        "sast.allow in the committed configuration, with its reason, never inline in the file it excuses.",
    );
  }
  console.log(`sast: ${files} file(s) scanned, no dangerous construct.`);
  console.log("  It reads patterns, not intentions: it cannot see an authorisation check that was never written.");
}

main();
