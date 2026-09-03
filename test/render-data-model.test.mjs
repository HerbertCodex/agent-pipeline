import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createSandbox, destroySandbox, run, writeJson } from "./harness.mjs";

let sandbox = null;
afterEach(() => {
  if (sandbox != null) destroySandbox(sandbox);
  sandbox = null;
});

const MODEL = {
  title: "Library data model",
  entities: [
    { name: "books", fields: [{ name: "id", type: "uuid", primary_key: true, nullable: false }, { name: "title", type: "text", nullable: false }] },
    { name: "loans", fields: [{ name: "id", type: "uuid", primary_key: true }, { name: "book_id", type: "uuid", nullable: false }] },
  ],
  relations: [{ from: { entity: "loans", field: "book_id" }, to: { entity: "books", field: "id" }, cardinality: "many-to-one" }],
};

describe("render-data-model", () => {
  test("writes a self-contained UML-style diagram with keys and relations", () => {
    sandbox = createSandbox();
    const source = writeJson(sandbox, "diagram.json", MODEL);
    const target = join(sandbox, "model.html");
    const result = run(sandbox, "render-data-model.mjs", [source, target]);
    assert.equal(result.status, 0, result.output);
    const html = readFileSync(target, "utf8");
    assert.match(html, /Library data model/);
    assert.match(html, /books/);
    assert.match(html, /loans/);
    assert.match(html, /many-to-one/);
    assert.match(html, /uml-arrow/);
  });

  test("refuses a relation whose entity is not declared", () => {
    sandbox = createSandbox();
    const source = writeJson(sandbox, "invalid.json", { ...MODEL, relations: [{ from: { entity: "ghost", field: "id" }, to: { entity: "books", field: "id" } }] });
    const result = run(sandbox, "render-data-model.mjs", [source, join(sandbox, "model.html")]);
    assert.notEqual(result.status, 0);
  });

  test("escapes model text instead of inserting it as markup", () => {
    sandbox = createSandbox();
    const source = writeJson(sandbox, "safe.json", { ...MODEL, title: "<script>alert(1)</script>" });
    const target = join(sandbox, "safe.html");
    const result = run(sandbox, "render-data-model.mjs", [source, target]);
    assert.equal(result.status, 0, result.output);
    assert.match(readFileSync(target, "utf8"), /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  });
});
