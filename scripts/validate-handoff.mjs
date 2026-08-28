import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, loadRules, readJsonl, pathAllowed, sha256, generatedPaths, fail } from "./lib.mjs";
import { reviewDigest } from "./render-proposal.mjs";
import { dependencyDigest } from "./render-dependency.mjs";
import { tokensIn, offenders } from "./mockup-check.mjs";
import { gatesForIssue, laneOf } from "./gates.mjs";

/**
 * Where a finding can land, and what each destination costs.
 *
 * The mechanism had one destination — an issue in the product's backlog —
 * and closure was refused until one existed. Measured on a real run: 32
 * observations became 32 scheduled issues for 3 closed ones, so the backlog
 * grew by eleven for every issue finished. Making the debt opposable was
 * right; giving it a single exit is what made it diverge.
 */
const DISCOVERY_ROUTES = [
  "criterion",
  "regression",
  "delivery_blocker",
  "parking",
  "framework",
  "issue",
  "spec",
  "pitfall",
];

const BLOCKING_DISCOVERY_ROUTES = new Set(["criterion", "regression", "delivery_blocker", "spec"]);

/**
 * Refuses a criterion that designates something no one can point to.
 *
 * The failure this exists to prevent was measured: a criterion read « renders
 * its input with the fixed-pitch family and the right alignment FROM THE
 * TOKENS », naming two tokens in prose that the stylesheet did not carry.
 * Nothing checked it. The implementer found it eleven hours later, stopped
 * before writing a line, and the operator waited forty-one minutes to answer
 * a question a command could have asked at plan time.
 *
 * Two shapes are checkable exactly, and only those are checked. A token: if
 * a criterion speaks of tokens it must name them as `--name`, and each name
 * must exist in the declared stylesheet. A path: every file path a criterion
 * cites must exist on disk, or be reserved by the issue — which is how an
 * issue says it is about to create it.
 *
 * What is deliberately NOT checked: symbols. A criterion legitimately names
 * a component the issue creates, and refusing that would make the gate
 * impossible to satisfy on the first issue of any spec.
 *
 * @param handoff - the plan being validated
 * @param config - the project configuration
 * @param errors - accumulator of refusals
 * @returns nothing; pushes onto errors
 */
function checkCriteria(handoff, config, errors) {
  const sheetPath = config?.design_system?.tokens;
  let declaredTokens = null;
  if (typeof sheetPath === "string" && existsSync(sheetPath)) {
    declaredTokens = new Set(
      [...readFileSync(sheetPath, "utf8").matchAll(/(--[a-zA-Z][\w-]*)\s*:/g)].map((found) => found[1]),
    );
  }

  for (const item of handoff.issues ?? []) {
    const id = item?.id ?? "issue";
    const reserved = new Set(item?.file_reservations ?? []);
    for (const [index, criterion] of (item?.acceptance_criteria ?? []).entries()) {
      if (typeof criterion !== "string") continue;
      const named = [...criterion.matchAll(/(--[a-zA-Z][\w-]*)/g)].map((found) => found[1]);

      // The word is looked for in the PROSE, never inside a code span: a
      // criterion citing `src/tokens.css` was read as one speaking of tokens
      // and refused for naming none.
      const prose = criterion.replace(/`[^`]*`/g, " ");

      if (declaredTokens != null) {
        if (named.length === 0 && /\bjetons?\b|\btokens?\b/i.test(prose)) {
          errors.push(
            `${id} criterion ${index + 1} speaks of tokens and names none. Write them as \`--name\`, or the ` +
              "implementer discovers hours later that the ones you meant do not exist.",
          );
        }
        for (const token of named) {
          if (declaredTokens.has(token)) continue;
          errors.push(
            `${id} criterion ${index + 1} names ${token}, absent from ${sheetPath}. ` +
              "Declare it first, or name one that exists: a criterion nobody can satisfy stops the issue, " +
              "not the plan.",
          );
        }
      }

      for (const match of criterion.matchAll(/`([\w./-]+\.[a-z]{1,5})`/g)) {
        const cited = match[1];
        if (!cited.includes("/")) continue;
        if (existsSync(cited) || reserved.has(cited)) continue;
        errors.push(
          `${id} criterion ${index + 1} cites ${cited}, which exists nowhere and which the issue does not ` +
            "reserve. Reserve it if the issue creates it, or name the path that exists.",
        );
      }
    }
  }
}

/**
 * Says whether a role authors nothing, and therefore claims nothing.
 *
 * @param rules - the loaded rules
 * @param agent - the role that produced the handoff
 * @returns true when the role writes no commit
 */
function nonAuthoringAgent(rules, agent) {
  return (rules.non_authoring_agents ?? []).includes(agent);
}

/**
 * Says whether a shell command hands back a status that measures anything.
 *
 * A replay is a measurement, and a measurement whose exit code belongs to a
 * later command measures that command. Observed twice on a real run, and
 * reported by the agent itself: the replay ran the tests, then restored the
 * file, and the shell returned the restore's status. Both verdicts read
 * « replayed, exit 0 » for a claim asserting a failure — a sentence that
 * contradicts itself.
 *
 * `;` and `||` both hand the status to something other than the measure.
 * `&&` does not: the first command to fail ends the chain and its status is
 * the one returned, so nothing is hidden.
 *
 * Separators inside quotes are not separators. `node -e "a(); b()"` is one
 * command, and refusing it would make the rule impossible to satisfy in the
 * languages that need it most.
 *
 * @param command - the shell command as written
 * @returns true when the status returned cannot be attributed to the measure
 */
function masksItsExit(command) {
  const bare = String(command).replace(/"[^"]*"|'[^']*'|`[^`]*`/g, "");
  return /;|\|\|/.test(bare);
}

/**
 * Confronts a document with the page the operator is supposed to have read.
 *
 * The framework produced these pages with nothing requiring that they be
 * produced: a habit, therefore a rule that applied only on the days someone
 * thought of it. It is now backed by a command that fails, as
 * `approved_proposal` already is for phase 2.
 *
 * The page carries the digest of what it displays; it is recomputed here from
 * the document. A page rendered from older content therefore no longer
 * matches, and a document nobody rendered has nothing to present.
 *
 * The mechanism is shared between spec proposals and dependency requests
 * because the problem is shared: in both cases an agent submits a choice, and
 * in both cases the choice is only worth something if someone could read it.
 *
 * @param handoff - the submitted document
 * @param errors - list of errors to append to
 * @param digestOf - digest computation specific to the mode
 * @param meta - name of the tag the page carries
 * @param label - name of the document in the messages
 */
function checkPage(handoff, errors, digestOf, meta, label) {
  const page = handoff.review_page;
  if (page == null || typeof page.path !== "string" || page.path.length === 0) {
    errors.push(
      `review_page.path missing: nothing rendered this ${label} for the operator, so nobody read it. ` +
        "Render it, hand the page over, then declare it here.",
    );
    return;
  }
  if (!existsSync(page.path)) {
    errors.push(`review_page.path not found: ${page.path}`);
    return;
  }
  const marker = new RegExp(`name="${meta}" content="([0-9a-f]{64})"`);
  const rendered = readFileSync(page.path, "utf8").match(marker);
  if (rendered == null) {
    errors.push(
      `review_page ${page.path} carries no review digest: it was not produced by the matching renderer, ` +
        `so nothing confronts it with this ${label}.`,
    );
    return;
  }
  const expected = digestOf(handoff);
  if (rendered[1] !== expected) {
    errors.push(
      `review_page ${page.path} does not match this ${label}: page ${rendered[1].slice(0, 8)}, ` +
        `${label} ${expected.slice(0, 8)}. The content moved after rendering \u2014 render it again and have it re-read.`,
    );
  }
}

/**
 * Confronts a dependency request with what it must prove.
 *
 * The implementer prompt already asks that the reference library be
 * identified and that the reason for not using it be stated. Nothing checked
 * it: on this repository a validation library was assessed then set aside
 * inside a handoff, never submitted, and the operator found out by reading
 * the code of an already implemented issue.
 *
 * The required fields are the ones that cannot be filled in without having
 * looked. A licence, a last-release date, a count of open advisories: these
 * are measurements, not impressions, and their absence says they were not
 * taken.
 *
 * @param handoff - the submitted request
 * @param errors - list of errors to append to
 */
function checkDependencyAssessment(handoff, errors) {
  if (typeof handoff.need !== "string" || handoff.need.trim().length === 0) {
    errors.push("need missing: name the capability in product terms before naming a package");
  }
  if (typeof handoff.hand_rolled_cost !== "string" || handoff.hand_rolled_cost.trim().length === 0) {
    errors.push(
      "hand_rolled_cost missing: an operator cannot weigh a dependency without knowing what refusing it costs. " +
        "Say how much code it replaces, and on which surface.",
    );
  }
  const candidates = handoff.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    errors.push("candidates empty: a dependency is argued against real alternatives, not requested by name");
  } else {
    candidates.forEach((candidate, index) => {
      for (const field of ["name", "does", "license"]) {
        if (typeof candidate?.[field] !== "string" || candidate[field].length === 0) {
          errors.push(`candidates[${index}].${field} missing`);
        }
      }
      if (candidate?.maintenance?.last_release == null) {
        errors.push(`candidates[${index}].maintenance.last_release missing: a library that does the job and is unmaintained does not do the job`);
      }
      if (candidate?.security?.advisories_open == null) {
        errors.push(`candidates[${index}].security.advisories_open missing: its advisories become yours the day you install it`);
      }
      if (!Array.isArray(candidate?.security?.runtime_privileges)) {
        errors.push(`candidates[${index}].security.runtime_privileges missing: say what it reaches at runtime, network, disk or environment`);
      }
    });
  }
  if (!Array.isArray(handoff.alternatives_rejected) || handoff.alternatives_rejected.length === 0) {
    errors.push(
      "alternatives_rejected empty: something was always set aside, if only writing it by hand. " +
        "A rejection taken in silence is what this mode exists to surface.",
    );
  }
  checkPage(handoff, errors, dependencyDigest, "dependency-review-digest", "assessment");
}

/**
 * Shapes a file takes when it is a screen.
 *
 * Read by extension rather than by the architecture's layers: a screen is a
 * screen in `src/pages`, `src/ui` or anywhere else, and half the catalogue's
 * layouts declare no screen layer at all. The list is language-shaped, like
 * everything else here that has to recognise a file without parsing it.
 */
const SCREEN_SHAPES = /\.(svelte|vue|tsx|jsx)$/;

/**
 * The screens a set of paths carries.
 *
 * @param paths - files touched or reserved
 * @returns those that are screens
 */
function screensAmong(paths) {
  return (paths ?? []).filter((path) => typeof path === "string" && SCREEN_SHAPES.test(path));
}

/**
 * Refuses a mockup that is not a page anybody can open.
 *
 * The framework never renders a mockup: a drawing has no source, and a script
 * producing one would be inventing it. But it said nothing about the FORM, so
 * a real run pointed the field at a `.svelte` component and the check read it
 * happily. Every other decision reaches the operator as a page that opens on
 * its own, with no network and no dependency — and the one artefact they most
 * need to look at had no such convention.
 *
 * HTML is not a taste: the check reads token references out of the file, so a
 * form carrying none — an image, a PDF — cannot be checked at all.
 *
 * This one rule replaced a second one that refused any mockup the diff
 * carried, on the grounds that the code would be verified against itself.
 * Reading a real run killed it: the issue whose whole job is to DRAW the
 * mockup necessarily carries it, and the rule refused exactly the behaviour
 * the framework asks for. What it was really catching was a source file used
 * as a mockup, and the form check catches that without the false positive.
 *
 * @param path - the declared mockup path
 * @returns the refusal, or null when the form is right
 */
function wrongMockupForm(path) {
  if (/\.html?$/i.test(path)) return null;
  return (
    `mockup.path ${path} is not a page: a mockup is opened, not compiled. Every other decision reaches you ` +
    "as a self-contained HTML page, and this is the one you most need to look at. A component is also the " +
    "code, which is what makes the check circular."
  );
}

/**
 * The mockups a declaration names.
 *
 * A plan names one (`path`) or several (`paths`): a spec with two screens has
 * two drawings, and a single field would push the second issue to bring its
 * own — which is the shape the ownership rule below exists to prevent.
 *
 * @param mockup - the declared block, or a spec record's list
 * @returns the paths named, in order
 */
function declaredMockups(mockup) {
  if (mockup == null) return [];
  const listed = Array.isArray(mockup) ? mockup : Array.isArray(mockup.paths) ? mockup.paths : [];
  const single = !Array.isArray(mockup) && typeof mockup.path === "string" ? [mockup.path] : [];
  return [...single, ...listed].filter((path) => typeof path === "string");
}

/**
 * The mockups the spec record owns.
 *
 * Read from the store rather than from the handoff: the point is that the
 * issue cannot be the one who decides. A spec planned before this rule
 * declares none, and is not held to a list it never made — refusing those
 * would rewrite the history of a running project instead of describing it.
 *
 * @param specId - the spec the handoff belongs to
 * @param config - the loaded configuration
 * @returns the paths the spec declared, or null when it declared none
 */
function specMockups(specId, config) {
  if (typeof specId !== "string") return null;
  let records;
  try {
    records = readJsonl(join(config.store_dir, "specs.jsonl"));
  } catch {
    return null;
  }
  const spec = records.map((entry) => entry.record).find((record) => record?.id === specId);
  const declared = declaredMockups(spec?.mockups);
  return declared.length > 0 ? declared : null;
}

/**
 * Confronts a built screen with the mockup it was built against.
 *
 * The design-system page states the order: tokens, primitives, then a mockup
 * assembled from the primitives that exist, then screens. Nothing made the
 * last step depend on the one before it. An implementer could code a screen
 * having seen no mockup at all, and the only trace of that would be an
 * interface nobody had looked at before it existed.
 *
 * The exit is explicit rather than inferred. This validator cannot tell a
 * visual issue from a data-layer one, and guessing from the touched paths
 * would be wrong on the first refactor. `mockup.not_applicable` carries a
 * reason, and a reason someone had to write is a reason someone had to mean.
 *
 * The mockup is also re-checked here, not trusted. A file approved a week ago
 * and edited since is exactly the case a declaration alone cannot catch.
 *
 * @param handoff - the submitted handoff
 * @param errors - list of errors to append to
 */
function checkMockup(handoff, errors) {
  let config;
  try {
    config = loadConfig();
  } catch {
    return;
  }
  if (!["frontend", "mobile", "fullstack"].includes(config.architecture?.project_type)) return;
  if (handoff.evidence?.commit_sha == null) return;

  const mockup = handoff.mockup;
  if (mockup == null || (typeof mockup.path !== "string" && typeof mockup.not_applicable !== "string")) {
    errors.push(
      "mockup missing: this project has screens, and a screen coded from memory is an interface nobody " +
        "looked at before it existed. Declare mockup.path, or mockup.not_applicable with the reason this " +
        "issue touches none.",
    );
    return;
  }
  if (typeof mockup.not_applicable === "string") {
    if (mockup.not_applicable.trim().length === 0) {
      errors.push("mockup.not_applicable is empty: an exemption nobody had to justify is an exemption always taken");
    }
    // The exemption is a claim about the diff, and the diff can be read. On a
    // real run no mockup was ever produced and the screens were built anyway:
    // the requirement lands on the implementer, at the last possible moment,
    // where the only affordable answer is the escape.
    const shipped = screensAmong(handoff.evidence?.files);
    if (shipped.length > 0) {
      errors.push(
        `mockup.not_applicable claims this issue touches no screen, and its diff carries ${shipped.join(", ")}. ` +
          "Name the mockup these were built against.",
      );
    }
    return;
  }
  const form = wrongMockupForm(mockup.path);
  if (form != null) {
    errors.push(form);
    return;
  }
  if (!existsSync(mockup.path)) {
    errors.push(`mockup.path not found: ${mockup.path}`);
    return;
  }
  // The whole belongs to the spec. Asking each handoff for a mockup invites
  // one drawing per issue, and issues are cut by component: five drawings that
  // never compose are not a design. A real run got this right on its own — two
  // issues pointing at the same screen — but nothing made it the only shape
  // available, so it held by the agent's discipline rather than by a rule.
  const owned = specMockups(handoff.scope?.spec_id, config);
  if (owned != null && !owned.includes(mockup.path)) {
    errors.push(
      `mockup.path ${mockup.path} is not one ${handoff.scope.spec_id} declared (${owned.join(", ")}). The spec ` +
        "owns the mockup: an issue points at one the plan named, it does not draw its own. Screens cut by " +
        "component each get their own drawing that way, and nothing composes them back into an interface.",
    );
    return;
  }
  const tokensPath = config.design_system?.tokens;
  if (typeof tokensPath !== "string" || !existsSync(tokensPath)) {
    errors.push(`design_system.tokens not readable: nothing to check ${mockup.path} against`);
    return;
  }
  const declared = tokensIn(readFileSync(tokensPath, "utf8"));
  const { found } = offenders(readFileSync(mockup.path, "utf8"), declared);
  for (const item of found) {
    errors.push(`mockup ${mockup.path}: ${item.kind} ${item.raw} traces to no declared token`);
  }
}

/**
 * Confronts an escalation with what it must report.
 *
 * Three code rejections escalate rather than paying for a fourth cycle, and
 * that is the right behaviour: a pipeline that changed approach on its own
 * would take a design decision without the person who owns the product.
 *
 * But the escalation said only that the pipeline was stuck. The operator
 * received a stop, not an account, and the first thing they would suggest is
 * usually one of the approaches already tried and already failed. Three
 * cycles were paid for; reporting none of them hides all three from the only
 * person who can now decide.
 *
 * `attempts` carries one entry per approach, each with what was tried and
 * why it failed. The count is confronted with `qa_code_rejections`: a report
 * shorter than the number of failures leaves some of them unaccounted for.
 *
 * @param handoff - the submitted handoff
 * @param errors - list of errors to append to
 */
function checkEscalation(handoff, errors) {
  if (handoff.requested_transition?.to !== "operator_escalation") return;

  const attempts = handoff.attempts;
  if (!Array.isArray(attempts) || attempts.length === 0) {
    errors.push(
      "attempts empty: an escalation reports, it does not merely stop. Without it the operator receives " +
        "the fact of failure and nothing else, and the first thing they suggest is usually an approach " +
        "already tried. One entry per approach, each with approach and failed_because.",
    );
    return;
  }

  attempts.forEach((attempt, index) => {
    for (const field of ["approach", "failed_because"]) {
      if (typeof attempt?.[field] !== "string" || attempt[field].trim().length === 0) {
        errors.push(`attempts[${index}].${field} missing`);
      }
    }
  });

  const rejections = handoff.qa_code_rejections;
  if (Number.isInteger(rejections) && attempts.length < rejections) {
    errors.push(
      `attempts reports ${attempts.length} approach(es) for ${rejections} rejection(s): the cycles were paid ` +
        "for, and the ones left out are exactly what the operator would try first.",
    );
  }
}

/**
 * Confronts a cross-spec decision with the journal that must outlive its spec.
 *
 * `architecture_decision_proposal` was named in the documents and prescribed
 * to Product for exactly this case, and the validator did not know it —
 * neither did it refuse unknown modes, so such a handoff passed unseen and
 * none of its rules ever applied.
 *
 * The consequence was observed on a real run: an orchestrator recorded that
 * the interface layer lives outside the adapters, the reason was sound, and
 * the decision reached only that spec's store record. The Product of the next
 * spec would never have seen it, and would have decided again, differently.
 *
 * A decision therefore names the journal entry that carries it, the entry has
 * to sit inside `decisions_dir`, and its text has to carry the reason. Filed
 * elsewhere, or filed without the why, it is a decision nobody will apply and
 * nobody can argue with.
 *
 * @param handoff - the submitted proposal
 * @param errors - list of errors to append to
 */
function checkDecision(handoff, errors) {
  const decision = handoff.decision;
  for (const field of ["title", "because", "consequences"]) {
    if (typeof decision?.[field] !== "string" || decision[field].trim().length === 0) {
      errors.push(`decision.${field} missing`);
    }
  }

  const record = handoff.journal_entry;
  if (record == null || typeof record.path !== "string" || record.path.length === 0) {
    errors.push(
      "journal_entry.path missing: a cross-spec decision recorded only on this spec dies with it, and the " +
        "next spec decides again, differently. Write the entry in the decisions journal and name it here.",
    );
    return;
  }

  let config;
  try {
    config = loadConfig();
  } catch {
    return;
  }
  const journal = config.decisions_dir;
  const normalised = record.path.split("\\").join("/");
  if (typeof journal === "string" && !normalised.startsWith(`${journal.split("\\").join("/")}/`)) {
    errors.push(
      `journal_entry.path is outside ${journal}: a decision filed elsewhere is a decision the next Product will not read`,
    );
    return;
  }
  if (!existsSync(record.path)) {
    errors.push(`journal_entry.path not found: ${record.path}`);
    return;
  }
  const body = readFileSync(record.path, "utf8");
  if (decision?.because != null && !body.includes(decision.because)) {
    errors.push(
      `${record.path} does not carry the reason this decision was taken. A decision without its why is ` +
        "one nobody can argue with, and therefore one the next reader either obeys blindly or ignores.",
    );
  }
}

/**
 * Validates an agent handoff against the machine source of the rules.
 *
 * Checks the shape, the emitting role, the requested transition, the context
 * heading allowed for that role, the coherence of QA fault routing, and the
 * declared paths against the role's file policy. It does not check the real
 * diff: that is verify-scope.mjs's job.
 *
 * A spec goes through two modes with the operator between them.
 * `spec_proposal` submits the choices and carries no issue; `spec_plan`
 * requires `approved_proposal` and confronts its `digest_sha256` with the
 * real content of the approved file. Product therefore cannot deliver a
 * persistable plan derived from a proposal nobody read, and a decomposition
 * written before the agreement makes the owner discover the product once it
 * is too expensive to change.
 *
 * Usage: node validate-handoff.mjs <handoff.json>
 */
function main() {
  const handoffPath = process.argv[2];
  if (!handoffPath) fail("usage : validate-handoff.mjs <handoff.json>");
  const handoff = JSON.parse(readFileSync(handoffPath, "utf8"));
  const rules = loadRules();
  const errors = [];

  for (const field of ["schema_version", "mode", "agent", "scope", "basis", "outcome"]) {
    if (handoff[field] == null) errors.push(`missing field: ${field}`);
  }

  // A handoff said nothing about when it was written. Several sat side by
  // side with no way to order them, and no way to tell a fresh one from a
  // file left over from an earlier attempt. This date is for legibility, not
  // for measurement: the timings come from the orchestrator's own stamps,
  // because nothing here trusts an agent's account of its own clock.
  const produced = handoff.produced_at;
  if (typeof produced !== "string" || Number.isNaN(Date.parse(produced))) {
    errors.push("produced_at missing or unreadable: say when this handoff was written, as an ISO 8601 date");
  } else if (Date.parse(produced) > Date.now() + 60_000) {
    errors.push(`produced_at ${produced} is in the future: a handoff written later than now is a clock or a guess`);
  }
  if (handoff.scope?.issue_id == null && handoff.mode === "issue_handoff") {
    errors.push("scope.issue_id missing");
  }
  if (handoff.basis?.record_hash == null) errors.push("basis.record_hash missing");
  if (handoff.mode === "issue_handoff" && handoff.basis?.pipeline_version == null) {
    errors.push("basis.pipeline_version missing");
  }

  const agent = handoff.agent;
  if (handoff.mode === "issue_handoff") {
    const transition = handoff.requested_transition;
    if (transition?.from == null || transition?.to == null) {
      errors.push("requested_transition.from/to manquants");
    } else {
      if (!rules.transitions.includes(`${transition.from}->${transition.to}`)) {
        errors.push(`transition interdite : ${transition.from}->${transition.to}`);
      }
      const sources = rules.transition_source[agent] ?? [];
      if (!sources.includes(transition.from)) {
        errors.push(`role ${agent} cannot leave phase ${transition.from}`);
      }
    }

    const heading = handoff.context?.heading;
    const isClosure = transition?.to === "closed";
    if (!isClosure) {
      const allowed = rules.context_headings[agent] ?? [];
      if (heading == null) errors.push("context.heading missing");
      else if (!allowed.includes(heading)) errors.push(`heading forbidden for ${agent}: ${heading}`);
      if (!handoff.context?.body) errors.push("context.body missing");
    }

    // An escalation is not a routed fault. Every fault in the table sends the
    // issue back to a role; an escalation sends it to the operator, precisely
    // because no role is going to fix it on a fourth cycle. The rules declared
    // the transition and the QA prompt prescribed it, yet the fault routing
    // below made it unrepresentable: any escalation QA submitted was refused,
    // whatever it carried. What it must carry instead is checked separately.
    const isEscalation = transition?.to === "operator_escalation";
    if (agent === "qa" && !isClosure && !isEscalation) {
      const fault = handoff.fault;
      if (fault == null) errors.push("a QA rejection carries a fault");
      else if (fault === "code") {
        const regression = handoff.regression;
        if (regression == null) errors.push("fault code with no regression block");
        else if (regression.required === true) {
          const route = rules.code_fault_routing.regression_required;
          if (transition?.to !== route.to) errors.push(`fault code required:true routes to ${route.to}`);
          if (heading !== route.heading) errors.push(`fault code required:true requires the heading ${route.heading}`);
          if (!regression.criterion) errors.push("regression.criterion missing");
        } else if (regression.required === false) {
          const route = rules.code_fault_routing.regression_waived;
          if (transition?.to !== route.to) errors.push(`fault code required:false routes to ${route.to}`);
          if (heading !== route.heading) errors.push(`fault code required:false requires the heading ${route.heading}`);
          if (!regression.reason) errors.push("regression.reason missing");
        } else errors.push("regression.required must be true or false");
      } else {
        const target = rules.fault_routing[fault];
        if (target == null) errors.push(`unknown fault: ${fault}`);
        else if (transition?.to !== target) errors.push(`fault ${fault} routes to ${target}, not ${transition?.to}`);
      }
    }
    if (agent === "qa" && isClosure && handoff.fault != null) {
      errors.push("an approval carries no fault");
    }

    const vocabulary = rules.criterion_status;
    if (agent === "qa" && vocabulary != null) {
      const ledger = handoff.criteria_ledger;
      if (ledger == null) {
        errors.push(
          "criteria_ledger missing: QA writes the verified state of every criterion, observed in the environment",
        );
      } else {
        for (const [index, item] of ledger.entries()) {
          if (!vocabulary.values.includes(item?.status)) {
            errors.push(`criteria_ledger[${index}]: unknown status ${item?.status}`);
            continue;
          }
          if (vocabulary.evidence_required_for.includes(item.status) && !item.evidence) {
            errors.push(`criteria_ledger[${index}]: ${item.status} requires observed evidence`);
          }
          if (isClosure && item.status !== vocabulary.closable) {
            errors.push(
              `closure requested while criterion ${index + 1} is ${item.status}: an issue does not close on an unverified criterion`,
            );
          }
        }
      }
    }

    if (agent === "implementer" && handoff.evidence?.commit_sha != null) {
      const claims = handoff.claims_to_replay;
      if (!Array.isArray(claims) || claims.length === 0) {
        errors.push(
          "claims_to_replay empty: a handoff carrying a commit enumerates what it ASSERTS, so QA knows what to replay instead of reading a story",
        );
      } else {
        for (const [index, item] of claims.entries()) {
          for (const field of ["claim", "how_to_replay"]) {
            if (!item?.[field]) errors.push(`claims_to_replay[${index}].${field} missing`);
          }
        }
      }
    }

    // A replay whose status belongs to a later command measures that command.
    for (const [index, item] of (handoff.claims_to_replay ?? []).entries()) {
      if (typeof item?.how_to_replay !== "string" || !masksItsExit(item.how_to_replay)) continue;
      errors.push(
        `claims_to_replay[${index}].how_to_replay hands its exit code to something other than the measure: ` +
          "`;` and `||` return the LAST command's status, so a restore at the end reports the restore. " +
          "Put the restore first, use `&&`, or replay in a detached worktree.",
      );
    }
    const redCommand = handoff.evidence?.red_proof?.cmd;
    if (typeof redCommand === "string" && masksItsExit(redCommand)) {
      errors.push(
        "evidence.red_proof.cmd hands its exit code to something other than the test run: a red proof whose " +
          "status comes from a restore proves the restore.",
      );
    }

    // Two issues of one real spec closed with the same hole: no automated
    // test reached the route actions. The field existed in the handoffs and
    // the framework read it nowhere, so nothing accumulated it and nothing
    // said the hole was the same one twice. Saying there is none is an
    // answer, and it has to be said.
    if (handoff.evidence?.commit_sha != null && !nonAuthoringAgent(rules, agent)) {
      const surface = handoff.untested_surface;
      if (typeof surface !== "string" || surface.trim().length === 0) {
        errors.push(
          "untested_surface missing: name what this change leaves unproved, or say there is nothing. " +
            "A hole nobody wrote down is a hole nobody counts, and the same one closed two issues in a row.",
        );
      }
    }

    if (agent === "implementer" && transition?.to === "ready_for_qa") {
      // Measured on a real run: the implementer cited two gates out of eight,
      // QA replayed the rest, one refused, and the issue came back. A whole
      // cycle for something the handover could have been refused for.
      const config = loadConfig();
      const cited = new Map(
        (handoff.evidence?.commands ?? [])
          .filter((item) => typeof item?.key === "string")
          .map((item) => [item.key, item.exit]),
      );
      for (const key of gatesForIssue(handoff.evidence?.files ?? [], config)) {
        if (cited.get(key) === 0) continue;
        errors.push(
          cited.has(key)
            ? `evidence.commands: ${key} exits ${cited.get(key)}, so it found something. A handover cites a green battery.`
            : `evidence.commands does not carry ${key}, which this project runs on every issue. ` +
                "Run it before handing over, or QA discovers it and the issue comes back.",
        );
      }
    }

    if (agent === "qa" && transition?.to === "closed") {
      const config = loadConfig();
      // What a closure owes follows what the issue touched. A stylesheet and
      // an authentication path were paying the same price: on a measured run,
      // adding CSS variables cost the same six replayed claims and the same
      // ledger as wiring four interactive components. That is not rigour, it
      // is an absence of proportion.
      const lane = laneOf(handoff.reviewed_files ?? [], config.risk);

      // The battery is computed from the project's own table, minus what the
      // closure defers. A gate cited with a non-zero exit did not run: it
      // found something.
      const cited = new Map(
        (handoff.evidence?.commands ?? [])
          .filter((item) => typeof item?.key === "string")
          .map((item) => [item.key, item.exit]),
      );
      for (const key of gatesForIssue(handoff.reviewed_files ?? [], config)) {
        if (cited.get(key) === 0) continue;
        errors.push(
          cited.has(key)
            ? `evidence.commands: ${key} exits ${cited.get(key)}, so it found something. A closure cites a green battery.`
            : `evidence.commands does not carry ${key}, which this project runs on every issue. ` +
                "Cite it with its exit code, or say why the issue's diff cannot reach it.",
        );
      }

      const verdicts = handoff.claims_verdict;
      if (lane === "low") {
        // Nothing more is owed. The gates ran, the criteria are in the
        // ledger, and replaying six claims about a stylesheet proves the
        // stylesheet twice.
      } else if (!Array.isArray(verdicts) || verdicts.length === 0) {
        errors.push(
          "claims_verdict empty: a closure confronts every implementer claim, it does not believe it",
        );
      } else {
        for (const [index, item] of verdicts.entries()) {
          if (!item?.claim) errors.push(`claims_verdict[${index}].claim missing`);
          if (item?.replayed !== true) {
            errors.push(
              `claims_verdict[${index}] not replayed: an unreplayed claim blocks the closure, it does not slow it down`,
            );
          }
          if (!item?.result) errors.push(`claims_verdict[${index}].result missing`);
        }
      }
    }

    const redRule = rules.red_proof;
    if (redRule != null && agent === redRule.agent && transition?.to === redRule.outcome) {
      const proof = handoff.evidence?.red_proof;
      if (proof == null) {
        errors.push(
          "evidence.red_proof missing: a role writing both its tests and its code must prove the red phase it observed",
        );
      } else {
        for (const field of redRule.fields) {
          if (proof[field] == null) errors.push(`evidence.red_proof.${field} missing`);
        }
        if (proof.observed_before_implementation !== true) {
          errors.push("evidence.red_proof.observed_before_implementation must be true");
        }
        if (typeof proof.test_commit_sha !== "string" || proof.test_commit_sha.trim().length === 0) {
          errors.push("evidence.red_proof.test_commit_sha must name the test commit");
        }
        if (proof.exit === 0) {
          errors.push("evidence.red_proof.exit is 0: the test was never red");
        }
      }
    }
  }

  // A finding used to have one destination: an issue in the product's
  // backlog, and closure was refused until one existed. Measured on a real
  // run, that turned 32 observations into 32 scheduled issues for 3 closed
  // ones — a backlog that cannot converge. A finding is now routed, and only
  // one of the four routes is product work.
  if (handoff.discoveries != null) {
    if (!Array.isArray(handoff.discoveries)) {
      errors.push("discoveries must be a list");
    } else {
      for (const [index, item] of handoff.discoveries.entries()) {
        if (!item?.title) errors.push(`discoveries[${index}].title missing`);
        if (!item?.rationale) {
          errors.push(
            `discoveries[${index}].rationale missing: a finding with no rationale is not actionable`,
          );
        }
        const lands = item?.lands ?? "parking";
        if (!DISCOVERY_ROUTES.includes(lands)) {
          errors.push(
            `discoveries[${index}].lands "${lands}" is not a destination: ${DISCOVERY_ROUTES.join(", ")}.`,
          );
        } else if ((lands === "regression" || lands === "issue") && !item.breaks) {
          errors.push(
            `discoveries[${index}].breaks missing: a regression names the criterion or symbol it breaks.`,
          );
        } else if ((lands === "criterion" || lands === "spec") && !item.criterion) {
          errors.push(
            `discoveries[${index}].criterion missing: say which criterion the finding contradicts, or ` +
              "Product cannot amend anything.",
          );
        } else if (lands === "delivery_blocker" && !item.blocked_because) {
          errors.push(
            `discoveries[${index}].blocked_because missing: a delivery blocker names what cannot ship safely.`,
          );
        }
        if (handoff.requested_transition?.to === "closed" && BLOCKING_DISCOVERY_ROUTES.has(lands)) {
          errors.push(
            `discoveries[${index}] lands as ${lands} and cannot accompany closure. Route the issue to the ` +
              "responsible role; only parked or framework findings travel with a validation.",
          );
        }
      }
    }
  }

  // A mode the validator does not know used to pass through: none of its
  // rules applied, and nothing said so. That is how `architecture_decision_
  // proposal` lived for months as an instruction in Product's prompt with no
  // implementation behind it. An unknown mode is now a refusal, so the gap
  // between what the prompts prescribe and what the validator enforces
  // cannot open silently again.
  const KNOWN_MODES = [
    "spec_proposal",
    "spec_plan",
    "issue_handoff",
    "dependency_assessment",
    "architecture_decision_proposal",
    "pr_result",
  ];
  if (!KNOWN_MODES.includes(handoff.mode)) {
    errors.push(
      `mode "${handoff.mode}" is not one this validator knows. Known: ${KNOWN_MODES.join(", ")}. ` +
        "A mode that passes unseen is a mode whose rules were never applied.",
    );
  }

  if (handoff.mode === "architecture_decision_proposal") {
    checkDecision(handoff, errors);
  }

  checkEscalation(handoff, errors);

  if (handoff.mode === "issue_handoff" && handoff.agent === "implementer") {
    checkMockup(handoff, errors);
  }

  if (handoff.mode === "dependency_assessment") {
    checkDependencyAssessment(handoff, errors);
  }

  if (handoff.mode === "spec_proposal") {
    checkPage(handoff, errors, reviewDigest, "proposal-review-digest", "proposal");
    if (!Number.isInteger(handoff.round) || handoff.round < 1) {
      errors.push("round missing or invalid: a proposal is counted in rounds, the first one is 1");
    }
    if (handoff.round > 1 && handoff.operator_feedback == null) {
      errors.push(
        `round ${handoff.round} with no operator_feedback: a round that does not say what the operator asked is not a round, it is a rewrite`,
      );
    }
    const answered = handoff.operator_feedback?.decided ?? [];
    if (answered.length >= 2) {
      const check = handoff.answers_composition_check;
      if (check == null) {
        errors.push(
          `answers_composition_check missing: this round answers ${answered.length} decisions, and two answers defensible on their own may not be defensible together`,
        );
      } else {
        if (!Array.isArray(check.pairs_checked) || check.pairs_checked.length === 0) {
          errors.push("answers_composition_check.pairs_checked empty: name the pairs confronted, do not assert that you looked");
        } else {
          for (const [index, pair] of check.pairs_checked.entries()) {
            if (!Array.isArray(pair?.pair) || pair.pair.length < 2) {
              errors.push(`answers_composition_check.pairs_checked[${index}].pair must name at least two decisions`);
            }
            if (typeof pair?.composes !== "boolean") {
              errors.push(`answers_composition_check.pairs_checked[${index}].composes must be true or false`);
            }
            if (pair?.composes === false && !pair?.note) {
              errors.push(
                `answers_composition_check.pairs_checked[${index}]: a non-composing pair carries its reason, otherwise it is lost`,
              );
            }
          }
        }
        if (!Array.isArray(check.conflicts_found)) {
          errors.push("answers_composition_check.conflicts_found missing: an absence of conflict is declared, not assumed");
        }
      }
    }
    const scope = handoff.functional_scope;
    if (scope == null) {
      errors.push(
        "functional_scope missing: the functional scope is validated before any contract and any decomposition",
      );
    } else {
      if (!Array.isArray(scope.features) || scope.features.length === 0) {
        errors.push("functional_scope.features empty");
      } else {
        for (const [index, feature] of scope.features.entries()) {
          for (const field of ["name", "user_value", "rules"]) {
            if (feature?.[field] == null) errors.push(`functional_scope.features[${index}].${field} missing`);
          }
          if (Array.isArray(feature?.rules) && feature.rules.length === 0) {
            errors.push(
              `functional_scope.features[${index}].rules empty: a feature with no business rule cannot be validated`,
            );
          }
        }
      }
      if (!Array.isArray(scope.out_of_scope)) {
        errors.push(
          "functional_scope.out_of_scope missing: what is not built is stated, otherwise the client assumes it is",
        );
      }
    }
    const decisions = handoff.decisions_for_operator;
    if (!Array.isArray(decisions)) {
      errors.push("decisions_for_operator missing or not a list");
    } else if (decisions.length === 0 && handoff.scope_final !== true) {
      errors.push(
        "decisions_for_operator empty: a proposal submitting no choice is a decision already taken. If the scope really is settled, declare scope_final: true. Silence is stated, not assumed",
      );
    } else {
      for (const [index, item] of decisions.entries()) {
        for (const field of ["question", "product_recommendation", "alternatives"]) {
          if (item?.[field] == null) errors.push(`decisions_for_operator[${index}].${field} missing`);
        }
        if (Array.isArray(item?.alternatives) && item.alternatives.length === 0) {
          errors.push(
            `decisions_for_operator[${index}].alternatives empty: a choice with no other option is not a choice`,
          );
        }
      }
    }
    if ((handoff.issues ?? []).length > 0) {
      errors.push(
        "a proposal carries no issues: the decomposition is paid for after the agreement, not before",
      );
    }
  }

  if (handoff.mode === "spec_plan") {
    const approved = handoff.approved_proposal;
    if (approved == null) {
      errors.push(
        "approved_proposal missing: a plan derives from a proposal the operator saw, never from an intention",
      );
    } else {
      if (approved.approved_at == null) errors.push("approved_proposal.approved_at missing");
      if (!Number.isInteger(approved.round) || approved.round < 1) {
        errors.push("approved_proposal.round missing: a precise round is approved, not a conversation");
      }
      const path = approved.path;
      if (path == null) errors.push("approved_proposal.path missing");
      else if (!existsSync(path)) errors.push(`approved_proposal.path not found: ${path}`);
      else {
        const actual = sha256(readFileSync(path, "utf8"));
        if (actual !== approved.digest_sha256) {
          errors.push(
            `approved_proposal.digest_sha256 does not match the content of ${path}: declared ${approved.digest_sha256}, computed ${actual}`,
          );
        }
      }
    }
  }

  // An issue that reserves a generated path holds a file no agent writes,
  // and holds it against every other issue that adds an export. One line in
  // a plan, and the whole wave runs in series.
  const generated = new Set(generatedPaths(loadConfig()));
  for (const item of handoff.issues ?? []) {
    for (const path of item?.file_reservations ?? []) {
      if (!generated.has(path)) continue;
      errors.push(
        `${item.id ?? "issue"} reserves ${path}, a generated path. It is regenerated by the orchestrator ` +
          "after the issue closes; reserved, it serialises every issue that touches the source tree.",
      );
    }
  }

  if (handoff.mode === "spec_plan") {
    const planned = loadConfig();
    checkCriteria(handoff, planned, errors);
    // Asking the implementer is asking too late. Product is the one who can
    // still have a mockup drawn, and the operator is the one who should see it
    // before the screens exist — which is the order the design-system page
    // teaches and nothing enforced.
    if (["frontend", "mobile", "fullstack"].includes(planned.architecture?.project_type)) {
      const screens = (handoff.issues ?? []).flatMap((item) =>
        screensAmong(item?.file_reservations).map((path) => ({ id: item.id ?? "issue", path })),
      );
      const named = declaredMockups(handoff.mockup);
      if (screens.length > 0 && named.length === 0 && typeof handoff.mockup?.not_applicable !== "string") {
        for (const screen of screens) {
          errors.push(
            `${screen.id} reserves ${screen.path}, a screen, and the plan names no mockup. Draw it before the ` +
              "screens exist, or the only answer left to the implementer is the exemption.",
          );
        }
      }
      for (const path of named) {
        const planForm = wrongMockupForm(path);
        if (planForm != null) errors.push(planForm);
        else if (!existsSync(path)) errors.push(`mockup.path not found: ${path}`);
      }
    }
  }

  const policy = rules.file_policy?.[agent];
  const nonAuthoring = (rules.non_authoring_agents ?? []).includes(agent);
  if (
    !nonAuthoring &&
    handoff.evidence?.commit_sha != null &&
    (handoff.evidence.files ?? []).length === 0
  ) {
    errors.push("a handoff with a commit_sha declares its files in evidence.files");
  }
  if (nonAuthoring && handoff.evidence?.commit_sha != null) {
    errors.push(
      `role ${agent} produces no commit: evidence.commit_sha must be null, the sha lives in pipeline_state.last_commit_sha`,
    );
  }
  for (const file of handoff.evidence?.files ?? []) {
    if (!pathAllowed(file, policy)) errors.push(`path outside role ${agent}: ${file}`);
  }

  if (errors.length > 0) {
    for (const error of errors) console.error(`invalid: ${error}`);
    process.exit(1);
  }
  console.log(`handoff valid (${agent}, ${handoff.mode}, outcome ${handoff.outcome})`);
}

main();
