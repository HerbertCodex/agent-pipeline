import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const transition = readFileSync(new URL('../scripts/transition.mjs', import.meta.url), 'utf8');

describe('the move a held phase owes reaches the tracker in the same step', () => {
  test('the write and its projection are one step, in that order', () => {
    const write = transition.indexOf('store-update.mjs');
    const project = transition.indexOf('tracker-sync.mjs');
    assert.ok(write > -1, 'the move writes the store');
    assert.ok(project > -1, 'the move projects the new status to the tracker');
    assert.ok(write < project, 'the projection follows the write it projects');
  });

  test('the projection applies rather than only reporting', () => {
    const call = transition.slice(transition.indexOf('tracker-sync.mjs'), transition.indexOf('tracker-sync.mjs') + 200);
    assert.match(call, /--apply/);
  });

  test('a project with no tracker is not asked to project one', () => {
    const guard = transition.indexOf('issue_tracker?.enabled');
    assert.ok(guard > -1, 'the projection is guarded by the tracker being enabled');
    assert.ok(guard < transition.indexOf('tracker-sync.mjs', guard), 'the guard precedes the call it guards');
  });

  test('a phase that owes nothing is refused before anything is written', () => {
    const refusal = transition.indexOf('owes no transition');
    const write = transition.indexOf('store-update.mjs');
    assert.ok(refusal > -1, 'a phase owing nothing is named as such');
    assert.ok(refusal < write, 'and refused before the store is touched');
  });
});
