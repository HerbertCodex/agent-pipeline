import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
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
      secrets_scan: "true", project_map: "true", design_limits: "true", duplication: "true", smoke: "true",
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

describe("a page in French carries no sentence left in English", () => {
  /**
   * Words that mark English prose and never appear in French.
   *
   * Function words only. A content word could be a borrowing, a proper noun
   * or a technical term the French page keeps on purpose; a determiner or an
   * auxiliary cannot, so a hit here is a sentence somebody forgot to move
   * into the dictionary.
   */
  const ENGLISH = new RegExp(
    "(?<![-\\w])(" +
      ["the", "and", "with", "what", "your", "that", "this", "from", "does", "which", "when",
       "they", "their", "these", "were", "about", "before", "after", "every", "nothing",
       "instead", "because", "would", "could", "should", "between", "write", "written",
       "reads", "choice", "screen", "value", "order", "files for", "in short"].join("|") +
      ")\\b(?![-\\w])",
    "gi",
  );

  /**
   * Renders every page of a French project and returns what English survived.
   *
   * The styles are stripped: a CSS property is not prose, and keeping them
   * would make the gate refuse the stylesheet rather than the text.
   *
   * @returns one entry per page, with the English words found in it
   */
  function renderEverything() {
    const root = createSandbox();
    const configPath = join(root, "pipeline.config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.language = "fr";
    config.architecture = { id: "feature-sliced", project_type: "frontend" };
    config.design_system = {
      tokens: "src/tokens.css",
      primitives: "own",
      decided_at: "2026-08-19",
      direction: { genre: "editorial", because: "lecture longue" },
    };
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "tokens.css"), ":root {\n  --ink: #16161a;\n  --paper: #fffdf8;\n}\n");

    const proposal = join(root, "prop.json");
    writeFileSync(proposal, JSON.stringify({
      schema_version: 1,
      produced_at: "2026-08-21T09:00:00.000Z", mode: "spec_proposal", agent: "product", round: 1,
      scope: { spec_id: "s-1" }, scope_final: true,
      functional_scope: { intent: "publier un catalogue", features: [], out_of_scope: ["le paiement"] },
      decisions_for_operator: [],
    }));
    const assessment = join(root, "dep.json");
    writeFileSync(assessment, JSON.stringify({
      schema_version: 1,
      produced_at: "2026-08-21T09:00:00.000Z", mode: "dependency_assessment", agent: "product", scope: { issue_id: "i-1" },
      need: "valider des entrees", hand_rolled_cost: "trois jours",
      candidates: [{ name: "zod", version: "3", does: "valide", license: "MIT",
        weight: { transitive_dependencies: 0, install_size_kb: 200 },
        maintenance: { last_release: "2026-07", open_issues: 12, maintainers: 3 },
        security: { advisories_open: 0, runtime_privileges: ["aucun"], audited_on: "2026-08-01" } }],
      recommendation: { choice: "zod", why: "deja utilisee" },
      alternatives_rejected: [{ name: "joi", why: "plus lourde" }],
    }));
    const analysis = join(root, "analyse.json");
    writeFileSync(analysis, JSON.stringify({
      business_rules: [{ rule: "un livre deja sorti ne se preterse pas", why_it_matters: "double pret" }],
      validations: ["le titre est obligatoire"],
      integrations: [{ name: "postgres", replaceable: false }],
      concurrent_workers: "few",
      expected_churn: "screens",
    }));

    const pages = [
      ["render-architecture.mjs", ["a.html", "frontend"], "a.html"],
      ["render-architecture.mjs", ["b.html", "frontend", analysis], "b.html"],
      ["render-architecture.mjs", ["c.html", "fullstack"], "c.html"],
      ["render-design-system.mjs", ["ds.html", "frontend"], "ds.html"],
      ["render-decisions.mjs", ["d.html"], "d.html"],
      ["render-tokens.mjs", ["t.html"], "t.html"],
      ["render-proposal.mjs", [proposal, "pr.html"], "pr.html"],
      ["render-dependency.mjs", [assessment, "dep.html"], "dep.html"],
    ];

    const found = [];
    for (const [script, args, file] of pages) {
      const result = run(root, script, args);
      assert.equal(result.status, 0, `${script}: ${result.output}`);
      const html = readFileSync(join(root, file), "utf8")
        .replace(/<style[\s\S]*?<\/style>/g, "")
        .replace(/<script[\s\S]*?<\/script>/g, "");
      found.push({ script, words: [...new Set((html.match(ENGLISH) ?? []).map((w) => w.toLowerCase()))] });
    }
    destroySandbox(root);
    return found;
  }

  test("no renderer keeps a sentence hardcoded in English", () => {
    for (const { script, words } of renderEverything()) {
      assert.deepEqual(words, [], `${script} renders English on a French project`);
    }
  });

  test("the gate would see an English sentence, or it measures nothing", () => {
    const witness = "<p>The order is what decides, and nothing else.</p>";
    assert.notDeepEqual([...(witness.match(ENGLISH) ?? [])], []);
  });
});
