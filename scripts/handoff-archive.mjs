import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync, existsSync, lstatSync } from 'node:fs';
import { resolve, relative, dirname, join, sep } from 'node:path';

/** Reads a bounded handoff, including an archived pointer, only inside the configured directory. */
export function readHandoff(path, directory, root = process.cwd()) {
  const base = resolve(root, directory);
  const target = resolve(root, path);
  if (!target.startsWith(base + sep)) throw new Error('Handoff must be inside handoffs_dir');
  for (let at = target; at !== root && at !== dirname(at); at = dirname(at)) {
    if (existsSync(at) && lstatSync(at).isSymbolicLink()) throw new Error('Handoff symlinks are refused');
  }
  const text = readFileSync(target, 'utf8');
  if (Buffer.byteLength(text) > 2_000_000) throw new Error('Handoff exceeds 2 MB');
  return JSON.parse(text);
}

/** Stores immutable content; repeated identical writes refer to the same bytes. */
export function archiveHandoff(handoff, directory, root = process.cwd()) {
  const content = JSON.stringify(handoff, null, 2) + '\n';
  const digest = createHash('sha256').update(content).digest('hex');
  const path = join(directory, 'archive', digest + '.json');
  const target = resolve(root, path);
  for (let at = target; at !== dirname(at); at = dirname(at)) {
    if (existsSync(at) && lstatSync(at).isSymbolicLink()) throw new Error('Handoff symlinks are refused');
  }
  mkdirSync(dirname(target), { recursive: true });
  try { writeFileSync(target, content, { flag: 'wx' }); }
  catch (error) {
    if (error.code !== 'EEXIST' || readFileSync(target, 'utf8') !== content) throw error;
  }
  return { path: relative(root, target), sha256: digest };
}

/** Extracts the last complete handoff envelope without treating its contents as instructions. */
export function extractHandoff(output, directory, root = process.cwd()) {
  const start = output.lastIndexOf('AGENT_HANDOFF_START');
  const end = output.indexOf('AGENT_HANDOFF_END', start);
  if (start < 0 || end < 0) return null;
  const value = JSON.parse(output.slice(start + 'AGENT_HANDOFF_START'.length, end).trim());
  return value.handoff_file?.path ? readHandoff(value.handoff_file.path, directory, root) : value;
}
