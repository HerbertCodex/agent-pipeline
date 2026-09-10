import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createSandbox, destroySandbox, issue, state, recordHash, readRecord, writeJson, run } from './harness.mjs';
import { dispatchTransition } from '../scripts/dispatch-preflight.mjs';

/**
 * Builds the handoff an agent produces from a task package.
 *
 * The basis is the package's own `record_hash`: that is exactly what an agent
 * reads, and reproducing it here is what makes the test measure the chain
 * rather than a hand-written value.
 *
 * @param packageRecordHash - the hash the task package carried
 * @param version - the state version the task package carried
 * @param from - the phase the handoff leaves
 * @param to - the phase the handoff enters
 * @returns a handoff accepted by validate-handoff
 */
function handoffFrom(packageRecordHash, version, from, to) {
  return {
    schema_version: 1, attempt_id: 'attempt-one', produced_at: new Date().toISOString(),
    mode: 'issue_handoff', agent: 'implementer', scope: { issue_id: 'i-t1', spec_id: 's-t1' },
    basis: { record_hash: packageRecordHash, pipeline_version: version },
    outcome: to, requested_transition: { from, to },
    context: { heading: '## Context for Product (SPEC UNCLEAR)', body: 'The approved contract needs clarification.' },
    evidence: { files: [], commands: [], commit_sha: null, notes: [] }, discoveries: [],
  };
}


/**
 * Declares a handoffs directory in the sandbox and creates it.
 *
 * `store-update` refuses a handoff pointer outside the configured directory,
 * and the harness writes no directory of its own.
 *
 * @param root - sandbox root
 */
function withHandoffsDir(root) {
  const path = join(root, 'pipeline.config.json');
  const config = JSON.parse(readFileSync(path));
  config.handoffs_dir = 'handoffs';
  writeFileSync(path, JSON.stringify(config));
  mkdirSync(join(root, 'handoffs'), { recursive: true });
}

describe('the orchestrator transitions before it dispatches', () => {
  test('a phase the orchestrator holds names the transition it owes before an agent may work', () => {
    assert.deepEqual(dispatchTransition(issue({ pipeline_state: state({ phase: 'planned', owner: 'orchestrator' }) }), 'implementer'),
      { phase: 'in_progress', owner: 'implementer' });
    assert.deepEqual(dispatchTransition(issue({ pipeline_state: state({ phase: 'ready_for_qa', owner: 'orchestrator' }) }), 'qa'),
      { phase: 'qa_in_progress', owner: 'qa' });
  });

  test('a phase an agent already holds owes nothing: a redispatch is not a transition', () => {
    assert.equal(dispatchTransition(issue({ pipeline_state: state({ phase: 'in_progress', owner: 'implementer' }) }), 'implementer'), null);
    assert.equal(dispatchTransition(issue({ pipeline_state: state({ phase: 'qa_in_progress', owner: 'qa' }) }), 'qa'), null);
    assert.equal(dispatchTransition(issue({ pipeline_state: state({ phase: 'blocked_product', owner: 'product' }) }), 'product'), null);
  });

  test('the handoff of an agent dispatched after the transition is consumable', () => {
    const initial = state({ phase: 'planned', owner: 'orchestrator' });
    const root = createSandbox({ issues: [issue({ pipeline_state: initial })] });
    try {
      const at = new Date().toISOString();
      withHandoffsDir(root);
      const owed = dispatchTransition(readRecord(root, 'issues', 'i-t1'), 'implementer');
      const moved = { ...initial, ...owed, version: initial.version + 1, last_transition_at: at };
      const first = writeJson(root, 'move.json', { target: { kind: 'issue', id: 'i-t1' }, expected_record_hash: recordHash(root, 'issues', 'i-t1'),
        pipeline_state: moved, started_at: at, ended_at: at, transition_reason: 'dispatch' });
      assert.equal(run(root, 'store-update.mjs', [first]).status, 0);

      const packageRecordHash = recordHash(root, 'issues', 'i-t1');
      const handoff = handoffFrom(packageRecordHash, moved.version, 'in_progress', 'blocked_product');
      const handoffPath = writeJson(root, 'handoffs/handoff.json', handoff);
      const second = writeJson(root, 'consume.json', { target: { kind: 'issue', id: 'i-t1' }, expected_record_hash: packageRecordHash,
        handoff_path: 'handoffs/handoff.json', started_at: at, ended_at: at,
        pipeline_state: { ...moved, phase: 'blocked_product', owner: 'product', version: moved.version + 1, last_transition_at: new Date().toISOString() } });
      assert.ok(handoffPath);
      const saved = run(root, 'store-update.mjs', [second]);
      assert.equal(saved.status, 0, saved.output);
      assert.equal(readRecord(root, 'issues', 'i-t1').handoffs.length, 1);
    } finally { destroySandbox(root); }
  });

  test('dispatching a planned issue without the transition strands its handoff', () => {
    const initial = state({ phase: 'planned', owner: 'orchestrator' });
    const root = createSandbox({ issues: [issue({ pipeline_state: initial })] });
    try {
      const at = new Date().toISOString();
      withHandoffsDir(root);
      const strandedBasis = recordHash(root, 'issues', 'i-t1');
      const handoff = handoffFrom(strandedBasis, initial.version, 'in_progress', 'blocked_product');
      writeJson(root, 'handoffs/handoff.json', handoff);
      const moved = { ...initial, phase: 'in_progress', owner: 'implementer', version: initial.version + 1, last_transition_at: at };
      const first = writeJson(root, 'move.json', { target: { kind: 'issue', id: 'i-t1' }, expected_record_hash: strandedBasis,
        pipeline_state: moved, started_at: at, ended_at: at, transition_reason: 'late' });
      assert.equal(run(root, 'store-update.mjs', [first]).status, 0);
      const second = writeJson(root, 'consume.json', { target: { kind: 'issue', id: 'i-t1' }, expected_record_hash: recordHash(root, 'issues', 'i-t1'),
        handoff_path: 'handoffs/handoff.json', started_at: at, ended_at: at,
        pipeline_state: { ...moved, phase: 'blocked_product', owner: 'product', version: moved.version + 1, last_transition_at: new Date().toISOString() } });
      const refused = run(root, 'store-update.mjs', [second]);
      assert.notEqual(refused.status, 0);
      assert.match(refused.output, /basis is stale/);
    } finally { destroySandbox(root); }
  });
});

describe('an attempt whose handoff can no longer be consumed is abandoned, not hidden', () => {
  test('the abandonment is recorded on the issue with its reason, and once only', () => {
    const initial = state({ phase: 'in_progress', owner: 'implementer' });
    const root = createSandbox({ issues: [issue({ pipeline_state: initial })] });
    try {
      const sha = 'a'.repeat(64);
      const request = { target: { kind: 'issue', id: 'i-t1' }, expected_record_hash: recordHash(root, 'issues', 'i-t1'),
        abandon_handoff: { sha256: sha, reason: 'Dispatched from planned; its basis can never match the record again.' } };
      const path = writeJson(root, 'abandon.json', request);
      const saved = run(root, 'store-update.mjs', [path]);
      assert.equal(saved.status, 0, saved.output);
      const entry = readRecord(root, 'issues', 'i-t1').handoffs.at(-1);
      assert.equal(entry.sha256, sha);
      assert.equal(entry.abandoned, true);
      assert.match(entry.reason, /can never match/);
      assert.ok(entry.at);

      const again = writeJson(root, 'again.json', { ...request, expected_record_hash: recordHash(root, 'issues', 'i-t1') });
      assert.notEqual(run(root, 'store-update.mjs', [again]).status, 0);
    } finally { destroySandbox(root); }
  });

  test('an abandonment without a stated reason is refused: silence is not a decision', () => {
    const root = createSandbox({ issues: [issue({ pipeline_state: state({ phase: 'in_progress', owner: 'implementer' }) })] });
    try {
      for (const abandon of [{ sha256: 'b'.repeat(64) }, { sha256: 'b'.repeat(64), reason: '  ' }, { sha256: 'not-a-digest', reason: 'x' }]) {
        const path = writeJson(root, 'abandon.json', { target: { kind: 'issue', id: 'i-t1' },
          expected_record_hash: recordHash(root, 'issues', 'i-t1'), abandon_handoff: abandon });
        assert.notEqual(run(root, 'store-update.mjs', [path]).status, 0, JSON.stringify(abandon));
      }
    } finally { destroySandbox(root); }
  });

  test('an abandoned handoff stops blocking the next dispatch', () => {
    const root = createSandbox({ issues: [issue({ pipeline_state: state({ phase: 'in_progress', owner: 'implementer' }) })] });
    try {
      const sha = 'c'.repeat(64);
      const config = JSON.parse(readFileSync(join(root, 'pipeline.config.json')));
      config.agent_runtime = { ...(config.agent_runtime ?? {}), runs_dir: 'runs' };
      writeFileSync(join(root, 'pipeline.config.json'), JSON.stringify(config));
      mkdirSync(join(root, 'runs'), { recursive: true });
      writeJson(root, 'runs/one.json', { issue_id: 'i-t1', handoff: { sha256: sha, path: 'handoffs/handoff.json' } });
      const blocked = readRecord(root, 'issues', 'i-t1');
      assert.throws(() => blockedBy(blocked, sha, root), /Consume the previous handoff|abandon/);
      const path = writeJson(root, 'abandon.json', { target: { kind: 'issue', id: 'i-t1' },
        expected_record_hash: recordHash(root, 'issues', 'i-t1'),
        abandon_handoff: { sha256: sha, reason: 'Stranded by a dispatch from planned.' } });
      assert.equal(run(root, 'store-update.mjs', [path]).status, 0);
      const after = readRecord(root, 'issues', 'i-t1');
      assert.equal(after.handoffs.some((item) => item.sha256 === sha), true);
    } finally { destroySandbox(root); }
  });
});

/**
 * Reproduces the preflight's unconsumed-handoff rule against one record.
 *
 * The full preflight reads generated policy and a git tree the sandbox does
 * not carry, so the rule under test is applied here on its own inputs.
 *
 * @param record - the issue record
 * @param sha256 - the digest a run reported
 * @param root - the sandbox root, kept for symmetry with the caller
 * @throws when the digest is neither consumed nor abandoned
 */
function blockedBy(record, sha256, root) {
  assert.ok(root);
  if (!(record.handoffs ?? []).some((entry) => entry.sha256 === sha256)) {
    throw new Error(`Consume the previous handoff with store-update.handoff_path before redispatch, or abandon it`);
  }
}
