import { mkdirSync, existsSync, cpSync, readdirSync, constants, lstatSync, realpathSync, readFileSync, rmSync } from 'node:fs';
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
    const there = execFileSync('git', ['show', `${sha}:${file}`], { cwd: root });
    const here = readFileSync(resolve(root, file));
    if (dependencyFingerprint(there) !== dependencyFingerprint(here)) {
      throw new Error(`Dependency input differs at target commit: ${file}; prepare matching dependencies before dispatch`);
    }
  }
  const configuredRoot = config.attempt_isolation?.root ?? join(config.handoffs_dir, 'worktrees');
  const directory = resolve(root, configuredRoot);
  if (!directory.startsWith(resolve(root) + sep)) throw new Error('Worktrees must stay inside the project root');
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

/**
 * Reduces a dependency input to what actually decides an install.
 *
 * Comparing the whole file made a build script a dependency change: an issue
 * that edits `scripts.build` could no longer replay its own red proof from its
 * own head, because the manifest at the test commit differed by that one line
 * while the lockfile and every dependency field were identical. Measured in a
 * host project on 2026-09-10, and worked around by hand in a detached tree.
 *
 * A manifest this cannot parse is compared whole, as before: refusing to read
 * a file is not a reason to stop checking it.
 *
 * @param contents - the file as committed or as it stands
 * @returns a stable string equal for two inputs that install the same thing
 */
function dependencyFingerprint(contents) {
  let manifest;
  try {
    manifest = JSON.parse(contents.toString('utf8'));
  } catch {
    return contents.toString('utf8');
  }
  if (manifest == null || typeof manifest !== 'object') return contents.toString('utf8');
  const deciding = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies', 'packageManager', 'engines', 'overrides', 'resolutions', 'pnpm'];
  return JSON.stringify(deciding.map((field) => [field, manifest[field] ?? null]));
}

/** Proves one attempt is inside an owned root and its branch is integrated. */
export function inspectWorkspace(workspace, branch, config, root = process.cwd()) {
  const directories = [
    resolve(root, config.attempt_isolation?.root ?? join(config.handoffs_dir, 'worktrees')),
    // Older releases ignored attempt_isolation.root and always wrote here.
    // Accept only that project-owned legacy root when reclaiming recorded runs.
    resolve(root, join(config.handoffs_dir, 'worktrees')),
  ];
  const target = resolve(workspace);
  const directory = directories.find((candidate) => target.startsWith(candidate + sep) && target !== candidate);
  if (!directory) throw new Error('Workspace cleanup target escapes the configured or legacy attempt root');
  if (branch && !/^agent\/[A-Za-z0-9._-]+$/.test(branch)) throw new Error(`Refusing unexpected attempt branch name: ${branch}`);
  let branchExists = false;
  if (branch) {
    try { git(root, 'show-ref', '--verify', `refs/heads/${branch}`); branchExists = true; } catch { /* already removed */ }
    if (branchExists) {
      try { git(root, 'merge-base', '--is-ancestor', `refs/heads/${branch}`, 'HEAD'); }
      catch { throw new Error(`Branch ${branch} is not integrated; inspect it before cleanup`); }
    }
  }
  const registered = git(root, 'worktree', 'list', '--porcelain').split('\n').some((line) => line === `worktree ${target}`);
  return { target, branchExists, registered, present: registered || branchExists || existsSync(target) };
}

/** Removes one completed, integrated attempt without following arbitrary paths. */
export function removeWorkspace(workspace, branch, config, root = process.cwd()) {
  const { target, branchExists, registered } = inspectWorkspace(workspace, branch, config, root);
  if (registered) git(root, 'worktree', 'remove', '--force', target);
  else if (existsSync(target)) rmSync(target, { recursive: true, force: true });
  if (branchExists) git(root, 'branch', '-d', branch);
}
