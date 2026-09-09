import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { withinRange } from './versions.mjs';

const [role, packagePathArgument] = process.argv.slice(2);
const roles = new Set(['implementer', 'product', 'qa', 'orchestrator']);

function refuse(message) {
  console.error(`codex-agent-adapter: ${message}`);
  process.exit(1);
}

function gitPath(...args) {
  return execFileSync('git', args, {
    cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function isInside(parent, child) {
  const path = relative(parent, child);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

if (!roles.has(role)) refuse(`unsupported role: ${role ?? '(missing)'}`);
if (!packagePathArgument) refuse('task package path missing');
if (process.platform !== 'linux') refuse(`unsupported platform: ${process.platform}`);
const compatibility = JSON.parse(readFileSync(new URL('./compatibility.json', import.meta.url), 'utf8'));
const contract = compatibility.supported[0];
if (!withinRange(process.version, contract.node)) refuse(`unsupported Node runtime: ${process.version}; use Node 22.23.2`);
let version;
try { version = execFileSync('codex', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
catch (error) { refuse(`could not inspect Codex CLI: ${error.message}`); }
if (!withinRange(version, contract.codex_cli)) refuse(`unsupported ${version}; see runtime-bundles/codex/compatibility.json`);

const packagePath = realpathSync(resolve(packagePathArgument));
const workspace = realpathSync(process.cwd());
if (!isInside(workspace, packagePath)) refuse('task package escapes the isolated workspace');

const task = JSON.parse(readFileSync(packagePath, 'utf8'));
if (task.role !== role) refuse('task package role does not match the dispatched role');
if (task.workspace?.path !== workspace) refuse('task package does not name the active workspace');
if (!/^[0-9a-f-]{36}$/.test(task.attempt_id ?? '')) refuse('invalid attempt id');

const gitDirectory = realpathSync(gitPath('rev-parse', '--absolute-git-dir'));
const commonDirectory = realpathSync(gitPath('rev-parse', '--path-format=absolute', '--git-common-dir'));
const expectedGitDirectory = resolve(commonDirectory, 'worktrees', task.attempt_id);
if (gitDirectory !== expectedGitDirectory) refuse('Git metadata does not belong to this attempt');

const gitRoots = [
  gitDirectory,
  resolve(commonDirectory, 'objects'),
  resolve(commonDirectory, 'refs', 'heads', 'agent'),
  resolve(commonDirectory, 'logs', 'refs', 'heads', 'agent'),
];
if (gitRoots.some((path) => !existsSync(path))) refuse('required isolated Git metadata path missing');

const workspaceRoots = `{ ${gitRoots.map((path) => `${JSON.stringify(path)} = true`).join(', ')} }`;
const sandboxConfig = [
  '--config', 'default_permissions="pipeline-localhost"',
  '--config', 'features.network_proxy=true',
  '--config', 'permissions.pipeline-localhost.extends=":workspace"',
  '--config', `permissions.pipeline-localhost.workspace_roots=${workspaceRoots}`,
  '--config', 'permissions.pipeline-localhost.network.enabled=true',
  '--config', 'permissions.pipeline-localhost.network.allow_local_binding=true',
  '--config', 'permissions.pipeline-localhost.network.domains={ localhost = "allow", "127.0.0.1" = "allow" }',
];

for (const [name, command] of Object.entries(task.runtime_prerequisites ?? {})) {
  if (!Array.isArray(command) || command.length === 0 || command.some((part) => typeof part !== 'string')) {
    refuse(`invalid runtime prerequisite ${name}`);
  }
  console.log(JSON.stringify({ type: 'runtime_prerequisite_started', attempt_id: task.attempt_id, name, command }));
  const result = spawnSync('codex', [
    'sandbox', '--permission-profile', 'pipeline-localhost', '--include-managed-config',
    '-C', workspace, ...sandboxConfig, '--', ...command,
  ], {
    cwd: workspace,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) refuse(`runtime prerequisite ${name} could not start in the Codex sandbox: ${result.error.message}`);
  if (result.signal) refuse(`runtime prerequisite ${name} ended on signal ${result.signal}`);
  if (result.status !== 0) refuse(`runtime prerequisite ${name} failed in the Codex sandbox with exit ${result.status ?? 1}`);
  console.log(JSON.stringify({ type: 'runtime_prerequisite_passed', attempt_id: task.attempt_id, name, exit_code: 0 }));
}

const args = [
  '--ask-for-approval', 'never',
  'exec', '--strict-config',
  ...sandboxConfig,
  '--ephemeral',
  `The adapter already machine-executed every declared runtime prerequisite in the Codex sandbox and stopped on failure. Read and execute the bounded task package at ${packagePath}. Respect the ${role} role and repository policy it names.`,
];

const child = spawn('codex', args, { env: process.env, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
child.once('error', (error) => refuse(`could not start Codex: ${error.message}`));
child.once('close', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
