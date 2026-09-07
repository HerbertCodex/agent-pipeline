import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { execFileSync } from 'node:child_process';

/** Only successful steps on the exact requested commit can replace local gate execution. */
export function coveredGates(run, sha, commands) {
  if (run.headSha !== sha || run.conclusion !== 'success') return [];
  const steps = new Set((run.jobs ?? []).filter((job) => job.conclusion === 'success').flatMap((job) =>
    (job.steps ?? []).filter((step) => step.conclusion === 'success').map((step) => step.name)));
  return Object.keys(commands).filter((key) => steps.has(key.replaceAll('_', '-')) || steps.has(key));
}

/** Obtains fresh read-only CI evidence; missing access is an explicit local-replay fallback. */
export function ciEvidence(sha, config) {
  if (config.ci?.provider !== 'github' || !sha) return { status: 'not_configured', covered_gates: [] };
  const workflow = config.ci.workflow ?? 'ci.yml';
  const gh = (args) => JSON.parse(execFileSync('gh', args, { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] }));
  try {
    const previous = JSON.parse(execFileSync("git", ["show", `${sha}:pipeline.config.json`], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
    const workflowPath = workflow.includes("/") ? workflow : `.github/workflows/${workflow}`;
    const previousWorkflow = execFileSync("git", ["show", `${sha}:${workflowPath}`], { stdio: ["ignore", "pipe", "pipe"] });
    if (!isDeepStrictEqual(previous.commands, config.commands) || !previousWorkflow.equals(readFileSync(workflowPath))) {
      return { status: "policy_changed", covered_gates: [] };
    }
    const runs = gh(['run', 'list', '--commit', sha, '--workflow', workflow, '--status', 'success', '--limit', '10', '--json', 'databaseId,headSha']);
    for (const candidate of runs.filter((run) => run.headSha === sha)) {
      const run = gh(['run', 'view', String(candidate.databaseId), '--json', 'headSha,conclusion,url,jobs']);
      const covered = coveredGates(run, sha, config.commands);
      if (covered.length) return { status: 'verified', commit_sha: sha, workflow, url: run.url, checked_at: new Date().toISOString(), covered_gates: covered,
        commands: Object.fromEntries(covered.map((key) => [key, config.commands[key]])) };
    }
    return { status: 'no_matching_run', covered_gates: [] };
  } catch (error) { return { status: 'unavailable', covered_gates: [], reason: error.message }; }
}
