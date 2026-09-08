import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { sanitizeControlSummary } from './security-testing.mjs';

/** Reads durable lifecycle records; incomplete historical runs are never shown as live children. */
export function executionHistory(root, config) {
  const directory = resolve(root, config.agent_runtime?.runs_dir ?? join(config.store_dir, 'runs'));
  if (!existsSync(directory)) return [];
  const records = [];
  for (const file of readdirSync(directory).filter((name) => name.endsWith('.json'))) {
    try {
      const run = JSON.parse(readFileSync(join(directory, file), 'utf8'));
      if (!run.run_id || !run.role) continue;
      const inferred = basename(run.package ?? '').match(/^(.*)-(?:implementer|qa|product|orchestrator)-(?:package|[a-f0-9-]+-package)\.json$/)?.[1];
      records.push({ id: run.run_id, runtime_run_id: run.run_id, issue_id: run.issue_id ?? inferred ?? 'unknown',
        issue_id_source: run.issue_id ? 'record' : inferred ? 'package_filename' : 'unknown', role: run.role,
        status: run.ended_at ? run.status : 'incomplete', started_at: run.started_at, updated_at: run.ended_at ?? run.started_at,
        finished_at: run.ended_at ?? run.started_at, elapsed_ms: run.elapsed_ms ?? 0, duration_ms: run.elapsed_ms ?? 0,
        exit_code: run.exit_code, output: 'Historical execution. Live output is not retained.', interactive: false,
        historical: true, run_record: join(directory, file), handoff: run.handoff ?? null });
    } catch { /* One interrupted file does not hide the remaining history. */ }
  }
  return records.sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)));
}

/** Reads measured gate reports separately from agent durations to avoid double counting. */
export function gateHistory(root, config) {
  const directory = resolve(root, config.agent_runtime?.runs_dir ?? join(config.store_dir, 'runs'), 'gates');
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter((name) => name.endsWith('.json')).flatMap((name) => {
    try { const report = JSON.parse(readFileSync(join(directory, name), 'utf8')); return Array.isArray(report.gates) ? [report] : []; }
    catch { return []; }
  });
}

/** Reads whitelisted DAST and load records for the local dashboard. */
export function controlEvidenceHistory(root, config) {
  const directories = [
    config.security_testing?.zap?.reports_dir,
    config.load_testing?.reports_dir,
  ].filter((value) => typeof value === 'string');
  const records = [];
  const visit = (directory) => {
    if (!existsSync(directory)) return;
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      try {
        if (statSync(path).isDirectory()) visit(path);
        else if (name === 'run.json') {
          const raw = JSON.parse(readFileSync(path, 'utf8'));
          if (!['zap', 'load'].includes(raw.kind)) continue;
          const record = Object.fromEntries([
            'kind', 'mode', 'status', 'target', 'authenticated', 'commit_sha', 'duration_ms',
            'started_at', 'finished_at', 'exit_code', 'reports', 'result_files', 'error',
          ].filter((key) => raw[key] !== undefined).map((key) => [key, raw[key]]));
          const summary = sanitizeControlSummary(raw.kind, raw.summary);
          if (summary != null) record.summary = summary;
          records.push(record);
        }
      } catch { /* One malformed or interrupted artifact does not hide its neighbours. */ }
    }
  };
  for (const directory of directories) visit(resolve(root, directory));
  return records.sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)));
}
