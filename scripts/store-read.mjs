import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig, readJsonl, sha256, fail } from "./lib.mjs";

const ADDRESSEE = /^#+\s*Context for ([A-Za-z][A-Za-z -]*?)\s*(\(|$)/;

/**
 * Returns the role a context block addresses.
 *
 * The heading already carries its addressee: `## Context for QA`,
 * `## Context for Implementer (REGRESSION)`. A block naming none, such as a
 * closure proof, addresses nobody in particular.
 *
 * @param heading - Heading of the context block.
 * @returns The role in lowercase, or `null` when the block is unaddressed.
 */
function addresseeOf(heading) {
  const match = ADDRESSEE.exec(heading ?? "");
  return match == null ? null : match[1].trim().toLowerCase().replace(/\s+/g, "-");
}

/**
 * Reduces the contexts to what a role needs in order to work.
 *
 * Three cuts, in this order. Blocks addressed to another role do not travel:
 * they were never written for this one. Nor do unaddressed blocks, since a
 * closure proof is audit material rather than an instruction, and that was
 * half the weight on the heaviest issue measured. Finally, a repeated heading
 * replaces: only the last instruction is live, the earlier one is history.
 *
 * This is not summarising. A block that travels travels WHOLE: summarising
 * would make the reader fill the gaps, and filling is indistinguishable from
 * fabricating. Filtering by addressee touches no transmitted text.
 *
 * @param contexts - Blocks persisted on the record, oldest to newest.
 * @param role - Addressee role, in lowercase.
 * @returns The live blocks addressed to that role.
 */
export function contextsFor(contexts, role) {
  const latest = new Map();
  for (const block of contexts ?? []) {
    if (addresseeOf(block.heading) !== role) continue;
    latest.set(block.heading, block);
  }
  return [...latest.values()];
}

/**
 * Prints a store record with its optimistic-lock hash.
 *
 * `--for <role>` reduces the contexts to those addressed to that role. The
 * full record stays on disk: the audit trail is intact, only the reading is
 * bounded. The hash returned remains that of the whole line, so the
 * optimistic lock covers the real record rather than the view.
 *
 * Usage: node store-read.mjs <issue|spec> <id> [--for <role>]
 * JSON output: { id, record_hash, state_version, record }
 */
function main() {
  const args = process.argv.slice(2);
  const forIndex = args.indexOf("--for");
  const role = forIndex === -1 ? null : args[forIndex + 1]?.toLowerCase();
  const positional =
    forIndex === -1
      ? args
      : args.filter((_, index) => index !== forIndex && index !== forIndex + 1);
  const [kind, id] = positional;

  if (kind !== "issue" && kind !== "spec") fail("usage : store-read.mjs <issue|spec> <id> [--for <role>]");
  if (!id) fail("usage : store-read.mjs <issue|spec> <id> [--for <role>]");
  if (forIndex !== -1 && !role) fail("--for attend un role");

  const config = loadConfig();
  const path = join(config.store_dir, `${kind}s.jsonl`);
  const entry = readJsonl(path).find((e) => e.record.id === id);
  if (entry == null) fail(`record not found: ${id} in ${path}`);

  const record =
    role == null
      ? entry.record
      : { ...entry.record, contexts: contextsFor(entry.record.contexts, role) };

  const output = {
    id,
    record_hash: sha256(entry.raw),
    state_version: entry.record.pipeline_state?.version ?? null,
    record,
  };
  console.log(JSON.stringify(output, null, "\t"));
}

if (process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href) main();
