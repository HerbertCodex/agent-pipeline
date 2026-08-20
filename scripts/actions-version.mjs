import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fail } from "./lib.mjs";

/**
 * Refuses a CI action whose major version has been superseded upstream.
 *
 * The framework pins `actions/checkout` in its own template, so the drift it
 * creates is its own to police. Nothing checked those versions until a runner
 * deprecated one, and a human saw it before any tool did: the repository's
 * most expensive lesson says a rule no command can refuse never applies.
 *
 * It fails closed. An unreachable API is a refusal, stated as such, never a
 * pass: a gate that goes green without having checked is worse than a missing
 * one, because checking stops there and nobody knows.
 *
 * It knows no stack. It reads workflow files and asks the forge what it
 * published, which is true of a Go project as much as a Node one.
 *
 * Usage: node actions-version.mjs [workflow-dir]
 */
const DEFAULT_DIR = ".github/workflows";

/** Shape of an upstream action reference: owner, repository, major version. */
const UPSTREAM = /^([\w.-]+)\/([\w.-]+)@v(\d+)/;

/**
 * Returns every file under a directory, recursively.
 *
 * @param dir - directory to walk
 * @returns the paths found
 */
function walk(dir) {
  if (!existsSync(dir)) return [];
  let out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out = out.concat(walk(path));
    else out.push(path);
  }
  return out;
}

/**
 * Collects the upstream actions the workflows declare.
 *
 * Local and container actions carry no upstream version and are left out
 * rather than reported: naming them would teach the reader to skim.
 *
 * @param dir - directory holding the workflow files
 * @returns the declared major, keyed by owner/repository
 */
function declared(dir) {
  const found = new Map();
  for (const path of walk(dir)) {
    if (!/\.ya?ml$/.test(path)) continue;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const used = line.trim().match(/^-?\s*uses:\s*(\S+)/);
      const action = used?.[1]?.match(UPSTREAM);
      if (action != null) found.set(`${action[1]}/${action[2]}`, Number(action[3]));
    }
  }
  return found;
}

/**
 * Asks the forge for the latest major an action has published.
 *
 * @param name - action, as owner/repository
 * @returns the published major version
 * @throws {Error} when the API does not answer, or names no readable version
 */
async function publishedMajor(name) {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? "";
  const headers = { accept: "application/vnd.github+json", "user-agent": "actions-version-gate" };
  if (token !== "") headers.authorization = `Bearer ${token}`;
  const answer = await fetch(`https://api.github.com/repos/${name}/releases/latest`, { headers });
  if (!answer.ok) throw new Error(`${name}: GitHub API answered ${answer.status}`);
  const tag = (await answer.json()).tag_name ?? "";
  const major = tag.match(/^v?(\d+)/);
  if (major === null) throw new Error(`${name}: unreadable version (${tag})`);
  return Number(major[1]);
}

async function main() {
  const dir = process.argv[2] ?? DEFAULT_DIR;
  const actions = declared(dir);
  if (actions.size === 0) {
    fail(
      `no action found under ${dir}: this gate would assert nothing. ` +
        "Point it at the directory holding the workflows, or drop the key from commands.",
    );
  }
  const stale = [];
  for (const [name, major] of actions) {
    const latest = await publishedMajor(name);
    console.log(`  ${name}@v${major} — ${major < latest ? `superseded by v${latest}` : "current"}`);
    if (major < latest) stale.push(`${name}@v${major} -> v${latest}`);
  }
  if (stale.length > 0) {
    console.error(`\n${stale.length} action(s) superseded upstream:`);
    for (const line of stale) console.error(`  ${line}`);
    fail("A deprecated action is announced by the runner, then enforced by it. Raise them before that.");
  }
  console.log(`\n${actions.size} action(s) current.`);
}

main().catch((error) => {
  console.error(`check impossible: ${error.message}`);
  fail("The gate refuses rather than going green without having checked.");
});
