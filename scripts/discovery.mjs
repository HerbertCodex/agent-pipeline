/**
 * The questions that make a project understood before its shape is chosen.
 *
 * They are answered in plain language, with no technical vocabulary, because
 * whoever knows the product is not necessarily whoever knows the
 * architectures. A recommendation given without these answers is a
 * catalogue: it can only argue in the abstract.
 *
 * Only the ids live here. The wording is the operator's language's, and the
 * separation is the same one the architecture catalogue makes: an id is what
 * a gate reads, a sentence is what a human reads.
 */
const BRIEF_IDS = ["B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8"];

/**
 * Verdicts an architecture can receive when faced with an analysed project.
 */
const RANK = { recommande: 0, undecided: 1, possible: 2, excessif: 3 };

/**
 * The analysis field each option's verdict actually turns on.
 *
 * An option absent from this table depends on no answer: silence does not
 * suspend it. An option present in it cannot be judged while its field is
 * unknown — and unknown is not the same as empty.
 */
const DEPENDS_ON = {
  layered: ["concurrent_workers"],
  hexagonal: ["integrations"],
  clean: ["business_rules"],
  onion: ["business_rules"],
  "feature-sliced": ["concurrent_workers"],
  mvi: ["expected_churn"],
};

/**
 * The question of the brief that would answer each analysis field.
 */
const ASKS = {
  business_rules: "B3",
  integrations: "B5",
  concurrent_workers: "B6",
  expected_churn: "B7",
};

/**
 * Says whether the analysis answers a field at all.
 *
 * The distinction this draws is the whole point: an empty list is a finding —
 * « we integrate with nothing » — while an absent field is a question nobody
 * asked. Reading the second as the first is how the framework once reported
 * « no integration to replace » about a project it had never questioned, and
 * declared hexagonal excessive on that ground.
 *
 * @param analysis - the project analysis
 * @param key - the field to look for
 * @returns true when the analysis carries an answer
 */
function answered(analysis, key) {
  return analysis?.[key] !== undefined && analysis?.[key] !== null;
}

/**
 * The questions a description has not yet answered.
 *
 * The eight questions of the brief are not a form to fill before anything is
 * known. The operator describes the product in their own words, an analysis
 * is drawn from it, and what remains open is what the description did not
 * cover — never the whole list again.
 *
 * @param analysis - the project analysis drawn from the description
 * @returns the ids of the questions still worth asking
 */
export function unanswered(analysis) {
  return Object.entries(ASKS)
    .filter(([field]) => !answered(analysis, field))
    .map(([, id]) => id)
    .sort();
}

/**
 * Returns the questions of the brief, worded in the operator's language.
 *
 * @param text - the language dictionary
 * @returns the questions, in the order they are asked
 */
export function briefQuestions(text) {
  return BRIEF_IDS.map((id) => ({ id, ...text.brief_questions[id] }));
}

/**
 * Confronts an architecture with a project's analysis.
 *
 * The reasoning is explicit and handed to the operator: a recommendation
 * whose grounds cannot be seen is not discussed, it is accepted, which is
 * exactly what this mechanism exists to prevent.
 *
 * @param entry - catalogue architecture
 * @param analysis - project analysis drawn from the rough brief
 * @param text - the language dictionary
 * @returns the verdict and the reasons grounding it
 */
export function judge(entry, analysis, text) {
  const say = (key, count) =>
    count === undefined ? text.judgement[key] : text.judgement[key].split("{count}").join(String(count));

  // An option is not judged on a question nobody answered. Silence used to
  // read as a negative answer, and the page then recommended against an
  // architecture on the strength of what was never said.
  const missing = (DEPENDS_ON[entry.id] ?? []).filter((field) => !answered(analysis, field));
  if (missing.length > 0) {
    return {
      verdict: "undecided",
      label: text.verdicts.undecided,
      rank: RANK.undecided,
      reasons: missing.map((field) =>
        text.judgement.undecided.split("{question}").join(ASKS[field]).split("{field}").join(field),
      ),
    };
  }
  const rules = (analysis.business_rules ?? []).length;
  const swappable = (analysis.integrations ?? []).filter((item) => item.replaceable === true).length;
  const parallel = analysis.concurrent_workers === "few" || analysis.concurrent_workers === "teams";
  const reasons = [];
  let verdict = "possible";

  if (entry.id === "feature-modules") {
    verdict = "recommande";
    reasons.push(
      parallel
        ? say(analysis.concurrent_workers === "teams" ? "teams_parallel" : "people_parallel")
        : say("cheap"),
    );
    if (rules > 0) reasons.push(say("rules_fit", rules));
  }

  if (entry.id === "layered") {
    if (parallel) {
      verdict = "excessif";
      reasons.push(say("layered_parallel"));
    } else {
      reasons.push(say("layered_solo"));
    }
  }

  if (entry.id === "hexagonal") {
    if (swappable === 0) {
      verdict = "excessif";
      reasons.push(say("hex_none"));
    } else if (swappable >= 2) {
      verdict = "recommande";
      reasons.push(say("hex_many", swappable));
    } else {
      reasons.push(say("hex_one"));
    }
  }

  if (entry.id === "clean" || entry.id === "onion") {
    if (rules === 0) {
      verdict = "excessif";
      reasons.push(say("clean_none"));
    } else if (rules >= 8) {
      verdict = "recommande";
      reasons.push(say("clean_dense", rules));
    } else {
      verdict = "excessif";
      reasons.push(say("clean_thin", rules));
    }
  }

  if (entry.id === "feature-sliced") {
    verdict = parallel ? "recommande" : "possible";
    reasons.push(say("sliced"));
  }

  if (entry.id === "mvvm") {
    reasons.push(say("mvvm"));
  }

  if (entry.id === "mvi") {
    verdict = analysis.expected_churn === "screens" ? "possible" : "excessif";
    reasons.push(say(analysis.expected_churn === "screens" ? "mvi_churn" : "mvi_stable"));
  }

  return { verdict, label: text.verdicts[verdict], rank: RANK[verdict], reasons };
}

/**
 * Summarises what the analysis says about the project, in one quotable line.
 *
 * @param analysis - project analysis
 * @param text - the language dictionary
 * @returns the summary sentence
 */
export function summarise(analysis, text) {
  const say = (key, count) =>
    count === undefined ? text.summary[key] : text.summary[key].split("{count}").join(String(count));
  const rules = (analysis.business_rules ?? []).length;
  const swappable = (analysis.integrations ?? []).filter((item) => item.replaceable === true).length;
  const domain = !answered(analysis, "business_rules")
    ? say("rules_unknown")
    : rules === 0
      ? say("no_rule")
      : rules < 8
        ? say("few_rules", rules)
        : say("dense_rules", rules);
  const ports = !answered(analysis, "integrations")
    ? say("ports_unknown")
    : swappable === 0
      ? say("no_port")
      : say("some_ports", swappable);
  const workers =
    analysis.concurrent_workers === "one"
      ? say("one_person")
      : analysis.concurrent_workers === "teams"
        ? say("teams")
        : say("few_people");
  return text.summary.sentence
    .split("{domain}").join(domain)
    .split("{ports}").join(ports)
    .split("{workers}").join(workers);
}
