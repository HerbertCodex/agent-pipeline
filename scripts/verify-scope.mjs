import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { loadRules, pathAllowed, fail } from "./lib.mjs";

/**
 * Confronts a handoff's declared files with the real git diff.
 *
 * Reports both directions: a file modified but undeclared, and a file
 * declared but never touched. Applies the role's file policy to the observed
 * paths, not to the declared ones.
 *
 * Usage: node verify-scope.mjs <handoff.json> <base-ref>
 */
function main() {
  const [handoffPath, baseRef] = process.argv.slice(2);
  if (!handoffPath || !baseRef) fail("usage : verify-scope.mjs <handoff.json> <base-ref>");
  const handoff = JSON.parse(readFileSync(handoffPath, "utf8"));
  const rules = loadRules();
  const sha = handoff.evidence?.commit_sha;
  if (!sha) fail("the handoff carries no commit_sha, nothing to verify");

  let diff;
  try {
    diff = execFileSync("git", ["diff", "--name-only", `${baseRef}..${sha}`], { encoding: "utf8" });
  } catch (error) {
    fail(`git diff a echoue : ${error.message}`);
  }
  const changed = diff.split("\n").filter((line) => line.length > 0);
  const declared = new Set(handoff.evidence.files ?? []);
  const policy = rules.file_policy?.[handoff.agent];
  const errors = [];

  for (const file of changed) {
    if (!declared.has(file)) errors.push(`modified but undeclared: ${file}`);
    if (!pathAllowed(file, policy)) errors.push(`hors role ${handoff.agent} : ${file}`);
  }
  for (const file of declared) {
    if (!changed.includes(file)) errors.push(`declared but never touched: ${file}`);
  }

  if (errors.length > 0) {
    for (const error of errors) console.error(`scope : ${error}`);
    process.exit(1);
  }
  console.log(
    `scope verified: ${changed.length} file(s), ${baseRef}..${sha}, role ${handoff.agent}, ${new Date().toISOString()}`
  );
}

main();
