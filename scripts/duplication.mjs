import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { loadConfig, sha256, fail } from "./lib.mjs";

/**
 * Default length of a block judged duplicated.
 *
 * Six significant lines: below that, two files that resemble each other are
 * mostly two files obeying the same conventions. A lower threshold does not
 * produce more findings, it produces noise people learn to ignore, and a gate
 * people ignore is already switched off.
 */
const DEFAULT_MIN_LINES = 6;

/**
 * Walks a root and returns its files, minus the ones skipped.
 *
 * @param root - starting directory
 * @param skip - rejection regular expression, or null
 * @param found - accumulator of retained paths
 * @returns the retained paths
 */
function walk(root, skip, found = []) {
  let entries;
  try {
    entries = readdirSync(root);
  } catch {
    return found;
  }
  for (const entry of entries) {
    const path = join(root, entry);
    if (skip != null && skip.test(path)) continue;
    if (statSync(path).isDirectory()) walk(path, skip, found);
    else found.push(path);
  }
  return found;
}

/**
 * Reduces a file to its significant lines, with indentation normalised.
 *
 * A paste is almost always reindented on arrival: the same block dropped into
 * a method gains four spaces. Comparing raw lines would miss it, and that is
 * the most frequent case.
 *
 * Comments are NOT stripped: removing them would mean knowing the language's
 * syntax, and this script knows none. A block copied along with its comment
 * therefore stays detected, which is the useful case.
 *
 * @param body - file content
 * @returns the normalised lines and their original numbers
 */
function significant(body) {
  const lines = [];
  body.split("\n").forEach((raw, index) => {
    const text = raw.trim().replace(/\s+/g, " ");
    if (text.length > 0) lines.push({ text, line: index + 1 });
  });
  return lines;
}

/**
 * Groups identical windows of `size` lines across every file.
 *
 * @param documents - normalised files
 * @param size - window height
 * @returns the groups of at least two occurrences, keyed by digest
 */
function windows(documents, size) {
  const groups = new Map();
  for (const document of documents) {
    for (let start = 0; start + size <= document.lines.length; start += 1) {
      const slice = document.lines.slice(start, start + size);
      const key = sha256(slice.map((entry) => entry.text).join("\n"));
      const at = { path: document.path, start, line: slice[0].line, end: slice[size - 1].line };
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(at);
    }
  }
  return [...groups.values()].filter((occurrences) => occurrences.length > 1);
}

/**
 * Merges the windows sliding over one and the same copy.
 *
 * A thirty-line copy produces twenty-five identical windows offset by one
 * line. Returning them all would give a wall nobody reads, and would make one
 * finding look like twenty-five. Only one occurrence per region is kept, the
 * longest one.
 *
 * @param groups - groups of identical windows
 * @param size - window height
 * @returns the clones, one entry per duplicated region
 */
function merge(groups, size) {
  const clones = [];
  const claimed = new Map();
  for (const occurrences of groups) {
    const fresh = occurrences.filter((at) => {
      const seen = claimed.get(at.path) ?? [];
      return !seen.some((range) => at.start >= range.from && at.start <= range.to);
    });
    if (fresh.length < 2) continue;
    let span = size;
    while (grows(occurrences, span)) span += 1;
    for (const at of occurrences) {
      const seen = claimed.get(at.path) ?? [];
      seen.push({ from: at.start, to: at.start + span - size });
      claimed.set(at.path, seen);
    }
    clones.push({ lines: span, sites: occurrences.map((at) => ({ path: at.path, line: at.line })) });
  }
  return clones;
}

/**
 * Says whether every occurrence extends by one identical line.
 *
 * @param occurrences - positions of the block
 * @param span - height reached
 * @returns true if the next line is the same everywhere
 */
function grows(occurrences, span) {
  const next = occurrences.map((at) => at.document.lines[at.start + span]?.text ?? null);
  return next[0] != null && next.every((text) => text === next[0]);
}

/**
 * Looks for duplicated blocks and returns a verdict.
 */
function main() {
  const asJson = process.argv.includes("--json");
  const config = loadConfig();
  const settings = config.duplication;
  if (settings?.roots == null || !Array.isArray(settings.roots) || settings.roots.length === 0) {
    fail(
      "duplication.roots missing: name the directories to scan. The framework does not guess them, " +
        "because a scan of the wrong tree is green for the wrong reason.",
    );
  }

  const size = Number.isInteger(settings.min_lines) ? settings.min_lines : DEFAULT_MIN_LINES;
  const skip = typeof settings.skip === "string" ? new RegExp(settings.skip) : null;
  const documents = [];
  for (const root of settings.roots) {
    for (const path of walk(root, skip)) {
      const lines = significant(readFileSync(path, "utf8"));
      if (lines.length >= size) documents.push({ path: relative(".", path), lines });
    }
  }
  if (documents.length === 0) {
    fail(`no file to scan under ${settings.roots.join(", ")}: an empty scan is a misconfiguration, not a clean result.`);
  }

  const groups = windows(documents, size).map((occurrences) =>
    occurrences.map((at) => ({ ...at, document: documents.find((document) => document.path === at.path) })),
  );
  const clones = merge(groups, size);

  if (asJson) {
    console.log(JSON.stringify({ files: documents.length, min_lines: size, clones }, null, 2));
    process.exit(clones.length === 0 ? 0 : 1);
  }

  if (clones.length === 0) {
    console.log(`duplication: ${documents.length} file(s) scanned, no block of ${size}+ lines repeated.`);
    return;
  }

  for (const clone of clones) {
    console.log(`${clone.lines} lines repeated in ${clone.sites.length} places:`);
    for (const site of clone.sites) console.log(`  ${site.path}:${site.line}`);
  }
  console.log("");
  console.log("Extract what repeats into one shared unit and reuse it, or say in the handoff why the");
  console.log("two copies must stay apart. This is the reuse note made checkable: until now it was");
  console.log("judged in review, which means it was judged when someone remembered to look.");
  process.exit(1);
}

if (process.argv[1]?.endsWith("duplication.mjs")) main();
