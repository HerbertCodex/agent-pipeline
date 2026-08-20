import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const FRAMEWORK = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Figures that go stale the moment the thing they count changes.
 *
 * A test total is the clearest case: it moved 274 -> 319 -> 343 in a single
 * day's work, each time inside the paragraph asking the reader to verify the
 * framework rather than believe it. A figure nothing recomputes is an
 * assertion like any other, and this repository refuses those everywhere
 * else.
 *
 * What is allowed instead is the line that cannot drift: `fail 0` says
 * exactly what the reader needs and stays true whatever the total.
 */
const DRIFTING = [
  // The horizontal-whitespace classes are the point: `\s` spans newlines,
  // and a line ending in a number followed by a line starting with "test"
  // was read as a count. The first run reported a jscpd excerpt quoting
  // `test/catalog.e2e-spec.ts:22` as a claim about the suite's size.
  { what: "a test total", pattern: /(?:^|[ \t])(?:ℹ[ \t]*)?(?:pass|tests)[ \t]+\d{2,}/im },
  { what: "a count of tests", pattern: /\b\d{2,}[ \t]+tests?\b(?![ \t]*(?:pass|fail)\b)/i },
  { what: "a count of gates", pattern: /\b\d{1,3}[ \t]+(?:gates|portes)[ \t]+(?:green|vertes)/i },
];

/**
 * Lists the markdown documents the framework owns.
 *
 * @returns absolute paths of the framework's markdown files
 */
function documents() {
  const found = [];
  const readme = join(FRAMEWORK, "README.md");
  if (existsSync(readme)) found.push(readme);
  for (const directory of ["docs", "templates", "prompts"]) {
    const dir = join(FRAMEWORK, directory);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).filter((file) => file.endsWith(".md"))) {
      found.push(join(dir, name));
    }
  }
  return found;
}

describe("a document states no figure nothing recomputes", () => {
  test("no framework document carries a test total", () => {
    const offenders = [];
    for (const path of documents()) {
      const body = readFileSync(path, "utf8");
      for (const { what, pattern } of DRIFTING) {
        const hit = body.match(pattern);
        if (hit != null) offenders.push(`${path.slice(FRAMEWORK.length + 1)}: ${what} — "${hit[0].trim()}"`);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      "Write the line that cannot drift instead: `fail 0` says what the reader needs and stays true.",
    );
  });

  test("the detector would see the figure that drifted three times", () => {
    const witnesses = ["ℹ pass 319", "ℹ pass 274", "the suite carries 343 tests", "17 gates green"];
    for (const line of witnesses) {
      assert.ok(
        DRIFTING.some(({ pattern }) => pattern.test(line)),
        `not seen: ${line}`,
      );
    }
  });

  test("it does not fire on the line that stays true", () => {
    const allowed = [
      "ℹ fail 0",
      "node --test \"test/**/*.test.mjs\"",
      "run it once before trusting it",
      "11 lines repeated in 2 places:\n  test/catalog.e2e-spec.ts:22\n  test/health.e2e-spec.ts:19",
    ];
    for (const line of allowed) {
      assert.ok(
        !DRIFTING.some(({ pattern }) => pattern.test(line)),
        `refused what it should allow: ${line}`,
      );
    }
  });
});
