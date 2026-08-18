import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { createSandbox, destroySandbox, run } from "./harness.mjs";

let sandbox = null;
afterEach(() => {
  if (sandbox != null) destroySandbox(sandbox);
  sandbox = null;
});

/**
 * Prepares a sandbox carrying sources and a `project_map` block.
 *
 * @param files - pairs of relative path and content
 * @param settings - settings to merge into project_map
 * @returns the sandbox root
 */
function withSources(files, settings = {}) {
  const root = createSandbox();
  const path = join(root, "pipeline.config.json");
  const config = JSON.parse(readFileSync(path, "utf8"));
  config.project_map = { out: "docs/map.md", roots: ["src"], ...settings };
  writeFileSync(path, JSON.stringify(config, null, 2));
  for (const [file, body] of Object.entries(files)) {
    const target = join(root, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, body);
  }
  return root;
}

/**
 * Generates the map and reads it back.
 *
 * @param root - sandbox root
 * @param args - arguments passed to the script
 * @returns the execution result and the map produced
 */
function generate(root, args = []) {
  const result = run(root, "project-map.mjs", args);
  let map = "";
  try {
    map = readFileSync(join(root, "docs", "map.md"), "utf8");
  } catch {
    map = "";
  }
  return { ...result, map };
}

describe("project-map: answering \"does this already exist?\" without knowing the language", () => {
  test("lists TypeScript exports with the first line of their documentation", () => {
    sandbox = withSources({
      "src/catalog/service.ts":
        "/**\n * Stores and reads books.\n */\nexport class CatalogService {}\n\n/**\n * Formats an ISBN.\n */\nexport function formatIsbn(raw: string): string {\n  return raw;\n}\n",
    });
    const { status, map } = generate(sandbox);
    assert.equal(status, 0);
    assert.match(map, /CatalogService/);
    assert.match(map, /formatIsbn/);
    assert.match(map, /Stores and reads books/);
  });

  test("reads a one-line documentation comment, the most common shape", () => {
    sandbox = withSources({ "src/ui/Card.tsx": "/** Frames any content. */\nexport function Card() {\n  return null;\n}\n" });
    const { map } = generate(sandbox);
    assert.match(map, /Frames any content/, "missing it leaves half the codebase undocumented in the map");
  });

  test("recognises a React component, which is where duplication hides", () => {
    sandbox = withSources({
      "src/ui/BookCard.tsx": "export default function BookCard() {\n  return null;\n}\n",
      "src/ui/hooks.ts": "export const useBooks = () => [];\n",
    });
    const { map } = generate(sandbox, []);
    assert.match(map, /BookCard/, "a component the map does not name is a component the next agent rewrites");
    assert.match(map, /useBooks/);
  });

  test("recognises Python, Go and Rust surfaces", () => {
    sandbox = withSources(
      {
        "src/loans.py": '"""Lends copies."""\n\n\ndef borrow(member, copy):\n    return None\n\n\nclass Ledger:\n    pass\n',
        "src/store.go": "package store\n\n// Save writes a book.\nfunc Save(b Book) error {\n\treturn nil\n}\n",
        "src/lib.rs": "/// Reads a book.\npub fn read_book(id: u32) -> Option<Book> {\n    None\n}\n",
      },
      { extensions: [".py", ".go", ".rs"] },
    );
    const { map } = generate(sandbox);
    for (const name of ["borrow", "Ledger", "Save", "read_book"]) {
      assert.match(map, new RegExp(name), `${name} is missing: the map covers a stack it claims to cover`);
    }
  });

  test("produces the same bytes for the same input, so --check means something", () => {
    const files = { "src/a.ts": "export const a = 1;\n", "src/b.ts": "export const b = 2;\n" };
    sandbox = withSources(files);
    const first = generate(sandbox).map;
    const second = generate(sandbox).map;
    assert.equal(first, second, "a generator that reorders itself makes every check a false alarm");
  });

  test("--check refuses a map that no longer matches the code", () => {
    sandbox = withSources({ "src/a.ts": "export const a = 1;\n" });
    generate(sandbox);
    writeFileSync(join(sandbox, "src", "b.ts"), "export const b = 2;\n");
    const result = run(sandbox, "project-map.mjs", ["--check"]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /stale|out of date/i);
  });

  test("--check writes nothing", () => {
    sandbox = withSources({ "src/a.ts": "export const a = 1;\n" });
    const result = run(sandbox, "project-map.mjs", ["--check"]);
    assert.notEqual(result.status, 0);
    assert.ok(!existsSync(join(sandbox, "docs", "map.md")), "a check that repairs is not a check");
  });

  test("honours the skip pattern", () => {
    sandbox = withSources(
      { "src/a.ts": "export const a = 1;\n", "src/generated/b.ts": "export const bGenerated = 2;\n" },
      { skip: "generated" },
    );
    const { map } = generate(sandbox);
    assert.doesNotMatch(map, /bGenerated/);
  });
});

describe("project-map: refusing to produce a map that covers nothing", () => {
  test("refuses when a root yields no file at all", () => {
    sandbox = withSources({ "src/a.ts": "export const a = 1;\n" }, { extensions: [".py"] });
    const { status, output } = generate(sandbox);
    assert.notEqual(status, 0);
    assert.match(output, /no file/i);
    assert.match(
      output,
      /extensions/i,
      "the refusal names the setting to fix, or the reader concludes the framework is broken",
    );
  });

  test("refuses when not a single declaration was recognised", () => {
    sandbox = withSources({ "src/data.ts": "// nothing but a comment\n", "src/more.ts": "const hidden = 1;\n" });
    const { status, output } = generate(sandbox);
    assert.notEqual(
      status,
      0,
      "a map listing files and naming nothing answers no question, and map-coverage would still pass it",
    );
    assert.match(output, /declaration/i);
  });

  test("says how many files carried nothing, because that is the honest limit", () => {
    sandbox = withSources({ "src/a.ts": "export const a = 1;\n", "src/opaque.ts": "const hidden = 2;\n" });
    const { status, output } = generate(sandbox);
    assert.equal(status, 0);
    assert.match(output, /1 file\(s\) with no recognised declaration/);
  });

  test("refuses a configuration that declares no root", () => {
    const root = createSandbox();
    const result = run(root, "project-map.mjs");
    assert.notEqual(result.status, 0);
    assert.match(result.output, /project_map\.roots/);
  });

  test("the map says what it does not see, rather than implying completeness", () => {
    sandbox = withSources({ "src/a.ts": "export const a = 1;\n" });
    const { map } = generate(sandbox);
    assert.match(map, /GENERATED/);
    assert.match(map, /pattern|does not parse|no parser/i, "a map that hides its method is trusted beyond its worth");
  });
});
