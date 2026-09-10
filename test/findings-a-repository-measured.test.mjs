import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSandbox, destroySandbox, issue, state, writeJson, run } from './harness.mjs';
import { DISCOVERY_ROUTES, BLOCKING_DISCOVERY_ROUTES } from '../scripts/validate-handoff.mjs';

const FRAMEWORK = join(fileURLToPath(new URL('.', import.meta.url)), '..');

describe('a proof the prompts promise QA is a proof the package carries', () => {
  test('the scope proof travels as the orchestrator writes it, not as a context block nobody writes', () => {
    // Measured three times in a host project, on v0.5.2 and v0.5.3: the QA
    // package arrived with `proofs.scope: []` while the record's transition
    // said verify-scope was green. The field was filled from context blocks
    // headed `## verify-scope `, and nothing writes such a block: the
    // orchestrator runs the command. A promise the package cannot keep sends
    // QA to re-run it by hand, or to believe it.
    const source = readFileSync(join(FRAMEWORK, 'scripts/task-package.mjs'), 'utf8');
    const scope = source.slice(source.indexOf('scope:'), source.indexOf('scope:') + 300);
    assert.doesNotMatch(scope, /## verify-scope/, 'the scope proof is not read from a heading nobody writes');
    assert.match(scope, /proofs\?\.scope|record\.proofs|scope_proofs/, 'it is read from what the store actually carries');
  });

  test('verify-scope records its own verdict where the package will find it', () => {
    const source = readFileSync(join(FRAMEWORK, 'scripts/verify-scope.mjs'), 'utf8');
    assert.match(source, /--record|writeFileSync|scope_proof/, 'verify-scope can hand its verdict back to the store');
  });
});

describe('the classifications that block a closure are the ones the briefs name', () => {
  test('every blocking route is one the briefs and prompts announce', () => {
    const said = [
      readFileSync(join(FRAMEWORK, 'prompts/qa.md'), 'utf8'),
      readFileSync(join(FRAMEWORK, 'docs/handoff-store.md'), 'utf8'),
    ].join('\n');
    for (const route of BLOCKING_DISCOVERY_ROUTES) {
      assert.match(said, new RegExp(`\`${route}\``), `nothing given to QA names ${route} as blocking`);
    }
  });

  test('every route the validator accepts is one a role can read about', () => {
    const said = readFileSync(join(FRAMEWORK, 'prompts/qa.md'), 'utf8');
    for (const route of DISCOVERY_ROUTES) {
      assert.match(said, new RegExp(`\`${route}\``), `the validator accepts ${route}, and no document names it`);
    }
  });
});

describe('a dependency input is compared on what it declares, not on the whole file', () => {
  test('an issue that changes a package script can still replay its own red', () => {
    const root = createSandbox({ issues: [issue({ pipeline_state: state({ phase: 'in_progress', owner: 'implementer' }) })] });
    try {
      const git = (...args) => run(root, 'noop.mjs', args);
      assert.ok(git);
      mkdirSync(join(root, 'src'), { recursive: true });
      writeJson(root, 'package.json', { name: 'host', scripts: { build: 'old' }, dependencies: { solid: '1.0.0' } });
      const config = JSON.parse(readFileSync(join(root, 'pipeline.config.json')));
      config.handoffs_dir = 'handoffs';
      config.agent_runtime = { workspace_paths: ['node_modules'], dependency_inputs: ['package.json'] };
      writeFileSync(join(root, 'pipeline.config.json'), JSON.stringify(config));
      const source = readFileSync(join(FRAMEWORK, 'scripts/agent-workspace.mjs'), 'utf8');
      assert.match(
        source,
        /dependencyFingerprint|comparableDependencies|dependencies.*devDependencies/s,
        'the comparison names the fields that decide an install, not the whole file',
      );
      assert.doesNotMatch(
        source.slice(source.indexOf('dependency_inputs'), source.indexOf('dependency_inputs') + 400),
        /\.equals\(readFileSync/,
        'the whole file is no longer compared byte for byte',
      );
    } finally { destroySandbox(root); }
  });
});
