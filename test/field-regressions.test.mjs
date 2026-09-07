import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createSandbox, destroySandbox, issue, run } from './harness.mjs';
import { contextsFor } from '../scripts/store-read.mjs';

test('scope rejects a declared allowed file outside issue reservations', () => {
  const root = createSandbox({ issues: [issue({ pipeline_state: { file_reservations: ['src/reserved.ts'] } })] });
  try {
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
    git('init', '-q'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
    mkdirSync(join(root, 'src')); writeFileSync(join(root, 'src/reserved.ts'), 'export const a = 1;');
    git('add', '.'); git('commit', '-qm', 'baseline'); const base = git('rev-parse', 'HEAD');
    writeFileSync(join(root, 'src/outside.ts'), 'export const b = 2;');
    git('add', '.'); git('commit', '-qm', 'outside');
    const handoff = { agent: 'implementer', scope: { issue_id: 'i-t1' }, evidence: { commit_sha: git('rev-parse', 'HEAD'), files: ['src/outside.ts'] } };
    writeFileSync(join(root, 'handoff.json'), JSON.stringify(handoff));
    const result = run(root, 'verify-scope.mjs', ['handoff.json', base]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /outside.*reservation/i);
  } finally { destroySandbox(root); }
});

test('context delivery does not silently erase another author under the same heading', () => {
  const blocks = [{ heading: '## Context for QA', body: 'Measured proof' }, { heading: '## Context for QA', body: 'Operator clarification' }];
  assert.deepEqual(contextsFor(blocks, 'qa'), blocks);
});

test('task packages preserve scope evidence and have immutable attempt identities', () => {
  const root = createSandbox({ issues: [issue({ contexts: [{ heading: '## verify-scope i-t1 base..sha', body: 'scope verified' }] })] });
  try {
    const path = join(root, 'pipeline.config.json'); const config = JSON.parse(readFileSync(path));
    config.handoffs_dir = 'pipeline/handoffs'; writeFileSync(path, JSON.stringify(config));
    const first = run(root, 'task-package.mjs', ['i-t1', 'qa']);
    assert.equal(first.status, 0, first.output);
    const second = run(root, 'task-package.mjs', ['i-t1', 'qa']);
    assert.notEqual(first.stdout, second.stdout);
    const pkg = JSON.parse(readFileSync(join(root, first.stdout.trim())));
    assert.equal(pkg.proofs.scope[0].body, 'scope verified');
    assert.ok(pkg.attempt_id);
  } finally { destroySandbox(root); }
});

test('architecture contracts refuse unplaced modules and ambiguous declarations', async () => {
  const { classifyModule } = await import('../scripts/architecture-contract.mjs');
  assert.equal(classifyModule('src/routes/[locale]/index.tsx', { routes: ['src/routes/**'] }), 'routes');
  assert.throws(() => classifyModule('src/utils/helper.ts', { shared: ['src/shared/**'] }), /Unclassified/);
  assert.throws(() => classifyModule('src/shared/a.ts', { shared: ['src/shared/**'], features: ['src/**'] }), /Ambiguous/);
});
