import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createSandbox, destroySandbox, run } from "./harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PAGES = join(here, "..", "pages");

let sandbox = null;
afterEach(() => {
  if (sandbox != null) destroySandbox(sandbox);
  sandbox = null;
});

/**
 * Reads a shipped language file.
 *
 * @param code - the language code
 * @returns the parsed dictionary
 */
function dictionary(code) {
  return JSON.parse(readFileSync(join(PAGES, `${code}.json`), "utf8"));
}

/**
 * Flattens a nested dictionary into dotted keys.
 *
 * @param value - the value to walk
 * @param prefix - the accumulated key
 * @param found - accumulator
 * @returns the dotted keys
 */
function keysOf(value, prefix = "", found = []) {
  if (typeof value !== "object" || value === null) {
    found.push(prefix);
    return found;
  }
  for (const [name, child] of Object.entries(value)) {
    keysOf(child, prefix.length === 0 ? name : `${prefix}.${name}`, found);
  }
  return found;
}

describe("the pages speak the operator's language, and neither version drifts", () => {
  test("the framework ships at least English and French", () => {
    const shipped = readdirSync(PAGES).filter((f) => f.endsWith(".json")).sort();
    assert.deepEqual(shipped, ["en.json", "fr.json"]);
  });

  test("every key exists in both, because a missing one renders blank", () => {
    const english = new Set(keysOf(dictionary("en")));
    const french = new Set(keysOf(dictionary("fr")));
    const missingFr = [...english].filter((key) => !french.has(key));
    const missingEn = [...french].filter((key) => !english.has(key));
    assert.deepEqual(missingFr.slice(0, 8), [], "keys the French file does not carry");
    assert.deepEqual(missingEn.slice(0, 8), [], "keys the English file does not carry");
  });

  test("no value is left empty, which is how a half-done translation hides", () => {
    for (const code of ["en", "fr"]) {
      const empty = [];
      const walk = (value, prefix) => {
        if (typeof value === "string") {
          if (value.trim().length === 0) empty.push(prefix);
          return;
        }
        for (const [name, child] of Object.entries(value)) walk(child, `${prefix}.${name}`);
      };
      walk(dictionary(code), code);
      assert.deepEqual(empty, [], `${code} carries an empty string`);
    }
  });

  test("the French file is actually in French", () => {
    const french = JSON.stringify(dictionary("fr"));
    assert.match(french, /\b(le|la|les|une|des|qui|pour)\b/, "a copy of the English file passes every other check");
  });
});

describe("a project declares which language its pages are written in", () => {
  /**
   * Prepares a sandbox able to render an architecture page.
   *
   * @param language - value of the `language` key, or null to omit it
   * @returns the sandbox root
   */
  function withLanguage(language) {
    const root = createSandbox();
    const path = join(root, "pipeline.config.json");
    const config = JSON.parse(readFileSync(path, "utf8"));
    config.commands = {
      check: "true", lint: "true", build: "true", test_unit: "true", audit: "true",
      secrets_scan: "true", project_map: "true", design_limits: "true", duplication: "true",
    };
    config.architecture = { id: "feature-modules", project_type: "backend" };
    if (language != null) config.language = language;
    writeFileSync(path, JSON.stringify(config, null, 2));
    return root;
  }

  test("renders in French when the project says so", () => {
    sandbox = withLanguage("fr");
    const target = join(sandbox, "archi.html");
    const result = run(sandbox, "render-architecture.mjs", [target, "backend"]);
    assert.equal(result.status, 0, result.output);
    const html = readFileSync(target, "utf8");
    assert.match(html, /Service back-end|dossier par fonctionnalit/i);
  });

  test("renders in English when the project says so", () => {
    sandbox = withLanguage("en");
    const target = join(sandbox, "archi.html");
    run(sandbox, "render-architecture.mjs", [target, "backend"]);
    assert.match(readFileSync(target, "utf8"), /Back-end service|folder per feature/i);
  });

  test("falls back to English when the project says nothing", () => {
    sandbox = withLanguage(null);
    const target = join(sandbox, "archi.html");
    run(sandbox, "render-architecture.mjs", [target, "backend"]);
    assert.match(readFileSync(target, "utf8"), /Back-end service|folder per feature/i);
  });

  test("refuses a language the framework does not ship", () => {
    sandbox = withLanguage("de");
    const result = run(sandbox, "render-architecture.mjs", [join(sandbox, "a.html"), "backend"]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /de/);
    assert.match(result.output, /en, fr|available|ships/i, "the refusal names what exists, or the reader guesses");
  });

  test("apply-profile refuses a language with no file behind it", () => {
    sandbox = withLanguage("de");
    const result = run(sandbox, "apply-profile.mjs", ["--check"]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /language/);
  });
});
