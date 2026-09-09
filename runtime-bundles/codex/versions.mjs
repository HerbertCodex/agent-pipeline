function versionTuple(value) {
  const match = value.match(/(?:^|\s|v)(\d+)\.(\d+)\.(\d+)(?:\b|$)/);
  return match ? match.slice(1).map(Number) : null;
}

function compare(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

export function withinRange(value, range) {
  const current = versionTuple(value);
  const minimum = versionTuple(range.min);
  const maximum = versionTuple(range.max_exclusive);
  if (!current || !minimum || !maximum) return false;
  return compare(current, minimum) >= 0 && compare(current, maximum) < 0;
}
