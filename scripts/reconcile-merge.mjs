import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, readJsonl, sha256, fail } from "./lib.mjs";

function option(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1] ?? null;
}

function run(script, args) {
  try {
    execFileSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), script), ...args], {
      cwd: process.cwd(),
      stdio: "inherit",
    });
  } catch {
    throw new Error(`${script} refused merge reconciliation`);
  }
}

function main() {
  const args = process.argv.slice(2);
  const specId = args[0];
  const mergeSha = option(args, "--sha");
  const mergedAt = option(args, "--merged-at");
  if (!specId || !mergeSha || !mergedAt) {
    fail("usage: reconcile-merge.mjs <spec-id> --sha <merge-commit> --merged-at <ISO-date>");
  }

  try {
    execFileSync("git", ["cat-file", "-e", `${mergeSha}^{commit}`], { stdio: "ignore" });
  } catch {
    fail(`merge commit ${mergeSha} is not present in the local repository; fetch it before recording the merge`);
  }

  const config = loadConfig();
  const entry = readJsonl(join(config.store_dir, "specs.jsonl"))
    .find((candidate) => candidate.record.id === specId);
  if (entry == null) fail(`spec not found: ${specId}`);
  if (entry.record.spec_state?.phase !== "pr_open") {
    fail(`${specId} is in ${entry.record.spec_state?.phase ?? "no phase"}; only a recorded pr_open spec can merge`);
  }

  run("store-verify.mjs", []);
  const temporary = mkdtempSync(join(tmpdir(), "agent-pipeline-merge-"));
  try {
    const request = join(temporary, "request.json");
    writeFileSync(request, JSON.stringify({
      target: { kind: "spec", id: specId },
      expected_record_hash: sha256(entry.raw),
      spec_state: { phase: "merged", merge_sha: mergeSha, merged_at: mergedAt },
      append_context: {
        heading: "## Merge",
        body: `Merged as ${mergeSha} at ${mergedAt}.`,
      },
    }));
    run("store-update.mjs", [request]);
    run("store-verify.mjs", []);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
