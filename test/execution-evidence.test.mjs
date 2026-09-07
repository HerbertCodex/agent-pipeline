import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSandbox, destroySandbox } from './harness.mjs';
import { executionHistory } from '../scripts/execution-metrics.mjs';
import { coveredGates } from '../scripts/ci-evidence.mjs';

test('CI reuse excludes different commits, skipped steps and failed jobs', () => {
  const run = { headSha: 'abc', conclusion: 'success', jobs: [{ conclusion: 'success', steps: [{ name: 'test-unit', conclusion: 'success' }, { name: 'lint', conclusion: 'skipped' }] }] };
  assert.deepEqual(coveredGates(run, 'abc', { test_unit: 'test command', lint: 'lint command' }), ['test_unit']);
  assert.deepEqual(coveredGates(run, 'def', { test_unit: 'test command' }), []);
  assert.deepEqual(coveredGates({ ...run, conclusion: 'failure' }, 'abc', { test_unit: 'test command' }), []);
});

test('durable execution metrics survive readers and never revive interrupted history', () => {
  const root = createSandbox();
  try {
    mkdirSync(join(root, 'runs'));
    writeFileSync(join(root, 'runs/one.json'), JSON.stringify({ run_id: 'one', issue_id: 'i-one', role: 'qa', elapsed_ms: 120000, started_at: '2026-09-01T00:00:00Z', ended_at: '2026-09-01T00:02:00Z', status: 'completed' }));
    writeFileSync(join(root, 'runs/two.json'), JSON.stringify({ run_id: 'two', issue_id: 'i-one', role: 'implementer', started_at: '2026-09-01T00:03:00Z', status: 'running' }));
    const config = { agent_runtime: { runs_dir: 'runs' } };
    const first = executionHistory(root, config);
    assert.deepEqual(first, executionHistory(root, config));
    assert.equal(first.find((run) => run.id === 'one').duration_ms, 120000);
    assert.equal(first.find((run) => run.id === 'two').status, 'incomplete');
    assert.equal(first.find((run) => run.id === 'two').interactive, false);
  } finally { destroySandbox(root); }
});
