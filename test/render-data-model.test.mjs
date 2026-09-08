import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

  test("refuses a relation whose endpoint field is not declared", () => {
    sandbox = createSandbox();
    const source = writeJson(sandbox, "invalid-field.json", { ...MODEL, relations: [{ from: { entity: "loans", field: "missing" }, to: { entity: "books", field: "id" } }] });
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

  test("renders normalization, access, audit and recovery from a v2 contract", () => {
    sandbox = createSandbox();
    const template = JSON.parse(readFileSync(new URL("../templates/data-model-governance.template.json", import.meta.url), "utf8"));
    writeFileSync(join(sandbox, "docs", "decisions", "0001-persistence.md"), "# Decision\n");
    writeFileSync(join(sandbox, "docs", "account-plan.txt"), "plan\n");
    template.contract.access_patterns[0].plan_evidence = "docs/account-plan.txt";
    const db = join(sandbox, "db");
    mkdirSync(db, { recursive: true });
    writeFileSync(join(db, "schema.sql"), "-- schema\n");
    const source = writeJson(sandbox, "contract.json", template.contract);
    const target = join(sandbox, "contract.html");
    const result = run(sandbox, "render-data-model.mjs", [source, target]);
    assert.equal(result.status, 0, result.output);
    const html = readFileSync(target, "utf8");
    assert.match(html, /target 3NF/);
    assert.match(html, /Access patterns/);
    assert.match(html, /Encrypted backups/);
  });
});
