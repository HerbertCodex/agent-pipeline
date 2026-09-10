import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createSandbox, destroySandbox, issue, state, recordHash, readRecord, run } from './harness.mjs';

const dispatch = readFileSync(new URL('../scripts/dispatch.mjs', import.meta.url), 'utf8');
const nextStep = readFileSync(new URL('../scripts/next-step.mjs', import.meta.url), 'utf8');

describe('dispatch refuses the transition it owes rather than writing it', () => {
  test('dispatch writes nothing to the store: the store is committed before a worktree starts from it', () => {
    assert.doesNotMatch(dispatch, /store-update\.mjs/);
    assert.doesNotMatch(dispatch, /tracker-sync\.mjs/);
    assert.doesNotMatch(dispatch, /moveIntoPhase/);
  });

  test('a phase the orchestrator holds stops the dispatch, naming the command that moves it', () => {
    const guard = dispatch.indexOf('dispatchTransition(record, role)');
    const build = dispatch.indexOf('writeTaskPackage(issueId, role, config)');
    assert.ok(guard > -1, 'dispatch asks whether a transition is owed');
    assert.ok(guard < build, 'and asks before it packages anything');
    const refusal = dispatch.slice(guard, build);
    assert.match(refusal, /throw new Error/);
    assert.match(refusal, /transition\.mjs/, 'the refusal names the command that moves the phase');
  });

  test('a move that owes nothing is refused by the mover, not silently applied', () => {
    const root = createSandbox({ issues: [issue({ pipeline_state: state({ phase: 'planned', owner: 'orchestrator' }) })] });
    try {
      const refused = run(root, 'transition.mjs', ['i-t1', 'qa']);
      assert.notEqual(refused.status, 0);
      assert.match(refused.output, /planned/);
    } finally { destroySandbox(root); }
  });
});

describe('the transition a held phase owes is a step of its own', () => {
  test('it moves the phase, its owner and its version, and stamps the step', () => {
    const initial = state({ phase: 'planned', owner: 'orchestrator' });
    const root = createSandbox({ issues: [issue({ pipeline_state: initial })] });
    try {
      const before = recordHash(root, 'issues', 'i-t1');
      const applied = run(root, 'transition.mjs', ['i-t1', 'implementer']);
      assert.equal(applied.status, 0, applied.output);
      const record = readRecord(root, 'issues', 'i-t1');
      assert.equal(record.pipeline_state.phase, 'in_progress');
      assert.equal(record.pipeline_state.owner, 'implementer');
      assert.equal(record.pipeline_state.version, initial.version + 1);
      assert.ok(record.pipeline_state.last_transition_at);
      assert.equal(record.transitions.at(-1).from, 'planned');
      assert.equal(record.transitions.at(-1).to, 'in_progress');
      assert.notEqual(recordHash(root, 'issues', 'i-t1'), before);
    } finally { destroySandbox(root); }
  });

  test('the handoff of an agent dispatched after it stays consumable', () => {
    const initial = state({ phase: 'planned', owner: 'orchestrator' });
    const root = createSandbox({ issues: [issue({ pipeline_state: initial })] });
    try {
      const configPath = join(root, 'pipeline.config.json');
      const config = JSON.parse(readFileSync(configPath));
      config.handoffs_dir = 'handoffs';
      writeFileSync(configPath, JSON.stringify(config));
      mkdirSync(join(root, 'handoffs'), { recursive: true });
      const moved = run(root, 'transition.mjs', ['i-t1', 'implementer']);
      assert.equal(moved.status, 0, moved.output);

      const packaged = recordHash(root, 'issues', 'i-t1');
      const version = readRecord(root, 'issues', 'i-t1').pipeline_state.version;
      const at = new Date().toISOString();
      const handoff = {
        schema_version: 1, attempt_id: 'attempt-one', produced_at: at, mode: 'issue_handoff', agent: 'implementer',
        scope: { issue_id: 'i-t1', spec_id: 's-t1' }, basis: { record_hash: packaged, pipeline_version: version },
        outcome: 'blocked_product', requested_transition: { from: 'in_progress', to: 'blocked_product' },
        context: { heading: '## Context for Product (SPEC UNCLEAR)', body: 'The approved contract needs clarification.' },
        evidence: { files: [], commands: [], commit_sha: null, notes: [] }, discoveries: [],
      };
      writeFileSync(join(root, 'handoffs/handoff.json'), JSON.stringify(handoff));
      const request = {
        target: { kind: 'issue', id: 'i-t1' }, expected_record_hash: packaged, handoff_path: 'handoffs/handoff.json',
        started_at: at, ended_at: at,
        pipeline_state: { ...readRecord(root, 'issues', 'i-t1').pipeline_state, phase: 'blocked_product', owner: 'product', version: version + 1, last_transition_at: new Date().toISOString() },
      };
      writeFileSync(join(root, 'consume.json'), JSON.stringify(request));
      const saved = run(root, 'store-update.mjs', ['consume.json']);
      assert.equal(saved.status, 0, saved.output);
      assert.equal(readRecord(root, 'issues', 'i-t1').handoffs.length, 1);
    } finally { destroySandbox(root); }
  });

  test('a phase an agent already holds is refused: a redispatch is not a transition', () => {
    const root = createSandbox({ issues: [issue({ pipeline_state: state({ phase: 'in_progress', owner: 'implementer' }) })] });
    try {
      const refused = run(root, 'transition.mjs', ['i-t1', 'implementer']);
      assert.notEqual(refused.status, 0);
      assert.match(refused.output, /owes no transition|nothing to move/i);
    } finally { destroySandbox(root); }
  });
});

describe('next-step prints the transition it says must come first', () => {
  test('the transition command is printed, and before the dispatch command', () => {
    const printed = [...nextStep.matchAll(/console\.log\(([^\n]*)/g)].map((match) => match[1]);
    const move = printed.findIndex((line) => line.includes('transition.mjs'));
    const send = printed.findIndex((line) => line.includes('interactive dispatch'));
    assert.ok(move > -1, 'next-step prints the command that moves a held phase');
    assert.ok(send > -1, 'next-step prints the dispatch');
    assert.ok(move < send, 'it prints the move before the dispatch it must precede');
  });

  test('a step that owes no transition names none', () => {
    const body = nextStep.slice(nextStep.indexOf('transition.mjs') - 600, nextStep.indexOf('transition.mjs'));
    assert.match(body, /step\.transition|owed|transition != null/);
  });
});
