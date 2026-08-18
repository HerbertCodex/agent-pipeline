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
 * Rend la file d'arbitrage d'un store donne et relit la page produite.
 *
 * @param issues - records d'issues a placer dans le store
 * @param proposal - proposition facultative a joindre
 * @returns le resultat d'execution et le HTML produit
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

describe("render-decisions : ce qu'aucun agent ne peut prendre", () => {
  test("classe une issue dont tout le perimetre est hors politique", () => {
    const { output, html } = render([
      issue({ id: "i-orphan", title: "corriger le workflow", pipeline_state: state({ file_reservations: [".github/workflows/ci.yml"] }) }),
    ]);
    assert.match(output, /1 sans agent/);
    assert.match(html, /i-orphan/);
    assert.match(html, /aucun agent possible/);
  });

  test("ne classe pas une issue qu'un role peut prendre", () => {
    const { output } = render([
      issue({ id: "i-ok", pipeline_state: state({ file_reservations: ["src/x/**", "test/x.spec.ts"] }) }),
    ]);
    assert.match(output, /0 sans agent/);
    assert.match(output, /1 dispatchable/);
  });

  test("classe une issue dont le perimetre est partage entre deux roles", () => {
    const { output, html } = render([
      issue({ id: "i-split", title: "editer un document et regenerer les briefs", pipeline_state: state({ file_reservations: ["src/x/**", "pipeline/store/x"] }) }),
    ]);
    assert.match(output, /1 sans agent/, "aucun role unique ne couvre les deux moities");
    assert.match(html, /i-split/);
  });

  test("ignore une issue close", () => {
    const { output } = render([
      issue({ id: "i-done", pipeline_state: state({ phase: "closed", owner: "none", file_reservations: [".github/x"] }) }),
    ]);
    assert.match(output, /0 sans agent/);
  });
});

describe("render-decisions : ce qui est arrete", () => {
  test("classe une issue bloquee et nomme sa phase", () => {
    const { output, html } = render([
      issue({ id: "i-stuck", pipeline_state: state({ phase: "blocked_infrastructure", owner: "orchestrator", file_reservations: ["src/x/**"] }) }),
    ]);
    assert.match(output, /1 bloquee/);
    assert.match(html, /blocked_infrastructure/);
    assert.match(html, /tient ses reservations/);
  });

  test("une issue bloquee n'est pas comptee deux fois", () => {
    const { output } = render([
      issue({ id: "i-stuck", pipeline_state: state({ phase: "blocked_product", owner: "product", file_reservations: [".github/x"] }) }),
    ]);
    assert.match(output, /1 bloquee/);
    assert.match(output, /0 sans agent/, "une issue arretee se lit comme arretee, pas comme orpheline");
  });
});

describe("render-decisions : les questions de spec", () => {
  const PROPOSAL = {
    mode: "spec_proposal",
    round: 2,
    scope: { spec_id: "s-t1" },
    decisions_for_operator: [
      { id: "N1", question: "combien de prets ?", product_recommendation: "cinq", alternatives: ["trois", "dix"] },
    ],
  };

  test("reprend les choix soumis avec recommandation et options", () => {
    const { output, html } = render([], PROPOSAL);
    assert.match(output, /1 question\(s\) de spec/);
    assert.match(html, /combien de prets \?/);
    assert.match(html, /cinq/);
    assert.match(html, /dix/);
  });

  test("ajoute la demande d'approbation quand le perimetre est arrete", () => {
    const { html } = render([], { ...PROPOSAL, round: 5, decisions_for_operator: [], scope_final: true });
    assert.match(html, /Approuver le perimetre du tour 5/);
    assert.match(html, /refusee si son contenu bouge/);
  });

  test("refuse un fichier qui n'est pas une proposition", () => {
    const { status, output } = render([], { mode: "issue_handoff" });
    assert.notEqual(status, 0);
    assert.match(output, /doit etre une proposition/);
  });

  test("fonctionne sans proposition du tout", () => {
    const { status, output } = render([issue()]);
    assert.equal(status, 0, output);
    assert.match(output, /0 question\(s\) de spec/);
  });
});

describe("render-decisions : la page tient debout", () => {
  test("annonce explicitement qu'il n'y a rien a trancher", () => {
    const { html } = render([issue({ pipeline_state: state({ file_reservations: ["src/x/**"] }) })]);
    assert.match(html, /Rien n'attend d'arbitrage/);
    assert.match(html, /Aucune issue bloquee/);
  });

  test("neutralise une injection passee par un titre d'issue", () => {
    const { html } = render([
      issue({ id: "i-evil", title: "<script>alert(1)</script>", pipeline_state: state({ file_reservations: [".github/x"] }) }),
    ]);
    assert.doesNotMatch(html, /<script>alert/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  });

  test("est autonome et couvre les deux themes", () => {
    const { html } = render([issue()]);
    assert.doesNotMatch(html, /https?:\/\//);
    assert.match(html, /prefers-color-scheme/);
    assert.match(html, /data-theme="dark"/);
  });
});

describe("render-decisions : le framework nomme ce qu'un harnais doit faire", () => {
  test("imprime quoi faire de la page, sans supposer que le harnais sait publier", () => {
    const { output } = render([issue()]);
    assert.match(output, /si le harnais sait heberger/);
    assert.match(output, /sinon, lui rendre ce chemin/);
  });
});
