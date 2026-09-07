import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { loadConfig, atomicWrite } from './lib.mjs';
import { gatesForIssue } from './gates.mjs';
import { ciEvidence } from './ci-evidence.mjs';
import { runStep } from './setup-runner.mjs';

/** Runs the owed battery once, retaining exact-SHA CI reuse and measured local timings. */
async function main() {
  const [packagePath, flag] = process.argv.slice(2);
  if (!packagePath || (flag && flag !== '--closure')) throw new Error('usage: run-gates.mjs <task-package.json> [--closure]');
  const task = JSON.parse(readFileSync(packagePath, 'utf8'));
  const config = loadConfig();
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
  const changed = [
    ...execFileSync('git', ['diff', '--name-only', '-z', 'HEAD', '--'], { encoding: 'utf8' }).split('\0'),
    ...execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0'),
  ].filter(Boolean);
  const control = [config.store_dir, config.handoffs_dir, config.issue_tracker?.root].filter(Boolean);
  if (changed.some((path) => !control.some((base) => path === base || path.startsWith(base + '/')))) {
    throw new Error('Commit source and policy changes before recording gate evidence');
  }
  const sha = git('rev-parse', 'HEAD');
  if (!task.base_sha) throw new Error('Task package has no base SHA');
  const paths = execFileSync('git', ['diff', '--name-only', '-z', '--no-renames', `${task.base_sha}..${sha}`, '--'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  const keys = flag === '--closure' ? Object.keys(config.commands) : gatesForIssue(paths, config);
  const ci = ciEvidence(sha, config);
  const report = { issue_id: task.record.id, attempt_id: task.attempt_id, commit_sha: sha, started_at: new Date().toISOString(), ci, gates: [], status: 'running' };
  const out = join(config.agent_runtime?.runs_dir ?? join(config.store_dir, 'runs'), 'gates', randomUUID() + '.json');
  try {
    for (const key of keys) {
      if (ci.covered_gates.includes(key)) { report.gates.push({ key, source: 'ci', url: ci.url, duration_ms: 0, code: 0 }); continue; }
      const result = await runStep(key, config.commands[key], [], { shell: true, timeoutMs: 600000 });
      report.gates.push({ ...result, key, source: 'local' });
      if (result.code !== 0 || result.timed_out || result.error) throw new Error(`Gate failed: ${key}`);
    }
    report.status = 'passed';
  } catch (error) { report.status = 'failed'; throw error; }
  finally { report.finished_at = new Date().toISOString(); atomicWrite(out, JSON.stringify(report, null, 2) + '\n'); console.log(`Gate evidence: ${out}`); }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
