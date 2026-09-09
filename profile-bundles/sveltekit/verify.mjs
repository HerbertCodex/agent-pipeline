import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(here, 'compatibility.json'), 'utf8'));

function tuple(value) {
  const match = String(value).match(/^(\d+)\.(\d+)\.(\d+)(?:$|[-+])/);
  if (!match) throw new Error(`stable semantic version required, received ${value}`);
  return match.slice(1).map(Number);
}

function compare(left, right) {
  const a = tuple(left); const b = tuple(right);
  for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return a[index] - b[index];
  return 0;
}

function inRange(value, range) {
  return compare(value, range.min) >= 0 && compare(value, range.max_exclusive) < 0;
}

export function inspect(root = process.cwd()) {
  const packagePath = join(root, 'package.json');
  if (!existsSync(packagePath)) throw new Error('package.json not found');
  const project = JSON.parse(readFileSync(packagePath, 'utf8'));
  const installed = {};
  for (const name of Object.keys(manifest.supported[0].packages)) {
    const path = join(root, 'node_modules', name, 'package.json');
    if (!existsSync(path)) throw new Error(`installed package missing: ${name}`);
    installed[name] = JSON.parse(readFileSync(path, 'utf8')).version;
  }
  const managerVersion = execFileSync('npm', ['--version'], { cwd: root, encoding: 'utf8' }).trim();
  const commands = {
    check: project.scripts?.check,
    lint: project.scripts?.lint,
    build: project.scripts?.build,
    test_unit: project.scripts?.['test:unit'],
    test_e2e: project.scripts?.['test:e2e'],
  };
  return { node: process.version.slice(1), manager: 'npm', manager_version: managerVersion, packages: installed, commands };
}

export function compatible(observed, contract = manifest.supported[0]) {
  const reasons = [];
  if (!inRange(observed.node, contract.node)) reasons.push(`Node ${observed.node} outside ${contract.node.min}..<${contract.node.max_exclusive}`);
  if (observed.manager !== contract.manager || !inRange(observed.manager_version, contract.manager_version)) {
    reasons.push(`npm ${observed.manager_version} outside ${contract.manager_version.min}..<${contract.manager_version.max_exclusive}`);
  }
  for (const [name, range] of Object.entries(contract.packages)) {
    if (!inRange(observed.packages[name], range)) reasons.push(`${name} ${observed.packages[name]} outside ${range.min}..<${range.max_exclusive}`);
  }
  for (const [name, command] of Object.entries(observed.commands)) {
    if (typeof command !== 'string' || command.trim().length === 0) reasons.push(`missing executable script for ${name}`);
  }
  return { status: reasons.length === 0 ? 'compatible' : 'unsupported', case: contract.id, reasons, observed };
}

function main() {
  const report = compatible(inspect());
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== 'compatible') process.exitCode = 1;
}

if (process.argv[1] != null && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) main();
