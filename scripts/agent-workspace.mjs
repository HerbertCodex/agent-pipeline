import { mkdirSync, existsSync, cpSync, readdirSync, constants, lstatSync, realpathSync, readFileSync } from 'node:fs';
import { join, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** Creates a separate branch, index and output tree; retained for review and integration. */
export function prepareWorkspace(task, config, root = process.cwd()) {
  if (config.agent_runtime?.cwd) throw new Error('agent_runtime.cwd cannot bypass workspace isolation');
  if (git(root, 'status', '--porcelain', '--untracked-files=normal')) throw new Error('Commit or stash host changes before dispatch; worktrees start from a reviewed commit');
  const base = task.role === 'qa' ? task.record.pipeline_state?.last_commit_sha : task.base_sha;
  if (!base) throw new Error('Dispatch requires a committed base SHA');
  const sha = git(root, 'rev-parse', '--verify', `${base}^{commit}`);
  if (config.agent_runtime?.workspace_paths?.length && !config.agent_runtime?.dependency_inputs?.length) {
    throw new Error('Declare dependency_inputs before seeding workspace dependencies');
  }
  for (const file of config.agent_runtime?.dependency_inputs ?? []) {
    if (!execFileSync('git', ['show', `${sha}:${file}`], { cwd: root }).equals(readFileSync(resolve(root, file)))) {
      throw new Error(`Dependency input differs at target commit: ${file}; prepare matching dependencies before dispatch`);
    }
  }
  const directory = resolve(root, config.handoffs_dir, 'worktrees');
  if (!directory.startsWith(root + sep)) throw new Error('Worktrees must stay inside the configured host handoffs directory');
  for (let path = directory; path !== root; path = dirname(path)) {
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error('Workspace directory redirects through a symlink');
  }
  mkdirSync(directory, { recursive: true });
  const workspace = join(directory, task.attempt_id);
  const branch = `agent/${task.attempt_id}`;
  git(root, 'worktree', 'add', '-b', branch, workspace, sha);
  const copy = (path) => {
    if (!path) return;
    const source = resolve(root, path);
    if (!source.startsWith(root + sep)) throw new Error(`Workspace seed must be inside host: ${path}`);
    if (!existsSync(source)) return;
    if (lstatSync(source).isSymbolicLink() || !realpathSync(source).startsWith(root + sep)) throw new Error(`Workspace seed redirects outside host: ${path}`);
    const target = resolve(workspace, path);
    if (!target.startsWith(workspace + sep)) throw new Error(`Workspace target escapes: ${path}`);
    cpSync(source, target, { recursive: true, force: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE,
      filter: (from) => from !== directory && !from.startsWith(directory + sep) && !from.endsWith(sep + '.git') });
  };
  // Copy current control snapshots; agents still have no permission to write them.
  for (const path of ['pipeline.config.json', config.rules_path, config.store_dir, config.profiles_dir,
    config.prompts_dir, config.briefs_dir, config.skills_dir, config.project_context, config.issue_tracker?.root,
    join(config.handoffs_dir, "archive"),
    ...(config.agent_runtime?.workspace_paths ?? [])]) copy(path);
  const framework = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const destination = join(workspace, config.framework_dir ?? 'agent-pipeline');
  if (!destination.startsWith(workspace + sep)) throw new Error('framework_dir escapes workspace');
  // Keep a tracked framework at the target SHA; only seed installations absent from Git.
  if (!existsSync(join(destination, 'scripts', 'dispatch.mjs'))) {
    mkdirSync(destination, { recursive: true });
    for (const name of readdirSync(framework)) {
      if (['.git', 'node_modules'].includes(name)) continue;
      cpSync(join(framework, name), join(destination, name), { recursive: true, force: true });
    }
  }
  const packagePath = join(workspace, config.handoffs_dir, `${task.attempt_id}-package.json`);
  mkdirSync(dirname(packagePath), { recursive: true });
  task.workspace = { path: workspace, branch, base_sha: sha };
  task.base_sha = sha;
  return { path: workspace, branch, base_sha: sha, packagePath };
}
