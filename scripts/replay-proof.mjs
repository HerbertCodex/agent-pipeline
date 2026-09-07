import { mkdtempSync, cpSync, readFileSync, rmSync, existsSync, constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { loadConfig } from './lib.mjs';

/** Replays a command on a named commit in a disposable detached tree; mismatched dependency inputs refuse reuse. */
function main() {
  const [ref, executable, ...args] = process.argv.slice(2);
  if (!ref || !executable) throw new Error('usage: replay-proof.mjs <commit-sha> <executable> [arguments...]');
  if (!/^[a-f0-9]{7,40}$/i.test(ref)) throw new Error('Replay requires a literal commit SHA, not a moving branch');
  const root = process.cwd(); const config = loadConfig();
  const git = (...values) => execFileSync('git', values, { encoding: 'utf8' }).trim();
  const sha = git('rev-parse', '--verify', `${ref}^{commit}`);
  const seeds = config.agent_runtime?.workspace_paths ?? [];
  const inputs = config.agent_runtime?.dependency_inputs ?? [];
  if (seeds.length && !inputs.length) throw new Error('Declare dependency_inputs before reusing workspace dependencies in a replay');
  for (const file of inputs) {
    if (!execFileSync('git', ['show', `${sha}:${file}`]).equals(readFileSync(file))) throw new Error(`Dependency input differs at ${sha}: ${file}`);
  }
  const temporary = mkdtempSync(join(tmpdir(), 'pipeline-replay-')); const tree = join(temporary, 'tree');
  try {
    git('worktree', 'add', '--detach', tree, sha);
    for (const path of seeds) {
      const from = resolve(root, path); const to = resolve(tree, path);
      if (!from.startsWith(root + sep) || !to.startsWith(tree + sep)) throw new Error('Replay seed escapes repository');
      if (existsSync(from)) cpSync(from, to, { recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE });
    }
    const result = spawnSync(executable, args, { cwd: tree, stdio: 'inherit', timeout: 600000 });
    console.log(`Replay commit: ${sha}; exit: ${result.status ?? 1}`);
    process.exitCode = result.status ?? 1;
  } finally {
    try { git('worktree', 'remove', '--force', tree); } finally { rmSync(temporary, { recursive: true, force: true }); }
  }
}
try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
