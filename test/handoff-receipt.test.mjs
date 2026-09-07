import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSandbox, destroySandbox, issue, state, recordHash, readRecord, writeJson, run } from './harness.mjs';

test('a captured handoff is consumed with its transition and context exactly once', () => {
  const initial = state({ phase: 'in_progress', owner: 'implementer' });
  const root = createSandbox({ issues: [issue({ pipeline_state: initial })] });
  try {
    const configPath = join(root, 'pipeline.config.json'); const config = JSON.parse(readFileSync(configPath));
    config.handoffs_dir = 'handoffs';
    const at = new Date().toISOString();
    const handoff = { schema_version: 1, attempt_id: 'attempt-one', produced_at: at, mode: 'issue_handoff', agent: 'implementer',
      scope: { issue_id: 'i-t1', spec_id: 's-t1' }, basis: { record_hash: recordHash(root, 'issues', 'i-t1'), pipeline_version: initial.version },
      outcome: 'blocked_product', requested_transition: { from: 'in_progress', to: 'blocked_product' },
      context: { heading: '## Context for Product (SPEC UNCLEAR)', body: 'The approved contract needs clarification.' },
      evidence: { files: [], commands: [], commit_sha: null, notes: [] }, discoveries: [] };
    config.agent_runtime = { command: process.execPath, args: ['-e', `console.log('AGENT_HANDOFF_START'); console.log(${JSON.stringify(JSON.stringify(handoff))}); console.log('AGENT_HANDOFF_END')`], require_handoff: true };
    writeFileSync(configPath, JSON.stringify(config));
    const task = writeJson(root, 'task.json', { attempt_id: 'attempt-one', record: { id: 'i-t1' } });
    const result = run(root, 'agent-driver.mjs', ['implementer', task, '--json']);
    assert.equal(result.status, 0, result.output);
    const event = JSON.parse(result.stdout.trim().split('\n').at(-1));
    assert.ok(event.handoff.sha256);
    const request = { target: { kind: 'issue', id: 'i-t1' }, expected_record_hash: handoff.basis.record_hash,
      handoff_path: event.handoff.path, started_at: at, ended_at: at,
      pipeline_state: { ...initial, phase: 'blocked_product', owner: 'product', version: initial.version + 1, last_transition_at: new Date().toISOString() } };
    const path = writeJson(root, 'request.json', request);
    const saved = run(root, 'store-update.mjs', [path]);
    assert.equal(saved.status, 0, saved.output);
    const record = readRecord(root, 'issues', 'i-t1');
    assert.equal(record.handoffs[0].sha256, event.handoff.sha256);
    assert.equal(record.transitions.at(-1).handoff_sha256, event.handoff.sha256);
    assert.equal(record.contexts.at(-1).body, handoff.context.body);
    assert.notEqual(run(root, 'store-update.mjs', [path]).status, 0);
  } finally { destroySandbox(root); }
});
