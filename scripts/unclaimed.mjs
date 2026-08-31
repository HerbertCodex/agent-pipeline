import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig, readJsonl } from "./lib.mjs";

/**
 * Commits that touched the source and that the store never heard of.
 *
 * This exists because of the one rule the framework could not enforce on
 * itself. `CLAUDE.md` tells a session to ask, before starting, whether the
 * work goes through the pipeline or straight to the code — and nothing could
 * refuse a session that never asked. Observed on a real project: a whole
 * feature built directly, `issues.jsonl` at zero lines, and `next-step`
 * answering « no step to run: no open, actionable issue ». Which reads as
 * « nothing to do », when the truth was « this pipeline has never seen this
 * repository ».
 *
 * Direct work stays legitimate — a tooling fix, a question, an exploration.
 * What the framework refuses is direct work the operator never heard about,
 * so a commit whose message carries a `direct:` line is accounted for and
 * drops out of this list. Declaring it is the way through, not a loophole:
 * it puts the reason where a reviewer reads it.
 *
 * @param root - the repository to read
 * @param config - the project configuration, for the source roots
 * @param records - the issues in the store
 * @returns one entry per unclaimed commit, newest first
 */
export function unclaimed(root, config, records) {
  const roots = config?.project_map?.roots;
  if (!Array.isArray(roots) || roots.length === 0) return [];

  let log;
  try {
    log = execFileSync("git", ["log", "--format=%H%x1f%s%x1f%b%x1e", "--", ...roots], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    // Not a repository, or no history yet. Saying nothing is right: the
    // question this answers does not arise where there are no commits.
    return [];
  }

  // An issue records only its LAST commit, and an issue routinely produces
  // two — the red tests, then the implementation. Reading the sha alone
  // reported half of every pipeline issue as unclaimed, which is the kind of
  // noise that gets a report switched off. The message names the issue it
  // belongs to, by the convention every prompt already follows, and an issue
  // the store carries is an issue the pipeline planned.
  const claimed = new Set(
    records.map((record) => record.pipeline_state?.last_commit_sha).filter((sha) => typeof sha === "string"),
  );
  const known = new Set(records.map((record) => record.id));

  const namesKnownIssue = (subject) => [...known].some((id) => {
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^A-Za-z0-9._-])${escaped}(?=$|[^A-Za-z0-9._-])`).test(subject);
  });

  return log
    .split("\x1e")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const [sha, subject, body] = entry.split("\x1f");
      return { sha, subject, body: body ?? "" };
    })
    .filter((commit) => !claimed.has(commit.sha))
    .filter((commit) => !namesKnownIssue(commit.subject))
    .filter((commit) => !/^direct:/m.test(`${commit.subject}\n${commit.body}`));
}

/**
 * Reports the work the store never saw.
 *
 * Usage: node unclaimed.mjs [--json]
 */
function main() {
  const config = loadConfig();
  const records = readJsonl(join(config.store_dir, "issues.jsonl")).map((entry) => entry.record);
  const found = unclaimed(".", config, records);

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(found, null, 2));
    return;
  }

  if (found.length === 0) {
    console.log("every commit touching the source is claimed by an issue, or declares itself direct.");
    return;
  }

  console.log(`${found.length} commit(s) touching the source that no issue claims:\n`);
  for (const commit of found.slice(0, 20)) {
    console.log(`  ${commit.sha.slice(0, 8)}  ${commit.subject}`);
  }
  if (found.length > 20) console.log(`  … and ${found.length - 20} more`);
  console.log(
    "\nDirect work is legitimate — a tooling fix, a question, an exploration. Direct work the operator " +
      "never heard about is not. Put a `direct:` line in the commit message saying why, or let the " +
      "pipeline plan it.",
  );
}

if (process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href) main();
