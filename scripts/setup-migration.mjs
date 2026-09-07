import { isDeepStrictEqual } from "node:util";

const absent = Symbol("absent");
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** Three-way merge: changed local values survive unless upstream changed the same value. */
export function mergeUpdate(base, local, incoming) {
  const conflicts = [];
  function merge(before, current, next, path) {
    if (isDeepStrictEqual(current, before)) return next;
    if (isDeepStrictEqual(next, before) || isDeepStrictEqual(current, next)) return current;
    if (object(before) && object(current) && object(next)) {
      const result = {};
      for (const key of new Set([...Object.keys(before), ...Object.keys(current), ...Object.keys(next)])) {
        const value = merge(Object.hasOwn(before, key) ? before[key] : absent, Object.hasOwn(current, key) ? current[key] : absent,
          Object.hasOwn(next, key) ? next[key] : absent, path ? `${path}.${key}` : key);
        if (value !== absent) Object.defineProperty(result, key, { value, enumerable: true, writable: true, configurable: true });
      }
      return result;
    }
    conflicts.push(path);
    return current;
  }
  const result = merge(base, local, incoming, "");
  return { ...result, conflicts };
}
