import { readFileSync, existsSync } from "node:fs";
import { loadConfig, matchAny, fail } from "./lib.mjs";

const WRITING_TOOLS = ["Edit", "Write", "NotebookEdit"];

/**
 * Returns the paths refused to each role, from `file_policy`.
 *
 * @param config - project configuration
 * @returns the refused globs per role, roles with no refusal excluded
 */
function denialsByRole(config) {
  const policy = config.file_policy ?? {};
  const out = new Map();
  for (const [role, rules] of Object.entries(policy)) {
    const deny = rules?.deny ?? [];
    if (deny.length > 0) out.set(role, [...deny].sort());
  }
  return out;
}

/**
 * Returns a path representative of a glob, to test its coverage.
 *
 * Comparing two globs by string equality is wrong: `**` covers
 * `.sudocode/**` without resembling it. So a concrete path the glob
 * designates is tested against the other role's patterns.
 *
 * @param glob - the pattern to represent
 * @returns a path that pattern designates
 */
function representative(glob) {
  return glob.replaceAll("**/", "x/").replaceAll("**", "x").replaceAll("*", "x").replaceAll("?", "x");
}

/**
 * Returns the paths NO role is allowed to write.
 *
 * A platform whose permissions are session-global cannot express "this role
 * may not write here, that one may". A path at least one role may write can
 * therefore not be refused globally without breaking that role.
 *
 * A role allows a path when its `allow` list covers it, or when its `deny`
 * list does not, or when it has no policy at all.
 *
 * @param config - project configuration
 * @param candidates - the globs to examine
 * @returns the globs refusable globally, sorted
 */
function universalDenials(config, candidates) {
  const policy = config.file_policy ?? {};

  return candidates
    .filter((glob) => {
      const path = representative(glob);
      return !Object.values(policy).some((rules) => {
        if (rules?.allow != null) return matchAny(path, rules.allow);
        if (rules?.deny != null) return !matchAny(path, rules.deny);
        return true;
      });
    })
    .sort();
}

/**
 * Renders the refusal rules in an agent platform's format.
 *
 * @param globs - the paths to refuse
 * @returns the `Tool(pattern)` rules
 */
function toRules(globs) {
  return globs.flatMap((glob) => WRITING_TOOLS.map((tool) => `${tool}(${glob})`));
}

/**
 * Checks that a settings file really refuses every expected path.
 *
 * @param path - settings file path
 * @param expected - the expected rules
 */
function check(path, expected) {
  if (expected.length === 0) {
    console.log(
      "NO rule derivable: every path refused to one role is allowed to another.\n" +
        "Session-global permissions cannot enforce this file_policy: the refusals\n" +
        "stay prompt instructions. This check therefore proves nothing here, and its success is\n" +
        "not a guarantee: it is the absence of one.",
    );
    return;
  }

  if (!existsSync(path)) fail(`not found: ${path}`);

  let settings;
  try {
    settings = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`${path} is not valid JSON : ${error.message}`);
  }

  const deny = settings.permissions?.deny ?? [];
  const missing = expected.filter((rule) => !deny.includes(rule));

  if (missing.length > 0) {
    console.error(`${path} does not refuse:`);
    for (const rule of missing) console.error(`  ${rule}`);
    fail(
      `${missing.length} missing rule(s). file_policy declares refusals the platform does not enforce: ` +
        `they are prompt instructions, not barriers.`,
    );
  }
  console.log(`${path} enforces the ${expected.length} rules derived from file_policy.`);
}

/**
 * Derives platform permissions from `file_policy`.
 *
 * `AGENTS.md` requires permissions to be enforced by the platform, and warns
 * that a prohibition written in a prompt is not a security boundary. Yet
 * nothing derived them: `file_policy` was injected into the machine rules and
 * repeated in the prompts, and stopped there.
 *
 * This script configures no platform; it knows none. It renders the policy
 * already declared in an enforceable form, and can check that a settings file
 * really carries it.
 *
 * Usage: node permissions.mjs [--format claude]
 *        node permissions.mjs --check <settings-file>
 */
function main() {
  const args = process.argv.slice(2);
  const config = loadConfig();
  const byRole = denialsByRole(config);

  if (byRole.size === 0) fail("file_policy declares no refusal: nothing to derive.");

  const candidates = [...new Set([...byRole.values()].flat())];
  const universal = universalDenials(config, candidates);
  const checkIndex = args.indexOf("--check");

  if (checkIndex !== -1) {
    const path = args[checkIndex + 1];
    if (!path) fail("usage: permissions.mjs --check <settings-file>");
    check(path, toRules(universal));
    return;
  }

  const formatIndex = args.indexOf("--format");
  const format = formatIndex === -1 ? "neutre" : args[formatIndex + 1];

  if (format === "claude") {
    console.log(JSON.stringify({ permissions: { deny: toRules(universal) } }, null, 2));
    return;
  }

  console.log("Refusals declared by file_policy, role by role:\n");
  for (const [role, globs] of byRole) {
    console.log(`  ${role}`);
    for (const glob of globs) console.log(`    ${glob}`);
  }

  console.log(`\nRefused to EVERY role, therefore expressible as a global permission (${universal.length}) :\n`);
  for (const glob of universal) console.log(`  ${glob}`);

  const partial = candidates.filter((glob) => !universal.includes(glob));
  if (partial.length > 0) {
    console.log(
      `\nRefuses a certain roles only (${new Set(partial).size}): a platform whose permissions\n` +
        `are session-global cannot enforce them without also blocking the allowed roles.\n` +
        `They remain the responsibility of a per-agent configuration, or stay mere instructions.\n`,
    );
    for (const glob of new Set(partial)) console.log(`  ${glob}`);
  }
}

main();
