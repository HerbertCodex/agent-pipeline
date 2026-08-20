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
const RANK = { recommande: 0, possible: 1, excessif: 2 };

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
  const domain = rules === 0 ? say("no_rule") : rules < 8 ? say("few_rules", rules) : say("dense_rules", rules);
  const ports = swappable === 0 ? say("no_port") : say("some_ports", swappable);
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
