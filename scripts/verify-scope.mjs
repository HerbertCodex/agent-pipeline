import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { loadRules, pathAllowed, fail } from "./lib.mjs";

/**
 * Confronte les fichiers declares d'un handoff au diff git reel.
 *
 * Signale les deux sens : un fichier modifie mais non declare, et un
 * fichier declare mais jamais touche. Applique la politique de
 * fichiers du role aux chemins constates, pas aux chemins declares.
 *
 * Usage : node verify-scope.mjs <handoff.json> <base-ref>
 */
function main() {
  const [handoffPath, baseRef] = process.argv.slice(2);
  if (!handoffPath || !baseRef) fail("usage : verify-scope.mjs <handoff.json> <base-ref>");
  const handoff = JSON.parse(readFileSync(handoffPath, "utf8"));
  const rules = loadRules();
  const sha = handoff.evidence?.commit_sha;
  if (!sha) fail("le handoff ne porte pas de commit_sha, rien a verifier");

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
    if (!declared.has(file)) errors.push(`modifie mais non declare : ${file}`);
    if (!pathAllowed(file, policy)) errors.push(`hors role ${handoff.agent} : ${file}`);
  }
  for (const file of declared) {
    if (!changed.includes(file)) errors.push(`declare mais jamais touche : ${file}`);
  }

  if (errors.length > 0) {
    for (const error of errors) console.error(`scope : ${error}`);
    process.exit(1);
  }
  console.log(
    `scope verifie : ${changed.length} fichier(s), ${baseRef}..${sha}, role ${handoff.agent}, ${new Date().toISOString()}`
  );
}

main();
