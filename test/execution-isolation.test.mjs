import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createSandbox, destroySandbox, issue } from './harness.mjs';
import { prepareWorkspace } from '../scripts/agent-workspace.mjs';
import { archiveHandoff, extractHandoff } from '../scripts/handoff-archive.mjs';
import { reservationFaults } from '../scripts/dispatch-preflight.mjs';

test('workspaces have separate source files, indexes and mutable seed directories', () => {
  const root = createSandbox();
  try {
    const config = JSON.parse(readFileSync(join(root, 'pipeline.config.json')));
    config.handoffs_dir = 'pipeline/handoffs'; config.agent_runtime = { workspace_paths: ['dependencies'], dependency_inputs: ['dependency-manifest.json'] };
    writeFileSync(join(root, 'pipeline.config.json'), JSON.stringify(config));
    writeFileSync(join(root, 'dependency-manifest.json'), '{}');
    writeFileSync(join(root, '.gitignore'), 'pipeline/handoffs/\ndependencies/\n');
    mkdirSync(join(root, 'src')); writeFileSync(join(root, 'src/a'), 'original');
    mkdirSync(join(root, 'dependencies')); writeFileSync(join(root, 'dependencies/cache'), 'original');
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
    git('init', '-q'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
    git('add', '.'); git('commit', '-qm', 'base');
    const task = { role: 'implementer', record: issue(), base_sha: git('rev-parse', 'HEAD') };
    const receipt = archiveHandoff({ result: 'review me' }, config.handoffs_dir, root);
    const one = prepareWorkspace({ ...task, attempt_id: 'first' }, config, root);
    const two = prepareWorkspace({ ...task, attempt_id: 'second' }, config, root);
    writeFileSync(join(one.path, 'src/a'), 'changed'); writeFileSync(join(one.path, 'dependencies/cache'), 'changed');
    execFileSync('git', ['add', 'src/a'], { cwd: one.path });
    assert.equal(readFileSync(join(two.path, 'src/a'), 'utf8'), 'original');
    assert.equal(readFileSync(join(root, 'dependencies/cache'), 'utf8'), 'original');
    assert.equal(execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: two.path, encoding: 'utf8' }), '');
    assert.notEqual(one.branch, two.branch);
    assert.equal(JSON.parse(readFileSync(join(two.path, receipt.path))).result, "review me");
  } finally { destroySandbox(root); }
});

test('archiving retries preserves the first handoff and rejects outside pointers', () => {
  const root = createSandbox();
  try {
    const first = archiveHandoff({ result: 'rejected' }, 'handoffs', root);
    const second = archiveHandoff({ result: 'accepted' }, 'handoffs', root);
    assert.notEqual(first.path, second.path);
    assert.equal(JSON.parse(readFileSync(join(root, first.path))).result, 'rejected');
    assert.ok(existsSync(join(root, second.path)));
    assert.throws(() => extractHandoff('AGENT_HANDOFF_START {"handoff_file":{"path":"pipeline.config.json"}} AGENT_HANDOFF_END', 'handoffs', root), /inside/);
  } finally { destroySandbox(root); }
});

test('pre-dispatch feasibility refuses forbidden reservations and admits covered ones', () => {
  const policy = { allow: ['src/**', 'tests/**'], deny: ['src/secrets/**'] };
  assert.deepEqual(reservationFaults(['src/feature/**', 'tests/unit.ts'], policy), []);
  assert.match(reservationFaults(['pipeline.config.json'], policy).join(), /outside/);
  assert.match(reservationFaults(['src/**'], policy).join(), /deny/);
});
