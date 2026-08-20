import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createSandbox, destroySandbox, run } from "./harness.mjs";
import { ARCHITECTURES, PROJECT_TYPES, catalogue } from "../scripts/architectures.mjs";

const here = dirname(fileURLToPath(import.meta.url));

let sandbox = null;
afterEach(() => {
  if (sandbox != null) destroySandbox(sandbox);
  sandbox = null;
});

/**
 * Renders the architecture page for a project type.
 *
 * @param type - project type passed to the script
 * @returns the execution result and the HTML produced
 */
function render(type) {
  sandbox ??= createSandbox();
  const target = join(sandbox, "page.html");
  const result = run(sandbox, "render-architecture.mjs", [target, type]);
  let html = "";
  try {
    html = readFileSync(target, "utf8");
  } catch {
    html = "";
  }
  return { ...result, html };
}

describe("render-architecture: the project type filters the catalogue", () => {
  test("every recognised type renders a page", () => {
    for (const type of PROJECT_TYPES) {
      const { status, html } = render(type);
      assert.equal(status, 0, `${type} devrait rendre`);
      assert.match(html, /How should this project's code be arranged/);
      destroySandbox(sandbox);
      sandbox = null;
    }
  });

  test("a web interface is not offered hexagonal or Clean", () => {
    const { html } = render("frontend");
    const options = html.slice(html.indexOf("Each option in detail"));
    assert.doesNotMatch(options, /Hexagonal/i, "hexagonal does not apply to a front end");
    assert.doesNotMatch(options, /Clean Architecture/);
    assert.match(options, /Feature-sliced|Decoupage/);
  });

  test("a back-end service is not offered feature-sliced", () => {
    const { html } = render("backend");
    const options = html.slice(html.indexOf("Each option in detail"));
    assert.doesNotMatch(options, /Feature-sliced|Decoupage/);
    assert.match(options, /Hexagonal/i);
  });

  test("only a full-stack repository gets the boundary question", () => {
    assert.match(render("fullstack").html, /What crosses between the front and the back/);
    destroySandbox(sandbox);
    sandbox = null;
    assert.doesNotMatch(render("backend").html, /What crosses between the front and the back/);
  });

  test("refuses an unknown type instead of rendering everything", () => {
    const { status, output } = render("erlang");
    assert.notEqual(status, 0);
    assert.match(output, /unknown project type/);
  });

  test("refuses a call with no type", () => {
    sandbox ??= createSandbox();
    const result = run(sandbox, "render-architecture.mjs", [join(sandbox, "p.html")]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /usage/);
  });
});

describe("render-architecture: the page states what the gate will enforce", () => {
  test("every option publishes its layer declaration", () => {
    const { html } = render("backend");
    assert.match(html, /Dependency direction/);
    assert.match(html, /never the reverse/);
    assert.match(html, /What it looks like/);
  });

  test("every option names its cost, its benefit and how it fails", () => {
    const { html } = render("backend");
    for (const label of ["Cost", "Buys", "Trap"]) assert.match(html, new RegExp(label));
    assert.match(html, /In short/);
  });

  test("the page states the pipeline does not choose for the operator", () => {
    const { html } = render("mobile");
    assert.match(html, /does not choose for you/);
    assert.match(html, /enforceable/);
  });
});

describe("architectures: the catalogue is coherent", () => {
  test("every architecture declares layers and a dependency direction", () => {
    for (const entry of ARCHITECTURES) {
      assert.ok(Object.keys(entry.layers).length > 0, `${entry.id} sans couches`);
      assert.ok(Object.keys(entry.allowed).length > 0, `${entry.id} sans sens de dependance`);
    }
  });

  test("no allowed layer points at a layer that does not exist", () => {
    for (const entry of ARCHITECTURES) {
      const known = new Set(Object.keys(entry.layers));
      for (const [from, targets] of Object.entries(entry.allowed)) {
        assert.ok(known.has(from), `${entry.id} : ${from} n'est pas une couche declaree`);
        for (const to of targets) {
          assert.ok(known.has(to), `${entry.id} : ${from} pointe vers ${to}, qui n'existe pas`);
        }
      }
    }
  });

  test("every architecture has a terminal layer, else the graph loops", () => {
    for (const entry of ARCHITECTURES) {
      const terminal = Object.entries(entry.allowed).filter(([, targets]) => targets.length === 0);
      assert.ok(terminal.length > 0, `${entry.id} : aucune couche ne depend de rien, le sens est circulaire`);
    }
  });

  test("every architecture applies to at least one known project type", () => {
    for (const entry of ARCHITECTURES) {
      assert.ok(entry.applies.length > 0, `${entry.id} ne s'applique nulle part`);
      for (const type of entry.applies) {
        assert.ok(PROJECT_TYPES.includes(type), `${entry.id} vise ${type}, type inconnu`);
      }
    }
  });
});

describe("render-architecture: with no analysis, it asks the questions", () => {
  test("the questionnaire replaces the advice when nothing is supplied", () => {
    const { html, output } = render("backend");
    assert.match(output, /questionnaire/);
    assert.match(html, /First: what is this project about/);
    assert.match(html, /must REFUSE something/);
    assert.doesNotMatch(html, /Notre conseil/);
  });

  test("the question that detects a domain is named as such", () => {
    const { html } = render("backend");
    assert.match(html, /The question that really decides is B3/);
    assert.match(html, /has no domain: it has a schema/);
  });
});

describe("render-architecture: with an analysis, the advice is grounded", () => {
  /**
   * Renders the page with a given project analysis.
   *
   * @param type - project type
   * @param analysis - analysis to attach
   * @returns the execution result and the HTML produced
   */
  function advise(type, analysis) {
    sandbox ??= createSandbox();
    const target = join(sandbox, "page.html");
    const source = join(sandbox, "analyse.json");
    writeFileSync(source, JSON.stringify(analysis));
    const result = run(sandbox, "render-architecture.mjs", [target, type, source]);
    let html = "";
    try {
      html = readFileSync(target, "utf8");
    } catch {
      html = "";
    }
    return { ...result, html };
  }

  const SANS_METIER = { business_rules: [], integrations: [], concurrent_workers: "one", expected_churn: "screens" };
  const AVEC_METIER = {
    business_rules: [{ rule: "un exemplaire sorti ne se prete pas deux fois" }],
    integrations: [{ name: "sqlite", replaceable: false }],
    concurrent_workers: "few",
    expected_churn: "rules",
  };
  const BEAUCOUP_D_INTEGRATIONS = {
    business_rules: [{ rule: "r1" }, { rule: "r2" }],
    integrations: [
      { name: "paiement", replaceable: true },
      { name: "recherche", replaceable: true },
    ],
    concurrent_workers: "few",
    expected_churn: "integrations",
  };

  test("a project with no business rule is told Clean is excessive", () => {
    const { html } = advise("backend", SANS_METIER);
    assert.match(html, /No business rule found/);
    assert.match(html, /layers would fill with objects copying rows around/);
  });

  test("a project with no replaceable integration is told ports are insurance it will not use", () => {
    const { html } = advise("backend", AVEC_METIER);
    assert.match(html, /insurance you never claim/);
  });

  test("a project with several replaceable integrations is recommended hexagonal", () => {
    const { html } = advise("backend", BEAUCOUP_D_INTEGRATIONS);
    const conseil = html.slice(html.indexOf("Our advice"), html.indexOf("At a glance"));
    const bloc = conseil.slice(conseil.indexOf("Hexagonal") - 200, conseil.indexOf("Hexagonal"));
    assert.match(bloc, /Recommended/);
  });

  test("the advice quotes the business rules found, it does not summarise them", () => {
    const { html } = advise("backend", AVEC_METIER);
    assert.match(html, /un exemplaire sorti ne se prete pas deux fois/);
  });

  test("refuses an analysis with no business_rules: an absence is concluded, not forgotten", () => {
    const { status, output } = advise("backend", { integrations: [] });
    assert.notEqual(status, 0);
    assert.match(output, /business_rules, even empty/);
  });

  test("refuses an analysis that does not exist", () => {
    sandbox ??= createSandbox();
    const result = run(sandbox, "render-architecture.mjs", [join(sandbox, "p.html"), "backend", "/absent.json"]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /analysis not found/);
  });
});

describe("render-architecture: what happens as the project grows", () => {
  test("every option says what it grows into and what triggers a change", () => {
    const { html } = render("backend");
    assert.match(html, /As the project grows/);
    assert.match(html, /Migration cost/);
    assert.match(html, /The same business rule appears in two modules/);
  });

  test("the page answers the objection instead of ignoring it", () => {
    const { html } = render("backend");
    assert.match(html, /What if I get it wrong/);
    assert.match(html, /Do not pick the heaviest option out of caution/);
    assert.match(html, /Starting simple keeps the options open/);
  });

  test("it says migration is measured, not explored", () => {
    const { html } = render("backend");
    assert.match(html, /the exact list/);
    assert.match(html, /task list, not an exploration/);
  });
});

describe("architectures: the catalogue says how each option is left", () => {
  // The prose is read through `catalogue`, never off the structural entries:
  // it lives in the language dictionary, and a test reading the structure
  // would be checking a copy nobody displays.
  const spoken = catalogue(null).architectures;

  test("every option carries a future, triggers and a migration cost", () => {
    for (const entry of spoken) {
      assert.ok(entry.grows_into, `${entry.id} ne dit pas dans quoi il grandit`);
      assert.ok(entry.migration_triggers?.length > 0, `${entry.id} n'a aucun declencheur`);
      assert.ok(entry.migration_cost, `${entry.id} ne dit pas ce que couterait d'en sortir`);
    }
  });

  test("every structural entry has prose behind it, in every language shipped", () => {
    const required = ["name", "plain", "tree", "cost", "buys", "wrong_when", "verdict"];
    for (const code of ["en", "fr"]) {
      const text = JSON.parse(readFileSync(join(here, "..", "pages", `${code}.json`), "utf8"));
      for (const entry of ARCHITECTURES) {
        const said = text.architectures[entry.id];
        assert.ok(said != null, `${code}: ${entry.id} has no prose, the page would render blank`);
        for (const key of required) assert.ok(said[key], `${code}: ${entry.id} carries no ${key}`);
      }
    }
  });

  test("heavy options announce there is no way out, light ones that you leave piece by piece", () => {
    const lourdes = spoken.filter((e) => ["hexagonal", "clean", "onion"].includes(e.id));
    for (const entry of lourdes) {
      assert.match(entry.migration_cost, /no going back|hardest in the catalogue|endure|hard to leave/i, `${entry.id} downplays its exit cost`);
    }
    const legere = spoken.find((e) => e.id === "feature-modules");
    assert.match(legere.migration_cost, /local|piece by piece/i);
  });
});
