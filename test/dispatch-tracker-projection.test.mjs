import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dispatch = readFileSync(new URL('../scripts/dispatch.mjs', import.meta.url), 'utf8');

describe('a transition dispatch writes reaches the tracker before the package is built', () => {
  test('the transition and its projection are one step, in that order', () => {
    const move = dispatch.indexOf('store-update.mjs');
    const project = dispatch.indexOf('tracker-sync.mjs');
    const build = dispatch.indexOf('writeTaskPackage(issueId, role, config)');
    assert.ok(move > -1, 'dispatch writes the owed transition');
    assert.ok(project > -1, 'dispatch projects the new status to the tracker');
    assert.ok(move < project, 'the projection follows the write it projects');
    assert.ok(project < build, 'the projection precedes the package, which refuses a stale tracker status');
  });

  test('the projection applies rather than only reporting', () => {
    const call = dispatch.slice(dispatch.indexOf('tracker-sync.mjs'), dispatch.indexOf('tracker-sync.mjs') + 200);
    assert.match(call, /--apply/);
  });

  test('a dispatch that owes no transition projects nothing', () => {
    const body = dispatch.slice(dispatch.indexOf('function moveIntoPhase'));
    const guard = body.indexOf('if (owed == null) return;');
    assert.ok(guard > -1, 'the early return is kept');
    assert.ok(guard < body.indexOf('tracker-sync.mjs'), 'nothing is projected when no phase changed');
  });
});
