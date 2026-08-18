import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createSandbox, destroySandbox, run } from "./harness.mjs";
import { ARCHITECTURES, PROJECT_TYPES } from "../scripts/architectures.mjs";

let sandbox = null;
afterEach(() => {
  if (sandbox != null) destroySandbox(sandbox);
  sandbox = null;
});

/**
 * Rend la page d'architecture pour un type de projet.
 *
 * @param type - type de projet passe au script
 * @returns le resultat d'execution et le HTML produit
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

describe("render-architecture : le type de projet filtre le catalogue", () => {
  test("chaque type reconnu rend une page", () => {
    for (const type of Object.keys(PROJECT_TYPES)) {
      const { status, html } = render(type);
      assert.equal(status, 0, `${type} devrait rendre`);
      assert.match(html, /Comment ranger le code/);
      destroySandbox(sandbox);
      sandbox = null;
    }
  });

  test("une interface web ne se voit pas proposer l'hexagonale ni Clean", () => {
    const { html } = render("frontend");
    const options = html.slice(html.indexOf("Le détail de chaque option"));
    assert.doesNotMatch(options, /Hexagonale/, "l'hexagonale ne s'applique pas a un front");
    assert.doesNotMatch(options, /Clean Architecture/);
    assert.match(options, /Découpage en tranches/);
  });

  test("un service back-end ne se voit pas proposer le decoupage en tranches", () => {
    const { html } = render("backend");
    const options = html.slice(html.indexOf("Le détail de chaque option"));
    assert.doesNotMatch(options, /Découpage en tranches/);
    assert.match(options, /Hexagonale/);
  });

  test("seul un depot full-stack recoit la question de la frontiere", () => {
    assert.match(render("fullstack").html, /Ce qui passe entre le front et le back/);
    destroySandbox(sandbox);
    sandbox = null;
    assert.doesNotMatch(render("backend").html, /Ce qui passe entre le front et le back/);
  });

  test("refuse un type inconnu plutot que de tout rendre", () => {
    const { status, output } = render("erlang");
    assert.notEqual(status, 0);
    assert.match(output, /type de projet inconnu/);
  });

  test("refuse un appel sans type", () => {
    sandbox ??= createSandbox();
    const result = run(sandbox, "render-architecture.mjs", [join(sandbox, "p.html")]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /usage/);
  });
});

describe("render-architecture : la page dit ce que la porte appliquera", () => {
  test("chaque option publie sa declaration de couches", () => {
    const { html } = render("backend");
    assert.match(html, /Sens des dépendances/);
    assert.match(html, /jamais l&#39;inverse|jamais l'inverse/);
    assert.match(html, /À quoi ça ressemble/);
  });

  test("chaque option nomme son cout, son gain et son mode d'echec", () => {
    const { html } = render("backend");
    for (const label of ["Coût", "Gain", "Piège"]) assert.match(html, new RegExp(label));
    assert.match(html, /En résumé/);
  });

  test("la page dit que le pipeline ne choisit pas a la place de l'operateur", () => {
    const { html } = render("mobile");
    assert.match(html, /ne choisit pas à votre place/);
    assert.match(html, /opposable/);
  });
});

describe("architectures : le catalogue est coherent", () => {
  test("chaque architecture declare des couches et un sens de dependance", () => {
    for (const entry of ARCHITECTURES) {
      assert.ok(Object.keys(entry.layers).length > 0, `${entry.id} sans couches`);
      assert.ok(Object.keys(entry.allowed).length > 0, `${entry.id} sans sens de dependance`);
    }
  });

  test("aucune couche autorisee ne designe une couche qui n'existe pas", () => {
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

  test("chaque architecture a une couche terminale, sinon le graphe boucle", () => {
    for (const entry of ARCHITECTURES) {
      const terminal = Object.entries(entry.allowed).filter(([, targets]) => targets.length === 0);
      assert.ok(terminal.length > 0, `${entry.id} : aucune couche ne depend de rien, le sens est circulaire`);
    }
  });

  test("chaque architecture s'applique a au moins un type de projet connu", () => {
    for (const entry of ARCHITECTURES) {
      assert.ok(entry.applies.length > 0, `${entry.id} ne s'applique nulle part`);
      for (const type of entry.applies) {
        assert.ok(PROJECT_TYPES[type] != null, `${entry.id} vise ${type}, type inconnu`);
      }
    }
  });
});

describe("render-architecture : sans analyse, on pose les questions", () => {
  test("le questionnaire remplace le conseil quand rien n'est fourni", () => {
    const { html, output } = render("backend");
    assert.match(output, /questionnaire/);
    assert.match(html, /D'abord : de quoi parle ce projet/);
    assert.match(html, /doit REFUSER quelque chose/);
    assert.doesNotMatch(html, /Notre conseil/);
  });

  test("la question qui detecte le metier est nommee comme telle", () => {
    const { html } = render("backend");
    assert.match(html, /La question qui decide vraiment, c'est B3/);
    assert.match(html, /n'a pas de metier : il a un schema/);
  });
});

describe("render-architecture : avec une analyse, le conseil est fonde", () => {
  /**
   * Rend la page avec une analyse de projet donnee.
   *
   * @param type - type de projet
   * @param analysis - analyse a joindre
   * @returns le resultat d'execution et le HTML produit
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

  test("un projet sans regle metier se voit dire que Clean est excessif", () => {
    const { html } = advise("backend", SANS_METIER);
    assert.match(html, /Aucune regle metier reperee/);
    assert.match(html, /les couches se rempliraient d'objets qui recopient des lignes/);
  });

  test("un projet sans integration remplacable se voit dire que les ports sont une assurance inutile", () => {
    const { html } = advise("backend", AVEC_METIER);
    assert.match(html, /assurance dont vous n'encaisserez jamais l'interet/);
  });

  test("un projet a plusieurs integrations remplacables se voit recommander l'hexagonale", () => {
    const { html } = advise("backend", BEAUCOUP_D_INTEGRATIONS);
    const conseil = html.slice(html.indexOf("Notre conseil"), html.indexOf("En un coup"));
    const bloc = conseil.slice(conseil.indexOf("Hexagonale") - 200, conseil.indexOf("Hexagonale"));
    assert.match(bloc, /Recommandé/);
  });

  test("le conseil cite les regles metier reperees, il ne les resume pas", () => {
    const { html } = advise("backend", AVEC_METIER);
    assert.match(html, /un exemplaire sorti ne se prete pas deux fois/);
  });

  test("refuse une analyse sans business_rules : l'absence se conclut, elle ne s'oublie pas", () => {
    const { status, output } = advise("backend", { integrations: [] });
    assert.notEqual(status, 0);
    assert.match(output, /business_rules, meme vide/);
  });

  test("refuse une analyse introuvable", () => {
    sandbox ??= createSandbox();
    const result = run(sandbox, "render-architecture.mjs", [join(sandbox, "p.html"), "backend", "/absent.json"]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /analyse introuvable/);
  });
});

describe("render-architecture : ce qui se passe quand le projet grossit", () => {
  test("chaque option dit dans quoi elle grandit et ce qui declenche le changement", () => {
    const { html } = render("backend");
    assert.match(html, /Quand le projet grossira/);
    assert.match(html, /Coût du changement/);
    assert.match(html, /La même règle métier apparaît dans deux modules/);
  });

  test("la page traite l'objection au lieu de l'ignorer", () => {
    const { html } = render("backend");
    assert.match(html, /Et si je me trompe/);
    assert.match(html, /Ne choisissez pas le plus lourd par précaution/);
    assert.match(html, /Partir simple garde les options ouvertes/);
  });

  test("elle dit que la migration se mesure au lieu de s'explorer", () => {
    const { html } = render("backend");
    assert.match(html, /la liste exacte/);
    assert.match(html, /liste de tâches, pas une exploration/);
  });
});

describe("architectures : le catalogue dit comment il se quitte", () => {
  test("chaque option porte un devenir, des declencheurs et un cout de changement", () => {
    for (const entry of ARCHITECTURES) {
      assert.ok(entry.grows_into, `${entry.id} ne dit pas dans quoi il grandit`);
      assert.ok(entry.migration_triggers?.length > 0, `${entry.id} n'a aucun declencheur`);
      assert.ok(entry.migration_cost, `${entry.id} ne dit pas ce que couterait d'en sortir`);
    }
  });

  test("les options lourdes annoncent qu'on n'en sort pas, les legeres qu'on en sort par morceaux", () => {
    const lourdes = ARCHITECTURES.filter((e) => ["hexagonal", "clean", "onion"].includes(e.id));
    for (const entry of lourdes) {
      assert.match(entry.migration_cost, /ne se fait pas|difficile à quitter|subit|vit avec/i, `${entry.id} minimise son cout de sortie`);
    }
    const legere = ARCHITECTURES.find((e) => e.id === "feature-modules");
    assert.match(legere.migration_cost, /local|morceaux/i);
  });
});
