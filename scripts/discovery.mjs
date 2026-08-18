/**
 * The questions that make a project understood before its shape is chosen.
 *
 * They are answered in plain language, with no technical vocabulary, because
 * whoever knows the product is not necessarily whoever knows the
 * architectures. A recommendation given without these answers is a
 * catalogue: it can only argue in the abstract.
 */
export const BRIEF_QUESTIONS = [
  {
    id: "B1",
    question: "In one sentence, what is the product for, and for whom?",
    hint: "No jargon. If the sentence needs a technical word, it is describing the solution, not the need.",
    reveals: "the domain, and whether the product has an identifiable user",
  },
  {
    id: "B2",
    question: "Name three things a user does with it.",
    hint: "Actions, not screens. « borrow a book », not « the loan page ».",
    reveals: "the real operations, and whether they are more than storage",
  },
  {
    id: "B3",
    question: "Are there situations where the system must REFUSE something? Which ones?",
    hint: "Not required fields or formats. Real refusals: « this book is already out », « this account has too little ».",
    reveals: "THE question that detects a domain. No refusal of that kind, no domain.",
  },
  {
    id: "B4",
    question: "Would a professional in the field understand those refusals without any talk of software?",
    hint: "A librarian, an accountant. If they nod, it is domain. If they cannot see why you are telling them, it is data entry.",
    reveals: "whether the refusals are business rules or validation in disguise",
  },
  {
    id: "B5",
    question: "Does the product talk to outside systems? Might you replace one some day?",
    hint: "Database, payment, email delivery, third-party service. And above all: which one will you REALLY replace.",
    reveals: "whether ports are justified, or would be insurance you never claim",
  },
  {
    id: "B6",
    question: "How many people or agents will work on it at the same time?",
    hint: "Count pipeline agents as people: they get in each other's way the same way.",
    reveals: "whether the layout should optimise for cohesion or for parallel work",
  },
  {
    id: "B7",
    question: "In your previous projects, what changed most often?",
    hint: "Screens, rules, integrations. Answer from experience, not from intention.",
    reveals: "what belongs at the centre, and what belongs at the edge",
  },
  {
    id: "B8",
    question: "What will the product NOT do?",
    hint: "What is not named is assumed built. That is true from the first conversation.",
    reveals: "the real scope, and often a business rule hidden inside an exclusion",
  },
];

/**
 * Verdicts an architecture can receive when faced with an analysed project.
 */
const VERDICT = {
  recommande: { label: "Recommended", rank: 0 },
  possible: { label: "Possible", rank: 1 },
  excessif: { label: "Excessive here", rank: 2 },
};

/**
 * Confronts an architecture with a project's analysis.
 *
 * The reasoning is explicit and handed to the operator: a recommendation
 * whose grounds cannot be seen is not discussed, it is accepted, which is
 * exactly what this mechanism exists to prevent.
 *
 * @param entry - catalogue architecture
 * @param analysis - project analysis drawn from the rough brief
 * @returns the verdict and the reasons grounding it
 */
export function judge(entry, analysis) {
  const rules = (analysis.business_rules ?? []).length;
  const swappable = (analysis.integrations ?? []).filter((item) => item.replaceable === true).length;
  const parallel = analysis.concurrent_workers === "few" || analysis.concurrent_workers === "teams";
  const reasons = [];
  let verdict = "possible";

  if (entry.id === "feature-modules") {
    verdict = "recommande";
    reasons.push(parallel ? `${analysis.concurrent_workers === "teams" ? "Several teams" : "Several people"} in parallel: one folder each, nobody collides.` : "Almost no cost, and nothing forces you out of it until a precise pain demands it.");
    if (rules > 0) reasons.push(`${rules} business rule(s) found: they fit inside their feature folder for as long as they are not shared.`);
  }

  if (entry.id === "layered") {
    if (parallel) {
      verdict = "excessif";
      reasons.push("Every feature crosses all three folders: with several people, everyone edits the same places.");
    } else {
      reasons.push("Readable by one person, and familiar.");
    }
  }

  if (entry.id === "hexagonal") {
    if (swappable === 0) {
      verdict = "excessif";
      reasons.push("No integration declared replaceable: ports would be insurance you never claim.");
    } else if (swappable >= 2) {
      verdict = "recommande";
      reasons.push(`${swappable} integrations you expect to replace: that is exactly the problem hexagonal solves.`);
    } else {
      reasons.push("A single replaceable integration: isolate that one, not everything else.");
    }
  }

  if (entry.id === "clean" || entry.id === "onion") {
    if (rules === 0) {
      verdict = "excessif";
      reasons.push("No business rule found: the layers would fill with objects copying rows around.");
    } else if (rules >= 8) {
      verdict = "recommande";
      reasons.push(`${rules} business rules: dense enough to justify isolating them from any technology.`);
    } else {
      verdict = "excessif";
      reasons.push(`${rules} business rule(s): that is an invariant to protect, not a domain to isolate. Protect it in the right place rather than adding layers.`);
    }
  }

  if (entry.id === "feature-sliced") {
    verdict = parallel ? "recommande" : "possible";
    reasons.push("Prevents circular imports in a codebase where everything tends to import everything.");
  }

  if (entry.id === "mvvm") {
    reasons.push("Screen logic is testable without launching the interface.");
  }

  if (entry.id === "mvi") {
    verdict = analysis.expected_churn === "screens" ? "possible" : "excessif";
    reasons.push(analysis.expected_churn === "screens" ? "Screens change often: reproducible state pays for itself." : "With no complicated screen state, the machinery costs more than it protects.");
  }

  return { verdict, label: VERDICT[verdict].label, rank: VERDICT[verdict].rank, reasons };
}

/**
 * Summarises what the analysis says about the project, in one quotable line.
 *
 * @param analysis - project analysis
 * @returns the summary sentence
 */
export function summarise(analysis) {
  const rules = (analysis.business_rules ?? []).length;
  const swappable = (analysis.integrations ?? []).filter((item) => item.replaceable === true).length;
  const domain = rules === 0 ? "no business rule" : rules < 8 ? `${rules} business rule(s) to protect` : `${rules} business rules, a dense domain`;
  const ports = swappable === 0 ? "no integration to replace" : `${swappable} replaceable integration(s)`;
  return `${domain}, ${ports}, ${analysis.concurrent_workers === "one" ? "a single person" : analysis.concurrent_workers === "teams" ? "several teams" : "a few people in parallel"}.`;
}
