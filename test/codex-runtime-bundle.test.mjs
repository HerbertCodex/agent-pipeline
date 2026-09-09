import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { withinRange } from '../runtime-bundles/codex/versions.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'runtime-bundles', 'codex');
const contract = JSON.parse(readFileSync(join(root, 'compatibility.json'), 'utf8')).supported[0];

/**
 * Whether the Node running this suite is one the adapter agrees to start on.
 *
 * The adapter refuses any other Node before it looks at the task package, so
 * the sandbox behaviour below can only be measured inside the manifest, and
 * the refusal itself can only be measured outside it. Each of the two tests
 * skips on the runtime where it cannot measure anything, and says why; a host
 * on another Node no longer reads a red that describes its runtime, not the
 * framework.
 */
const nodeInsideManifest = withinRange(process.version, contract.node);
const nodeOutsideManifest = `Node ${process.version} is outside the Codex manifest; the adapter refuses to start`;
const nodeInsideManifestReason = `Node ${process.version} is inside the Codex manifest; the adapter does not refuse it`;

test('Codex runtime bundle is pinned to the locally validated contract', () => {
  const compatibility = JSON.parse(readFileSync(join(root, 'compatibility.json'), 'utf8'));
  assert.equal(compatibility.adapter, 'codex');
  assert.equal(compatibility.supported[0].node.min, '22.23.2');
  assert.equal(compatibility.supported[0].node.max_exclusive, '23.0.0');
  assert.equal(compatibility.supported[0].codex_cli.min, '0.153.4');
  assert.equal(compatibility.supported[0].codex_cli.max_exclusive, '0.154.0');
});

test('Codex runtime version bounds are executable rather than documentary', () => {
  const compatibility = JSON.parse(readFileSync(join(root, 'compatibility.json'), 'utf8'));
  const contract = compatibility.supported[0];
  assert.equal(withinRange('v22.23.1', contract.node), false);
  assert.equal(withinRange('v22.23.2', contract.node), true);
  assert.equal(withinRange('v22.99.0', contract.node), true);
  assert.equal(withinRange('v23.0.0', contract.node), false);
  assert.equal(withinRange('codex-cli 0.153.3', contract.codex_cli), false);
  assert.equal(withinRange('codex-cli 0.153.4', contract.codex_cli), true);
  assert.equal(withinRange('codex-cli 0.154.0', contract.codex_cli), false);
});

test('Codex runtime adapter preserves sandboxing and machine-enforces declared prerequisites first', () => {
  const source = readFileSync(join(root, 'adapter.mjs'), 'utf8');
  assert.match(source, /Object\.entries\(task\.runtime_prerequisites/);
  assert.match(source, /'sandbox', '--permission-profile', 'pipeline-localhost'/);
  assert.match(source, /runtime_prerequisite_passed/);
  assert.match(source, /result\.status !== 0/);
  assert.match(source, /network\.domains=.*localhost/);
  assert.match(source, /network\.allow_local_binding=true/);
  assert.doesNotMatch(source, /dangerously-bypass-approvals-and-sandbox/);
  assert.doesNotMatch(source, /danger-full-access/);
});

test('a failing Codex-sandbox prerequisite prevents the agent process from starting', { skip: !nodeInsideManifest && nodeOutsideManifest }, () => {
  const repository = mkdtempSync(join(tmpdir(), 'agent-pipeline-codex-'));
  try {
    const git = (...args) => execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim();
    git('init', '-q');
    git('config', 'user.name', 'Test');
    git('config', 'user.email', 'test@example.invalid');
    writeFileSync(join(repository, 'tracked'), 'base');
    git('add', 'tracked');
    git('commit', '-qm', 'base');

    const attempt = '12345678-1234-4123-8123-123456789abc';
    const workspace = join(repository, '.attempts', attempt);
    mkdirSync(dirname(workspace), { recursive: true });
    git('worktree', 'add', '-q', '-b', `agent/${attempt}`, workspace, 'HEAD');
    const packageDirectory = join(workspace, 'pipeline', 'handoffs');
    mkdirSync(packageDirectory, { recursive: true });
    const packagePath = join(packageDirectory, 'task.json');
    writeFileSync(packagePath, JSON.stringify({
      attempt_id: attempt,
      role: 'implementer',
      workspace: { path: workspace },
      runtime_prerequisites: { database: ['pg_isready', '-h', '127.0.0.1'] },
    }));

    const binaryDirectory = join(repository, 'bin');
    const log = join(repository, 'codex-calls.jsonl');
    mkdirSync(binaryDirectory);
    const fakeCodex = join(binaryDirectory, 'codex');
    writeFileSync(fakeCodex, `#!${process.execPath}\nimport { appendFileSync } from 'node:fs';\nconst args = process.argv.slice(2);\nappendFileSync(process.env.FAKE_CODEX_LOG, JSON.stringify(args) + '\\n');\nif (args[0] === '--version') { console.log('codex-cli 0.153.4'); process.exit(0); }\nif (args[0] === 'sandbox') process.exit(Number(process.env.FAKE_SANDBOX_EXIT ?? 0));\nprocess.exit(0);\n`);
    chmodSync(fakeCodex, 0o755);
    const environment = {
      ...process.env,
      PATH: `${binaryDirectory}:${process.env.PATH}`,
      FAKE_CODEX_LOG: log,
      FAKE_SANDBOX_EXIT: '7',
    };
    const adapter = join(root, 'adapter.mjs');
    const failed = spawnSync(process.execPath, [adapter, 'implementer', packagePath], {
      cwd: workspace, env: environment, encoding: 'utf8',
    });
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /database failed in the Codex sandbox with exit 7/);
    let calls = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
    assert.ok(calls.some((args) => args[0] === 'sandbox'));
    assert.equal(calls.some((args) => args.includes('exec')), false);

    writeFileSync(log, '');
    const passed = spawnSync(process.execPath, [adapter, 'implementer', packagePath], {
      cwd: workspace, env: { ...environment, FAKE_SANDBOX_EXIT: '0' }, encoding: 'utf8',
    });
    assert.equal(passed.status, 0, passed.stderr);
    calls = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
    assert.ok(calls.some((args) => args[0] === 'sandbox'));
    assert.ok(calls.some((args) => args.includes('exec')));
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test('the adapter refuses a Node outside its manifest before inspecting anything else', { skip: nodeInsideManifest && nodeInsideManifestReason }, () => {
  const repository = mkdtempSync(join(tmpdir(), 'agent-pipeline-codex-node-'));
  try {
    const packagePath = join(repository, 'task.json');
    writeFileSync(packagePath, JSON.stringify({ attempt_id: 'unused', role: 'implementer' }));
    const refused = spawnSync(process.execPath, [join(root, 'adapter.mjs'), 'implementer', packagePath], {
      cwd: repository, env: { ...process.env, PATH: '/nonexistent' }, encoding: 'utf8',
    });
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /unsupported Node runtime: v\d+\.\d+\.\d+; use Node 22\.23\.2/);
    assert.doesNotMatch(refused.stderr, /could not inspect Codex CLI/);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});
