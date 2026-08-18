import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createSandbox, destroySandbox, writeJson, run, issue, state } from "./harness.mjs";

let sandbox = null;
afterEach(() => {
  if (sandbox != null) destroySandbox(sandbox);
  sandbox = null;
});

/**
 * Renders the arbitration queue for a given store and reads the page back.
 *
 * @param issues - issue records to place in the store
 * @param proposal - optional proposal to attach
 * @returns the execution result and the HTML produced
 */
function render(issues, proposal = null) {
  sandbox = createSandbox({ issues });
  const target = join(sandbox, "page.html");
  const args = [target];
  if (proposal != null) args.push(writeJson(sandbox, "proposition.json", proposal));
  const result = run(sandbox, "render-decisions.mjs", args);
  let html = "";
  try {
    html = readFileSync(target, "utf8");
  } catch {
    html = "";
  }
  return { ...result, html };
}

describe("render-decisions: what no agent can take", () => {
  test("lists an issue whose whole scope is outside the policy", () => {
    const { output, html } = render([
      issue({ id: "i-orphan", title: "corriger le workflow", pipeline_state: state({ file_reservations: [".github/workflows/ci.yml"] }) }),
    ]);
    assert.match(output, /1 with no agent/);
    assert.match(html, /i-orphan/);
    assert.match(html, /no possible agent/);
  });

  test("does not list an issue a role can take", () => {
    const { output } = render([
      issue({ id: "i-ok", pipeline_state: state({ file_reservations: ["src/x/**", "test/x.spec.ts"] }) }),
    ]);
    assert.match(output, /0 with no agent/);
    assert.match(output, /1 dispatchable/);
  });

  test("lists an issue whose scope is split across two roles", () => {
    const { output, html } = render([
      issue({ id: "i-split", title: "editer un document et regenerer les briefs", pipeline_state: state({ file_reservations: ["src/x/**", "pipeline/store/x"] }) }),
    ]);
    assert.match(output, /1 with no agent/, "aucun role unique ne couvre les deux moities");
    assert.match(html, /i-split/);
  });

  test("ignores a closed issue", () => {
    const { output } = render([
      issue({ id: "i-done", pipeline_state: state({ phase: "closed", owner: "none", file_reservations: [".github/x"] }) }),
    ]);
    assert.match(output, /0 with no agent/);
  });
});

describe("render-decisions: what is stopped", () => {
  test("lists a blocked issue and names its phase", () => {
    const { output, html } = render([
      issue({ id: "i-stuck", pipeline_state: state({ phase: "blocked_infrastructure", owner: "orchestrator", file_reservations: ["src/x/**"] }) }),
    ]);
    assert.match(output, /1 blocked/);
    assert.match(html, /blocked_infrastructure/);
    assert.match(html, /holds its reservations/);
  });

  test("a blocked issue is not counted twice", () => {
    const { output } = render([
      issue({ id: "i-stuck", pipeline_state: state({ phase: "blocked_product", owner: "product", file_reservations: [".github/x"] }) }),
    ]);
    assert.match(output, /1 blocked/);
    assert.match(output, /0 with no agent/, "une issue arretee se lit comme arretee, pas comme orpheline");
  });
});

describe("render-decisions: the spec questions", () => {
  const PROPOSAL = {
    mode: "spec_proposal",
    round: 2,
    scope: { spec_id: "s-t1" },
    decisions_for_operator: [
      { id: "N1", question: "combien de prets ?", product_recommendation: "cinq", alternatives: ["trois", "dix"] },
    ],
  };

  test("carries the submitted choices with recommendation and options", () => {
    const { output, html } = render([], PROPOSAL);
    assert.match(output, /1 spec question\(s\)/);
    assert.match(html, /combien de prets \?/);
    assert.match(html, /cinq/);
    assert.match(html, /dix/);
  });

  test("adds the approval request once the scope is final", () => {
    const { html } = render([], { ...PROPOSAL, round: 5, decisions_for_operator: [], scope_final: true });
    assert.match(html, /Approve the scope of round 5/);
    assert.match(html, /refused if its content moves/);
  });

  test("refuses a file that is not a proposal", () => {
    const { status, output } = render([], { mode: "issue_handoff" });
    assert.notEqual(status, 0);
    assert.match(output, /must be a spec proposal/);
  });

  test("works with no proposal at all", () => {
    const { status, output } = render([issue()]);
    assert.equal(status, 0, output);
    assert.match(output, /0 spec question\(s\)/);
  });
});

describe("render-decisions: the page holds together", () => {
  test("states explicitly when there is nothing to arbitrate", () => {
    const { html } = render([issue({ pipeline_state: state({ file_reservations: ["src/x/**"] }) })]);
    assert.match(html, /Nothing awaits arbitration/);
    assert.match(html, /No blocked issue/);
  });

  test("neutralises an injection carried by an issue title", () => {
    const { html } = render([
      issue({ id: "i-evil", title: "<script>alert(1)</script>", pipeline_state: state({ file_reservations: [".github/x"] }) }),
    ]);
    assert.doesNotMatch(html, /<script>alert/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  });

  test("is self-contained and covers both themes", () => {
    const { html } = render([issue()]);
    assert.doesNotMatch(html, /https?:\/\//);
    assert.match(html, /prefers-color-scheme/);
    assert.match(html, /data-theme="dark"/);
  });
});

describe("render-decisions: the framework names what a harness must do", () => {
  test("prints what to do with the page without assuming the harness can publish", () => {
    const { output } = render([issue()]);
    assert.match(output, /if the harness can host/);
    assert.match(output, /otherwise hand them this path/);
  });
});
