import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig, readJsonl, fail } from "./lib.mjs";

/**
 * Builds the non-scheduling inbox of findings carried by issue records.
 *
 * Findings remain durable on the issue where they were observed, so there is
 * no second file to keep in sync and no write that can half-succeed. The inbox
 * is a view: entries have no phase, reserve no path and become work only when
 * an operator explicitly promotes one into a later spec.
 *
 * @param records - issue records
 * @param specId - optional spec filter
 * @param includeTriaged - include findings no longer parked
 * @returns stable list of inbox entries
 */
export function collectFindings(records, specId = null, includeTriaged = false) {
  return records
    .filter((record) => specId == null || record.spec_id === specId)
    .flatMap((record) =>
      (record.discoveries_declared ?? []).map((finding) => ({
        source_issue: record.id,
        spec_id: record.spec_id ?? null,
        title: finding.title,
        rationale: finding.rationale ?? null,
        lands: finding.lands ?? "parking",
        severity: finding.severity ?? "unspecified",
        status: finding.status ?? "parked",
        observed_at: finding.at ?? null,
      })),
    )
    .filter((finding) => includeTriaged || finding.status === "parked")
    .sort((a, b) =>
      String(a.observed_at ?? "").localeCompare(String(b.observed_at ?? "")) ||
      a.source_issue.localeCompare(b.source_issue) ||
      a.title.localeCompare(b.title),
    );
}

/**
 * Prints the findings inbox without creating or scheduling work.
 *
 * Usage: node findings.mjs [--spec <spec-id>] [--all] [--json]
 */
function main() {
  const args = process.argv.slice(2);
  const specIndex = args.indexOf("--spec");
  const specId = specIndex === -1 ? null : args[specIndex + 1];
  if (specIndex !== -1 && !specId) fail("usage: findings.mjs --spec <spec-id>");

  const config = loadConfig();
  const records = readJsonl(join(config.store_dir, "issues.jsonl")).map((entry) => entry.record);
  const findings = collectFindings(records, specId, args.includes("--all"));

  if (args.includes("--json")) {
    console.log(JSON.stringify({ findings, count: findings.length }, null, 2));
    return;
  }

  if (findings.length === 0) {
    console.log("findings inbox empty.");
    return;
  }

  console.log(`parked findings (${findings.length}) — recorded, not scheduled:`);
  for (const finding of findings) {
    console.log(`  ${finding.source_issue}  [${finding.severity}] ${finding.title}`);
  }
  console.log("\nPromote only after operator triage, normally into a later spec.");
}

if (process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href) main();
