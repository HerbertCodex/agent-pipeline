import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createSandbox, destroySandbox, writeJson, run } from "./harness.mjs";

let sandbox = null;
afterEach(() => {
  if (sandbox != null) destroySandbox(sandbox);
  sandbox = null;
});

const SCOPE = {
  intent: "une bibliotheque prete des livres",
  features: [{ name: "Emprunter", user_value: "un membre repart avec un livre", rules: ["un exemplaire sorti ne se prete pas deux fois"] }],
  out_of_scope: ["reservation"],
};

/**
 * Renders a proposal in the sandbox and reads the page back.
 *
 * @param handoff - content of the proposal to render
 * @returns the execution result and the HTML produced, empty on failure
 */
function render(handoff) {
  sandbox ??= createSandbox();
  const source = writeJson(sandbox, "proposition.json", handoff);
  const target = join(sandbox, "page.html");
  const result = run(sandbox, "render-proposal.mjs", [source, target]);
  let html = "";
  try {
    html = readFileSync(target, "utf8");
  } catch {
    html = "";
  }
  return { ...result, html };
}

describe("render-proposal: what it agrees to render", () => {
  test("renders a proposal and counts what it carries", () => {
    const { status, html, output } = render({
      mode: "spec_proposal",
      round: 3,
      scope: { spec_id: "s-t1" },
      functional_scope: SCOPE,
      decisions_for_operator: [{ id: "N1", question: "combien ?", product_recommendation: "cinq", alternatives: ["trois"] }],
    });
    assert.equal(status, 0, output);
    assert.match(output, /round 3/);
    assert.match(html, /Emprunter/);
    assert.match(html, /un exemplaire sorti ne se prete pas deux fois/);
    assert.match(html, /reservation/);
  });

  test("refuses any mode that is not a proposal", () => {
    const { status, output } = render({ mode: "issue_handoff", round: 1 });
    assert.notEqual(status, 0);
    assert.match(output, /only a spec_proposal/);
  });

  test("refuses an unreadable file", () => {
    sandbox ??= createSandbox();
    const result = run(sandbox, "render-proposal.mjs", ["/absent.json", join(sandbox, "x.html")]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /unreadable/);
  });
});

describe("render-proposal: content is data, never markup", () => {
  test("neutralises a script injection in a feature name", () => {
    const { html } = render({
      mode: "spec_proposal",
      round: 1,
      scope: { spec_id: "s-t1" },
      functional_scope: {
        features: [{ name: "<script>alert(1)</script>", user_value: "a & b", rules: ["<img onerror=x>"] }],
        out_of_scope: [],
      },
      decisions_for_operator: [],
      scope_final: true,
    });
    assert.doesNotMatch(html, /<script>alert/, "aucune balise script executable ne doit sortir");
    assert.doesNotMatch(html, /<img onerror/, "aucun gestionnaire d'evenement ne doit sortir");
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(html, /a &amp; b/);
  });

  test("neutralises an injection carried by an exclusion or a decision", () => {
    const { html } = render({
      mode: "spec_proposal",
      round: 1,
      scope: { spec_id: "s-t1" },
      functional_scope: { features: SCOPE.features, out_of_scope: ['"><script>x</script>'] },
      decisions_for_operator: [
        { id: "N1", question: "<b>q</b>", product_recommendation: "<i>r</i>", alternatives: ["<u>a</u>"] },
      ],
    });
    assert.doesNotMatch(html, /<script>x<\/script>/);
    assert.match(html, /&lt;b&gt;q&lt;\/b&gt;/);
    assert.match(html, /&lt;u&gt;a&lt;\/u&gt;/);
  });
});

describe("render-proposal: the page says where the round stands", () => {
  test("an open round announces its questions and renders them before the scope", () => {
    const { html } = render({
      mode: "spec_proposal",
      round: 2,
      scope: { spec_id: "s-t1" },
      functional_scope: SCOPE,
      operator_feedback: { round_reviewed: 1, summary: "duree portee a 21 jours" },
      decisions_for_operator: [
        { id: "N1", question: "combien de prets ?", product_recommendation: "cinq", alternatives: ["trois"] },
      ],
    });
    assert.match(html, /1 open question\(s\)/);
    assert.match(html, /combien de prets \?/);
    assert.match(html, /duree portee a 21 jours/);
    assert.ok(
      html.indexOf("awaits your decision") < html.indexOf("What the product does"),
      "an open round reads first by what it asks",
    );
  });

  test("a final round announces a settled scope and carries its digest", () => {
    const { html } = render({
      mode: "spec_proposal",
      round: 5,
      scope: { spec_id: "s-t1" },
      scope_final: true,
      functional_scope: SCOPE,
      decisions_for_operator: [],
      handoff_file: { path: "/x.json", digest_sha256: "a".repeat(64) },
    });
    assert.match(html, /scope settled/);
    assert.match(html, new RegExp("a".repeat(64)));
    assert.doesNotMatch(html, /awaits your decision/);
  });

  test("the page is self-contained: no external resource to load", () => {
    const { html } = render({
      mode: "spec_proposal",
      round: 1,
      scope: { spec_id: "s-t1" },
      functional_scope: SCOPE,
      decisions_for_operator: [],
      scope_final: true,
    });
    assert.doesNotMatch(html, /https?:\/\//, "une politique de securite stricte bloque tout hote externe");
    assert.match(html, /prefers-color-scheme/, "les deux themes sont couverts");
  });
});
