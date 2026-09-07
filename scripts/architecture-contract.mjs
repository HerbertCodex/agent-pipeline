import { matchAny } from './lib.mjs';

/** Classifies an extracted module exactly once; stack adapters still own import extraction. */
export function classifyModule(path, layers) {
  const matches = Object.entries(layers).filter(([, patterns]) => matchAny(path, patterns)).map(([name]) => name);
  if (matches.length === 0) throw new Error(`Unclassified source module: ${path}`);
  if (matches.length > 1) throw new Error(`Ambiguous architecture layer for ${path}: ${matches.join(', ')}`);
  return matches[0];
}
