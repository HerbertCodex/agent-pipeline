import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { judge, summarise, unanswered } from "../scripts/discovery.mjs";
import { catalogue } from "../scripts/architectures.mjs";
import { pageText } from "../scripts/page.mjs";

const TEXT = pageText(null);
const CATALOGUE = catalogue(null).architectures;

/**
 * Returns a catalogue architecture by id.
 *
 * @param id - the architecture's identifier
 * @returns the catalogue entry, prose included
 */
function option(id) {
  return CATALOGUE.find((entry) => entry.id === id);
}

describe("an analysis that says nothing is not an analysis that says no", () => {
  test("an architecture is not judged on a question nobody answered", () => {
    // Measured on the framework itself: an analysis silent about integrations
    // made hexagonal "excessive here — no integration declared replaceable",
    // and the summary reported "no integration to replace" as a fact about a
    // project nobody had asked. That is how a recommendation gets made from
    // what was never said.
    const silent = { business_rules: [], concurrent_workers: "one" };
    const verdict = judge(option("hexagonal"), silent, TEXT);
    assert.equal(verdict.verdict, "undecided", JSON.stringify(verdict));
    assert.match(verdict.reasons.join(" "), /B5|integration/i, "the verdict must name what to answer");
  });

  test("an analysis that answers the question is judged on the answer", () => {
    const asked = { business_rules: [], concurrent_workers: "one", integrations: [] };
    const verdict = judge(option("hexagonal"), asked, TEXT);
    assert.equal(verdict.verdict, "excessif", JSON.stringify(verdict));
  });

  test("the summary says unknown rather than none", () => {
    const silent = { concurrent_workers: "one" };
    const line = summarise(silent, TEXT);
    assert.doesNotMatch(line, /no business rule|no integration/i, line);
  });

  test("a dense domain is still recommended once it is known", () => {
    const known = {
      business_rules: Array.from({ length: 9 }, (_, index) => ({ rule: `r${index}` })),
      integrations: [],
      concurrent_workers: "one",
    };
    assert.equal(judge(option("clean"), known, TEXT).verdict, "recommande");
  });

  test("an option that depends on nothing is decided whatever the silence", () => {
    // A folder per feature is the reasonable default: it is not conditioned on
    // a question, so silence does not suspend it.
    assert.equal(judge(option("feature-modules"), {}, TEXT).verdict, "recommande");
  });
});

describe("what remains to ask depends on what the description already said", () => {
  test("a silent analysis leaves the decisive questions open", () => {
    const open = unanswered({});
    assert.ok(open.includes("B5"), open.join(", "));
    assert.ok(open.includes("B6"), open.join(", "));
  });

  test("a question the description answered is not asked again", () => {
    const open = unanswered({ integrations: [], concurrent_workers: "teams" });
    assert.ok(!open.includes("B5"), open.join(", "));
    assert.ok(!open.includes("B6"), open.join(", "));
  });

  test("a complete analysis leaves nothing to ask", () => {
    const complete = {
      business_rules: [{ rule: "un livre deja sorti ne se prete pas" }],
      integrations: [{ name: "postgres", replaceable: false }],
      concurrent_workers: "few",
      expected_churn: "screens",
    };
    assert.deepEqual(unanswered(complete), []);
  });

  test("an empty list counts as an answer, an absent field does not", () => {
    // The distinction is the whole point: « we integrate with nothing » is a
    // finding, « nobody asked » is not.
    assert.ok(!unanswered({ integrations: [] }).includes("B5"));
    assert.ok(unanswered({}).includes("B5"));
  });
});
