import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createSandbox, destroySandbox, run } from "./harness.mjs";

let sandbox = null;
afterEach(() => {
  if (sandbox != null) destroySandbox(sandbox);
  sandbox = null;
});

/**
 * Runs the renderer in a project speaking the given language.
 *
 * @param args - arguments passed to the script
 * @param language - the language the project declares, or none
 * @returns the command's output
 */
function render(args, language = null) {
  sandbox = createSandbox();
  if (language != null) {
    const path = join(sandbox, "pipeline.config.json");
    const config = JSON.parse(readFileSync(path, "utf8"));
    config.language = language;
    writeFileSync(path, JSON.stringify(config, null, 2));
  }
  return run(sandbox, "render-architecture.mjs", args).output;
}

describe("the project type is a decision, so the command helps make it", () => {
  test("a missing type is answered with the four and what each one is", () => {
    // Four bare words for a choice that silently removes architectures from
    // the catalogue: `frontend` and `fullstack` are one word apart and do not
    // offer the same options. The descriptions existed all along — shown only
    // AFTER the choice, as the page's opening line.
    const output = render(["a.html"]);
    for (const type of ["backend", "frontend", "mobile", "fullstack"]) {
      assert.match(output, new RegExp(type), `${type} is not offered`);
    }
    assert.match(output, /browser|navigateur/i, "the types are listed without saying what they are");
  });

  test("an unknown type names what was typed, and what exists instead", () => {
    const output = render(["a.html", "svelte"]);
    assert.match(output, /svelte/);
    assert.match(output, /fullstack/);
    assert.match(output, /repository|dépôt|depot/i, "the alternative is named without being explained");
  });

  test("the help speaks the language the project declared", () => {
    const output = render(["a.html"], "fr");
    assert.match(output, /navigateur/, output);
  });

  test("the distinction that decides is spelled out, not left to the word", () => {
    // The one that was got wrong on a real bootstrap: a project declared
    // `frontend` while owning the database it expected to replace.
    const output = render(["a.html"]);
    assert.match(output, /data|données|donnees/i);
  });

  test("a correct type still renders, and says nothing about the others", () => {
    sandbox = createSandbox();
    const result = run(sandbox, "render-architecture.mjs", [join(sandbox, "a.html"), "backend"]);
    assert.equal(result.status, 0, result.output);
    assert.ok(!/mobile/.test(result.output), "the chooser reappeared after the choice was made");
  });
});
