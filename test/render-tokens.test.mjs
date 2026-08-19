import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { createSandbox, destroySandbox, run } from "./harness.mjs";

let sandbox = null;
afterEach(() => {
  if (sandbox != null) destroySandbox(sandbox);
  sandbox = null;
});

/**
 * Prepares a sandbox carrying a tokens file.
 *
 * @param tokens - content of the tokens file
 * @returns the sandbox root
 */
function withTokens(tokens) {
  const root = createSandbox();
  const path = join(root, "pipeline.config.json");
  const config = JSON.parse(readFileSync(path, "utf8"));
  config.architecture = { id: "feature-sliced", project_type: "frontend" };
  config.design_system = {
    tokens: "src/tokens.css",
    primitives: "own",
    decided_at: "2026-08-19",
    direction: { genre: "editorial", because: "long-form reading" },
  };
  writeFileSync(path, JSON.stringify(config, null, 2));
  const target = join(root, "src", "tokens.css");
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, tokens);
  return root;
}

/**
 * Renders the token sheet and reads it back.
 *
 * @param root - sandbox root
 * @returns the execution result and the page produced
 */
function render(root) {
  const target = join(root, "tokens.html");
  const result = run(root, "render-tokens.mjs", [target]);
  let html = "";
  try {
    html = readFileSync(target, "utf8");
  } catch {
    html = "";
  }
  return { ...result, html };
}

const SOUND = `:root {
  --ink: #16161a;
  --paper: #fffdf8;
  --accent: #b4451f;
  --space-1: 4px;
  --space-2: 8px;
  --space-4: 16px;
  --font-display: "Playfair Display", Georgia, serif;
}
`;

describe("render-tokens: seeing the paint box before drawing a screen", () => {
  test("shows every colour with its name and its value", () => {
    sandbox = withTokens(SOUND);
    const { status, html } = render(sandbox);
    assert.equal(status, 0, html);
    assert.match(html, /--ink/);
    assert.match(html, /#16161a/i);
    assert.match(html, /--accent/);
  });

  test("computes the contrast between colour pairs, the measurable half of accessibility", () => {
    sandbox = withTokens(SOUND);
    const { html } = render(sandbox);
    assert.match(html, /contrast/i);
    assert.match(html, /1[89]\.\d|1[6-9]:1|\d+\.\d+:1/, "ink on paper is a strong ratio and it should be stated");
  });

  test("marks a pair too weak to carry text", () => {
    sandbox = withTokens(":root {\n  --ink: #767676;\n  --paper: #8a8a8a;\n}\n");
    const { html } = render(sandbox);
    assert.match(html, /4\.5|too weak|fails/i, "a pair that cannot carry text is the one thing a palette must not hide");
  });

  test("names colours that are nearly the same, the six-greys trap", () => {
    sandbox = withTokens(":root {\n  --grey-1: #f9fafb;\n  --grey-2: #f8f9fa;\n  --ink: #16161a;\n}\n");
    const { html } = render(sandbox);
    // The verdict is looked for in its own row, next to both names. The
    // masthead already says "colours nobody can tell apart", so a looser
    // assertion passes on the page's fixed prose and measures nothing —
    // which it did, until removing the whole computation left it green.
    const row = html.match(/<tr><td><code>--grey-[12]<\/code> on <code>--grey-[12]<\/code><\/td>[^<]*<td>[^<]*<\/td><td>([^<]*)</);
    assert.ok(row != null, "the two greys must be compared with each other");
    assert.match(row[1], /indistinguishable/i, "two colours nobody can tell apart are two decisions where one was meant");
  });

  test("shows the lengths in order, so a near-duplicate step is visible", () => {
    sandbox = withTokens(":root {\n  --a: 4px;\n  --b: 15px;\n  --c: 16px;\n  --ink: #000000;\n}\n");
    const { html } = render(sandbox);
    // The names are looked for inside their tag: a bare "--a" also occurs in
    // the page's own stylesheet, where "--alarm" lives.
    const first = html.indexOf(">--a<");
    const last = html.indexOf(">--c<");
    assert.ok(first >= 0 && last > first, "an unordered scale hides its own gaps");
  });

  test("shows each font as text, not as a string", () => {
    sandbox = withTokens(SOUND);
    const { html } = render(sandbox);
    assert.match(html, /Playfair Display/);
    assert.match(html, /font-family:&quot;Playfair/i, "a font named but not rendered tells you nothing about it");
  });

  test("escapes what it is given, because a tokens file is edited by agents too", () => {
    sandbox = withTokens(":root {\n  --x: <script>alert(1)</script>;\n  --ink: #000000;\n}\n");
    const { html } = render(sandbox);
    assert.doesNotMatch(html, /<script>alert/);
  });

  test("refuses a project that declares no design system", () => {
    const root = createSandbox();
    const result = run(root, "render-tokens.mjs", [join(root, "out.html")]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /design_system/);
  });

  test("refuses a tokens file that declares nothing", () => {
    sandbox = withTokens("/* rien */\n");
    const { status, output } = render(sandbox);
    assert.notEqual(status, 0);
    assert.match(output, /no token/i);
  });

  test("says what the page does not decide", () => {
    sandbox = withTokens(SOUND);
    const { html } = render(sandbox);
    assert.match(html, /does not|not a screen|no screen/i, "a paint box shown as a design is a design nobody chose");
  });
});
