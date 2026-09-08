/** Deliberately small stable-version grammar: explicit inclusive/exclusive bounds. */
function version(value) {
  const match = /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value ?? "");
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}

function compare(left, right) {
  for (let index = 0; index < 3; index += 1) if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
  return 0;
}

export function inRange(value, range) {
  const actual = version(value);
  const minimum = version(range?.min);
  const maximum = version(range?.max_exclusive);
  return Boolean(actual && minimum && maximum && compare(actual, minimum) >= 0 && compare(actual, maximum) < 0);
}

export function validateManifest(manifest) {
  if (manifest?.schema_version !== 1 || typeof manifest.adapter !== "string" || !version(manifest.adapter_version)
    || !Array.isArray(manifest.supported) || manifest.supported.length === 0) throw new Error("Invalid adapter compatibility manifest");
  const runtimeDependencies = manifest.runtime_dependencies ?? [];
  if (!Array.isArray(runtimeDependencies)) throw new Error("Invalid runtime dependency contract");
  for (const dependency of runtimeDependencies) {
    if (typeof dependency.name !== "string" || !version(dependency.version)) throw new Error("Invalid runtime dependency");
    const min = version(dependency.node?.min);
    const max = version(dependency.node?.max_exclusive);
    if (!min || !max || compare(min, max) >= 0) throw new Error("Invalid runtime dependency range");
  }
  const ids = new Set();
  for (const entry of manifest.supported) {
    if (!/^[a-z0-9-]+$/.test(entry.id ?? "") || ids.has(entry.id) || typeof entry.manager !== "string"
      || !entry.packages || !Object.keys(entry.packages).length) throw new Error("Invalid compatibility manifest case");
    ids.add(entry.id);
    for (const range of [entry.node, entry.manager_version, ...Object.values(entry.packages)]) {
      const min = version(range?.min);
      const max = version(range?.max_exclusive);
      if (!min || !max || compare(min, max) >= 0) throw new Error("Invalid compatibility range");
    }
    if (!inRange(entry.reference?.node, entry.node) || !inRange(entry.reference?.manager_version, entry.manager_version)
      || !version(entry.reference?.cli) || typeof entry.evidence !== "string") throw new Error("Invalid compatibility manifest reference");
    for (const dependency of runtimeDependencies) {
      const supportedMin = version(entry.node.min);
      const supportedMax = version(entry.node.max_exclusive);
      const dependencyMin = version(dependency.node.min);
      const dependencyMax = version(dependency.node.max_exclusive);
      if (compare(supportedMin, dependencyMin) < 0 || compare(supportedMax, dependencyMax) > 0) {
        throw new Error(`Supported node range exceeds runtime dependency ${dependency.name}`);
      }
    }
  }
  return manifest;
}

/** Missing tools remain unknown; one known mismatch prevents admission for that case. */
export function assessCompatibility(manifest, installed) {
  validateManifest(manifest);
  const cases = manifest.supported.map((entry) => {
    const mismatches = [];
    const missing = [];
    const check = (key, actual, range) => {
      if (actual == null) missing.push(key);
      else if (!inRange(actual, range)) mismatches.push(`${key} ${actual}: expected >=${range.min} <${range.max_exclusive}`);
    };
    if (installed.manager !== entry.manager) mismatches.push(`package manager ${installed.manager}: expected ${entry.manager}`);
    for (const name of installed.required ?? []) if (!Object.hasOwn(entry.packages, name)) mismatches.push(`${name} is not covered by this case`);
    check("node", installed.node, entry.node);
    check("package manager version", installed.manager_version, entry.manager_version);
    for (const [name, range] of Object.entries(entry.packages)) check(name, installed.packages?.[name], range);
    return { id: entry.id, mismatches, missing };
  });
  const match = cases.find((entry) => !entry.mismatches.length && !entry.missing.length);
  return {
    status: match ? "compatible" : cases.some((entry) => !entry.mismatches.length) ? "unverified" : "unsupported",
    adapter_version: manifest.adapter_version, case: match?.id ?? null, installed, cases,
  };
}
