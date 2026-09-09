import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createSandbox, destroySandbox, issue, run } from './harness.mjs';
import { inspectWorkspace, prepareWorkspace, removeWorkspace } from '../scripts/agent-workspace.mjs';
import { gateCiEvidence, ciGateReceipt } from '../scripts/run-gates.mjs';
import { runtimePrerequisites } from '../scripts/dispatch-preflight.mjs';

test('packaged exact-SHA CI evidence is reused without a second provider lookup', () => {
  let lookups = 0;
  const config = { commands: { check: 'project-check' } };
  const packaged = {
    status: 'verified', commit_sha: 'abc1234', covered_gates: ['check'],
    commands: { check: 'project-check' }, url: 'https://example.invalid/run/1',
  };
  const result = gateCiEvidence({ proofs: { ci: packaged } }, 'abc1234', config, () => { lookups += 1; });
  assert.equal(lookups, 0);
  assert.equal(result.source, 'task_package');
  assert.deepEqual(result.covered_gates, ['check']);
});

test('stale packaged CI evidence falls back to one provider lookup', () => {
  let lookups = 0;
  const result = gateCiEvidence(
    { proofs: { ci: { status: 'verified', commit_sha: 'old', covered_gates: ['check'], commands: { check: 'true' } } } },
    'new', { commands: { check: 'true' } },
    () => { lookups += 1; return { status: 'unavailable', covered_gates: [] }; },
  );
  assert.equal(lookups, 1);
  assert.equal(result.source, 'provider_lookup');
});

test('missing CI timing is recorded as unknown, never as zero', () => {
  assert.deepEqual(ciGateReceipt('check', { url: 'https://example.invalid/run/1' }), {
    key: 'check', source: 'ci', url: 'https://example.invalid/run/1',
    duration_ms: null, duration_status: 'not_imported', code: 0,
  });
  assert.equal(ciGateReceipt('check', { gate_evidence: { check: { duration_ms: 1250 } } }).duration_ms, 1250);
});

test('runtime prerequisites are packaged for machine execution by a capable adapter, not run on the host', () => {
  const commands = { unreachable: ['a-command-that-must-not-run'] };
  assert.deepEqual(runtimePrerequisites({ agent_runtime: { prerequisites_in_agent: true, prerequisite_commands: commands } }), commands);
  assert.throws(
    () => runtimePrerequisites({ agent_runtime: { prerequisite_commands: commands } }),
    /prerequisites_in_agent=true/,
  );
});

test('attempt isolation uses its declared root and cleanup removes an integrated attempt', () => {
  const root = createSandbox();
  try {
    const config = JSON.parse(readFileSync(join(root, 'pipeline.config.json')));
    config.handoffs_dir = 'pipeline/handoffs';
    config.attempt_isolation = {
      strategy: 'git-worktree', root: '.sudocode/worktrees',
      one_attempt_per_worktree: true, restore_before_replay: true,
    };
    writeFileSync(join(root, 'pipeline.config.json'), JSON.stringify(config));
    writeFileSync(join(root, '.gitignore'), '.sudocode/worktrees/\npipeline/handoffs/\n');
    mkdirSync(join(root, 'src')); writeFileSync(join(root, 'src/a'), 'original');
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
    git('init', '-q'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
    git('add', '.'); git('commit', '-qm', 'base');
    const task = { role: 'implementer', attempt_id: 'one', record: issue(), base_sha: git('rev-parse', 'HEAD') };
    const workspace = prepareWorkspace(task, config, root);
    assert.equal(workspace.path, join(root, '.sudocode/worktrees/one'));
    assert.equal(inspectWorkspace(workspace.path, workspace.branch, config, root).registered, true);
    removeWorkspace(workspace.path, workspace.branch, config, root);
    assert.equal(existsSync(workspace.path), false);
    assert.notEqual(spawnSync('git', ['show-ref', '--verify', `refs/heads/${workspace.branch}`], { cwd: root }).status, 0);
    assert.equal(inspectWorkspace(workspace.path, workspace.branch, config, root).present, false);

    const legacyConfig = structuredClone(config);
    legacyConfig.attempt_isolation.root = 'pipeline/handoffs/worktrees';
    const legacyTask = { role: 'implementer', attempt_id: 'legacy', record: issue(), base_sha: git('rev-parse', 'HEAD') };
    const legacyWorkspace = prepareWorkspace(legacyTask, legacyConfig, root);
    assert.equal(legacyWorkspace.path, join(root, 'pipeline/handoffs/worktrees/legacy'));
    removeWorkspace(legacyWorkspace.path, legacyWorkspace.branch, config, root);
    assert.equal(existsSync(legacyWorkspace.path), false);
  } finally { destroySandbox(root); }
});

test('cleanup retains an unmerged attempt and its branch', () => {
  const root = createSandbox();
  try {
    const config = JSON.parse(readFileSync(join(root, 'pipeline.config.json')));
    config.handoffs_dir = 'pipeline/handoffs';
    config.attempt_isolation = {
      strategy: 'git-worktree', root: '.attempts',
      one_attempt_per_worktree: true, restore_before_replay: true,
    };
    writeFileSync(join(root, 'pipeline.config.json'), JSON.stringify(config));
    writeFileSync(join(root, '.gitignore'), '.attempts/\npipeline/handoffs/\n');
    mkdirSync(join(root, 'src')); writeFileSync(join(root, 'src/a'), 'original');
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
    git('init', '-q'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
    git('add', '.'); git('commit', '-qm', 'base');
    const task = { role: 'implementer', attempt_id: 'unmerged', record: issue(), base_sha: git('rev-parse', 'HEAD') };
    const workspace = prepareWorkspace(task, config, root);
    writeFileSync(join(workspace.path, 'src/a'), 'changed');
    execFileSync('git', ['add', 'src/a'], { cwd: workspace.path });
    execFileSync('git', ['commit', '-qm', 'attempt'], { cwd: workspace.path });
    assert.throws(() => inspectWorkspace(workspace.path, workspace.branch, config, root), /not integrated/);
    assert.throws(() => removeWorkspace(workspace.path, workspace.branch, config, root), /not integrated/);
    assert.equal(existsSync(workspace.path), true);
    assert.ok(git('show-ref', '--verify', `refs/heads/${workspace.branch}`));
  } finally { destroySandbox(root); }
});

test('unsupported operational keys fail closed instead of being ignored', () => {
  const root = createSandbox();
  try {
    const path = join(root, 'pipeline.config.json');
    const config = JSON.parse(readFileSync(path));
    config.attempt_isolation = {
      strategy: 'git-worktree', root: '.attempts', one_attempt_per_worktree: true,
      restore_before_replay: true, imaginary_option: true,
    };
    writeFileSync(path, JSON.stringify(config));
    const result = run(root, 'status.mjs');
    assert.notEqual(result.status, 0);
    assert.match(result.output, /attempt_isolation.*unsupported key.*imaginary_option/);
  } finally { destroySandbox(root); }
});

test('evidence destinations must match the paths the core actually writes', () => {
  const root = createSandbox();
  try {
    const path = join(root, 'pipeline.config.json');
    const config = JSON.parse(readFileSync(path));
    config.handoffs_dir = 'pipeline/handoffs';
    config.agent_runtime = { runs_dir: 'pipeline/runs' };
    config.evidence_retention = {
      control_store: 'elsewhere', run_records: 'pipeline/runs', handoffs: 'pipeline/handoffs',
    };
    writeFileSync(path, JSON.stringify(config));
    const result = run(root, 'status.mjs');
    assert.notEqual(result.status, 0);
    assert.match(result.output, /evidence_retention\.control_store.*pipeline\/store/);
  } finally { destroySandbox(root); }
});
