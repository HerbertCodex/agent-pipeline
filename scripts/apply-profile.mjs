import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { loadConfig, loadRules, pathAllowed, deferredGates, fail } from "./lib.mjs";
import { ARCHITECTURES, PROJECT_TYPES } from "./architectures.mjs";
import { stripUndeclaredGates, orphanGates, perIssueGates, gatesForIssue, closureGates } from "./gates.mjs";
import { adaptPrompt, promptAdapter, rendersClaudeEntry } from "./runtime-adapters.mjs";

const CI_TEMPLATE = "agent-pipeline/templates/ci.template.yml";
const AGENTS_TEMPLATE = "agent-pipeline/templates/AGENTS.template.md";
const PROMPTS_SRC = "agent-pipeline/prompts";
const CLAUDE_TEMPLATE = "agent-pipeline/templates/CLAUDE.template.md";
const SKILLS_SRC = "agent-pipeline/skills";
const RULES_SRC = "agent-pipeline/schemas/rules.json";
const CI_OUT = ".github/workflows/ci.yml";
const AGENTS_OUT = "AGENTS.md";
const CLAUDE_OUT = "CLAUDE.md";
const PORTING_GUIDE = "agent-pipeline/docs/nouveau-profil.md";
const ROLES = ["orchestrator", "product", "implementer", "qa"];

/**
 * Renders `AGENTS.md` from its template and the profile invariants.
 *
 * The document had always announced itself as assembled from its template,
 * yet nothing assembled it: it was written by hand, free to drift from its
 * source with nothing to report it. It is level 2 of the priority order,
 * above the prompts, and the last place where a silent drift is acceptable.
 *
 * The invariants live per profile rather than in the template, because they
 * are the only part of the document that speaks of the stack. Changing stack
 * means writing that one file, and nothing else.
 *
 * @param config - project configuration
 * @returns the rendered content of AGENTS.md
 */
function renderAgents(config) {
  if (!existsSync(AGENTS_TEMPLATE)) fail(`not found: ${AGENTS_TEMPLATE}`);

  const invariantsPath = join(config.profiles_dir, config.profile, "invariants.md");
  if (!existsSync(invariantsPath)) {
    fail(
      `not found: ${invariantsPath}\n` +
        `Profile "${config.profile}" has no invariants. A profile with no invariants would render ` +
        `an AGENTS.md whose section 9 is empty, therefore a policy silent about the stack.\n` +
        `Writing that file is the first step of ${PORTING_GUIDE}.`,
    );
  }

  const pitfallsPath = join(config.profiles_dir, config.profile, "pitfalls.md");
  if (!existsSync(pitfallsPath)) {
    fail(
      `not found: ${pitfallsPath}\n` +
        "This is where a trap already paid for is written down, and it is what an escaped defect must " +
        "leave behind: store-verify refuses to close an issue carrying escaped_from unless it names a " +
        "gate that now refuses the defect, or a line in this file. Without the file, counting escapes " +
        "is all the pipeline ever does with them.\n" +
        "Create it, empty if nothing has been paid for yet.",
    );
  }

  const invariants = readFileSync(invariantsPath, "utf8").trim();
  if (invariants.length === 0) fail(`${invariantsPath} is empty`);

  const qualityDescriptions = {
    tracker_sync: "Issue-source drift",
    dead_code: "Dead code",
    sast: "Static security analysis",
    doc_lint: "Documentation contracts",
    comment_policy: "Forbidden narration",
    design_limits: "Measured design limits",
  };
  const qualityGates = Object.entries(qualityDescriptions)
    .filter(([key]) => typeof config.commands?.[key] === "string")
    .map(([key, description]) => `- ${description} (\`${key}\`).`)
    .join("\n");
  const ciPolicy = config.ci?.provider === "none"
    ? "No remote CI is configured. Local gate results are evidence only for the machine and SHA on which they ran; a merge has no remote proof until the operator configures a provider."
    : "The generated CI replays regular commands on pushes and deferred closure gates on pull requests. The orchestrator pushes the spec branch after each persistence carrying a commit. A green run on the exact SHA is proof; QA reads it instead of re-running, and re-runs only what CI does not cover or when no run exists.";

  let text = readFileSync(AGENTS_TEMPLATE, "utf8")
    .replaceAll("{{profile}}", config.profile)
    .replaceAll("{{profile_invariants}}", invariants)
    .replaceAll("{{ci_policy}}", ciPolicy)
    .replaceAll("{{quality_gates}}", qualityGates || "- No optional framework quality gate is configured.");

  const unresolved = text.match(/\{\{[a-z._]+\}\}/);
  if (unresolved) fail(`${AGENTS_TEMPLATE}: unresolved variable ${unresolved[0]}`);
  text = stripUndeclaredGates(text, config);
  const orphans = orphanGates(text, config);
  if (orphans.length > 0) {
    fail(`${AGENTS_TEMPLATE}: rendered policy names undeclared gates: ${orphans.join(", ")}`);
  }
  return text;
}

/**
 * Extracts a named block from the project's context source.
 *
 * Same idiom as the `<!-- brief:<roles> -->` tags read by sync-briefs: a
 * document stays readable to a human while carrying sections destined for a
 * generated target.
 *
 * @param text - content of the context source
 * @param name - block name, without its prefix
 * @param source - document path, for error messages
 * @returns the block content, tags removed
 */
function projectBlock(text, name, source) {
  const genericOpen = `<!-- agent:${name} -->\n`;
  const legacyOpen = `<!-- claude:${name} -->\n`;
  const open = text.includes(genericOpen) ? genericOpen : legacyOpen;
  const close = open === genericOpen ? "\n<!-- /agent -->" : "\n<!-- /claude -->";
  const start = text.indexOf(open);
  if (start === -1) fail(`${source}: block <!-- agent:${name} --> missing (legacy claude block also accepted)`);
  const from = start + open.length;
  const end = text.indexOf(close, from);
  if (end === -1) fail(`${source}: agent block ${name} not closed`);
  const body = text.slice(from, end).trim();
  if (body.length === 0) fail(`${source}: claude block ${name} empty`);
  return body;
}

/**
 * Renders `CLAUDE.md` from its template and the project context.
 *
 * This file is loaded on every session: it is the one carrying the obligation
 * to ask "pipeline or direct" before acting. Nothing rendered it and no
 * document required it, although it counts in the configuration fingerprint:
 * a repository where the pipeline had just been ported therefore started with
 * no entry point, and that obligation happened for nobody.
 *
 * The context lives outside the template because it is the only part of the
 * document that speaks of the repository rather than the pipeline, the same
 * split as the profile invariants for `AGENTS.md`.
 *
 * @returns the rendered content of CLAUDE.md
 */
function renderClaude(config) {
  if (!existsSync(CLAUDE_TEMPLATE)) fail(`not found: ${CLAUDE_TEMPLATE}`);
  const contextPath = config.project_context;
  if (!existsSync(contextPath)) {
    fail(
      `not found: ${contextPath}\n` +
        `Without it, CLAUDE.md would render without what is true of this repository: no local ` +
        `commands, no accepted limits, for any fresh session.\n` +
        `Writing that file is a step of ${PORTING_GUIDE}.`,
    );
  }

  const source = readFileSync(contextPath, "utf8");
  const text = readFileSync(CLAUDE_TEMPLATE, "utf8")
    // The answer belongs to the project once given. A session that re-asks a
    // question already settled trains the operator to answer without reading
    // it, which is how the question stopped being asked at all.
    .replaceAll(
      "{{mode}}",
      config.default_mode === "pipeline"
        ? "**This project works through the pipeline.** The operator already answered, in `pipeline.config.json`: you do not ask again. Read the store and take the next step. Stream useful output while it runs; `dispatch.mjs` emits a heartbeat at the configured interval and propagates interruption. Ask only for a decision that changes scope or authority."
        : config.default_mode === "direct"
          ? "**This project works directly, by the operator's declaration** in `pipeline.config.json`. Commits still carry a `direct:` line saying why, so the choice stays legible to whoever reads the history."
          : "**Pipeline or direct?** Ask the operator. Not after reading the code, not once a plan is drafted — first. Declaring `default_mode` in `pipeline.config.json` answers it once and for all.",
    )
    .replaceAll("{{project_summary}}", projectBlock(source, "summary", contextPath))
    .replaceAll("{{project_commands}}", projectBlock(source, "commands", contextPath))
    .replaceAll("{{project_context}}", projectBlock(source, "context", contextPath))
    .replaceAll("{{decisions_dir}}", config.decisions_dir);

  const unresolved = text.match(/\{\{[a-z._]+\}\}/);
  if (unresolved) fail(`${CLAUDE_TEMPLATE}: unresolved variable ${unresolved[0]}`);
  return text;
}

/**
 * Renders the role prompts from their sources, with the briefs path injected
 * from the configuration.
 *
 * @param config - project configuration
 * @returns the rendered content, keyed by prompt file name
 */
function renderPrompts(config, adapter) {
  if (!existsSync(PROMPTS_SRC)) fail(`not found: ${PROMPTS_SRC}`);
  const rendered = new Map();
  for (const file of readdirSync(PROMPTS_SRC).filter((f) => f.endsWith(".md")).sort()) {
    const text = stripUndeclaredGates(
      readFileSync(join(PROMPTS_SRC, file), "utf8")
        .replaceAll("{{briefs_dir}}", config.briefs_dir)
        .replaceAll("{{decisions_dir}}", config.decisions_dir)
        // Rendered from this project's own table rather than recited: a
        // prompt listing gate names by hand tells a project to run what it
        // does not have, and to replay what it deferred.
        .replaceAll("{{gates.per_issue}}", gatesForIssue([], config).map((key) => `\`${key}\``).join(", "))
        .replaceAll("{{gates.closure}}", closureGates(config).map((key) => `\`${key}\``).join(", ") || "aucune"),
      config,
    );
    const unresolved = text.match(/\{\{[a-z._]+\}\}/);
    if (unresolved) fail(`${PROMPTS_SRC}/${file}: unresolved variable ${unresolved[0]}`);
    // The same rule as the briefs, one surface further. A prompt is the
    // first thing a role reads, so a gate named there and declared nowhere
    // is an obligation the role cannot satisfy and cannot recognise as
    // inapplicable.
    const orphans = orphanGates(text, config);
    if (orphans.length > 0) {
      console.error(`${PROMPTS_SRC}/${file}: ${orphans.length} rule(s) name a gate nothing answers for here:`);
      for (const gate of orphans) console.error(`  \`${gate}\``);
      fail(
        "Declare the command, or wrap the passage in <!-- gate:NAME --> ... <!-- /gate --> in the prompt. " +
          "A role cannot tell a rule that binds it from one that binds nobody.",
      );
    }
    rendered.set(file, adaptPrompt(text, adapter, file.replace(/\.md$/, "")));
  }
  return rendered;
}

/**
 * Returns a root's files, recursively, as paths relative to it.
 *
 * @param root - root to walk
 * @param prefix - prefix accumulated during the descent
 * @returns the relative paths, separators normalised
 */
function walkRelative(root, prefix = "") {
  if (!existsSync(root)) return [];
  let found = [];
  for (const entry of readdirSync(root).sort()) {
    const absolute = join(root, entry);
    const relative = prefix.length === 0 ? entry : `${prefix}/${entry}`;
    if (statSync(absolute).isDirectory()) found = found.concat(walkRelative(absolute, relative));
    else found.push(relative);
  }
  return found;
}

/**
 * Reads the project types a skill declares itself relevant to.
 *
 * A skill that names none applies everywhere, which is what every skill did
 * before this line existed. One that names some is installed only where they
 * match: advice about screens, dropped into a service that has none, is not
 * inert — an agent reads it and tries to follow it.
 *
 * A name that matches no known project type is refused rather than ignored.
 * A typo in this field would otherwise hide a skill forever, and the failure
 * would look exactly like the skill not existing.
 *
 * @param body - content of the skill's SKILL.md
 * @param source - path of that file, for the error message
 * @returns the declared types, or null when the skill names none
 */
function appliesTo(body, source) {
  const match = body.match(/^applies_to:\s*(.+)$/m);
  if (match == null) return null;
  const declared = match[1]
    .split(",")
    .map((entry) => entry.trim().replace(/^\[|\]$/g, ""))
    .filter((entry) => entry.length > 0);
  for (const type of declared) {
    if (!PROJECT_TYPES.includes(type)) {
      fail(
        `${source}: applies_to names "${type}", which is no known project type. ` +
          `Known: ${PROJECT_TYPES.join(", ")}. A typo here hides the skill on every project.`,
      );
    }
  }
  return declared;
}

/**
 * Collects the skills to install: the core's, then the profile's.
 *
 * A skill may declare the project types it applies to; one that does not
 * match this project is left out entirely, files and all.
 *
 * The two sources are disjoint by construction: the core carries only what
 * depends on no stack, the profile what does. The same name on both sides is
 * a filing error, not an override, and it is refused rather than silently
 * resolved.
 *
 * @param config - project configuration
 * @returns the content to install, keyed by path relative to skills_dir
 */
function collectSkills(config) {
  const profileSkills = join(config.profiles_dir, config.profile, "skills");
  const wanted = new Map();
  const origin = new Map();

  for (const [source, label] of [
    [SKILLS_SRC, "core"],
    [profileSkills, `profile ${config.profile}`],
  ]) {
    const skipped = new Set();
    for (const relative of walkRelative(source)) {
      const skill = relative.split("/")[0];
      if (skipped.has(skill)) continue;
      if (relative === `${skill}/SKILL.md`) {
        const declared = appliesTo(readFileSync(join(source, relative), "utf8"), join(source, relative));
        if (declared != null && !declared.includes(config.architecture?.project_type)) {
          skipped.add(skill);
          for (const already of [...wanted.keys()]) {
            if (already.startsWith(`${skill}/`)) wanted.delete(already);
          }
          continue;
        }
      }
      const previous = origin.get(skill);
      if (previous != null && previous !== label) {
        fail(
          `skill "${skill}" present in both ${previous} and ${label}.\n` +
            `A skill belongs to the core if it depends on no stack, to the profile otherwise. Never to both.`,
        );
      }
      origin.set(skill, label);
      wanted.set(relative, readFileSync(join(source, relative)));
    }
  }
  return wanted;
}

/**
 * Installs the skills into `skills_dir`, or reports the drift.
 *
 * A skill injects instructions into an agent. Installing it as a generated
 * target is what makes that injection auditable: the source is read once, and
 * any divergence in the installed copy is reported before an agent reads it.
 *
 * @param config - project configuration
 * @param checkMode - true to compare without writing
 * @returns true if a drift was observed in check mode
 */
function applySkills(config, checkMode) {
  const wanted = collectSkills(config);
  const target = config.skills_dir;

  if (wanted.size === 0) {
    if (existsSync(target) && walkRelative(target).length > 0) {
      console.error(`out of sync: ${target} populated while no skill is supplied`);
      return true;
    }
    return false;
  }

  const present = new Set(walkRelative(target));
  let drift = false;

  if (checkMode) {
    for (const [relative, content] of wanted) {
      const path = join(target, relative);
      if (!existsSync(path)) {
        console.error(`absent : ${path}`);
        drift = true;
      } else if (!readFileSync(path).equals(content)) {
        console.error(`out of sync: ${path}`);
        drift = true;
      }
      present.delete(relative);
    }
    for (const orphan of present) {
      console.error(`en trop : ${join(target, orphan)}`);
      drift = true;
    }
    return drift;
  }

  for (const orphan of present) {
    if (!wanted.has(orphan)) rmSync(join(target, orphan), { force: true });
  }
  for (const [relative, content] of wanted) {
    const path = join(target, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  const names = new Set([...wanted.keys()].map((relative) => relative.split("/")[0]));
  console.log(`written: ${target}/ (${names.size} skills, ${wanted.size} files)`);
  return false;
}

/**
 * Refuses a project with screens that declares no design system.
 *
 * It is the architecture's problem, one level down: tokens, primitives and
 * components form an order that cannot be reversed afterwards. The agent
 * taking the first issue will settle it regardless, since it needs a colour
 * and a spacing to write anything, and every issue after inherits a decision
 * nobody approved.
 *
 * It also requires a named visual direction, and an accessibility command
 * here rather than in the general list, because a service with no screen has
 * neither a look nor anything to check.
 *
 * The core does not judge the system retained: writing your own primitives
 * and taking a library are both defensible answers. It requires ONE source of
 * truth for the tokens, and that the fate of the primitives be stated. A
 * project with no screen is not concerned: asking there would produce an
 * empty key that people learn to ignore.
 *
 * @param config - host project configuration
 */
function checkDesignSystem(config) {
  if (!["frontend", "mobile", "fullstack"].includes(config.architecture?.project_type)) return;
  const chosen = config.design_system;
  if (chosen == null || typeof chosen !== "object") {
    fail(
      "design_system missing: this project has screens, so tokens, primitives and components form an " +
        "order that cannot be reversed later. Left undeclared, the agent taking the first issue settles " +
        "it alone and every issue after that inherits the decision. Run render-design-system.mjs, then " +
        "declare { tokens, primitives, decided_at }.",
    );
  }
  if (typeof chosen.tokens !== "string" || chosen.tokens.length === 0) {
    fail(
      "design_system.tokens missing: name the single source of truth for colours, spacing and type scale. " +
        "Two sources drift apart in silence, and the drift is only found in a screenshot.",
    );
  }
  if (typeof chosen.primitives !== "string" || chosen.primitives.length === 0) {
    fail(
      'design_system.primitives missing: say "own" or name the library. It is the layer where duplication ' +
        "starts \u2014 an agent that finds no button writes one, then another.",
    );
  }
  const direction = chosen.direction;
  if (direction == null || typeof direction.genre !== "string" || direction.genre.trim().length === 0) {
    fail(
      "design_system.direction.genre missing: name the visual genre this project commits to. " +
        "Left unnamed, every project an agent builds converges \u2014 not on the framework default, which the " +
        "design skill refuses by name, but on whatever that skill's own examples suggest. Two projects that " +
        "land on the same genre should have to say why one answer fits two different products.",
    );
  }
  if (typeof direction.because !== "string" || direction.because.trim().length === 0) {
    fail(
      'design_system.direction.because missing: finish the sentence "this genre suits the product because ___". ' +
        "A genre nobody had to justify was picked by habit, and habit is what makes two products look alike.",
    );
  }

  if (typeof config.commands?.accessibility !== "string") {
    fail(
      "commands.accessibility missing: this project has screens. Everything else a design skill " +
        "says is judgement, and judgement is argued in review. Contrast ratio, focus order, keyboard " +
        "reachability and what a screen reader announces are numbers, and numbers are checked. The core " +
        "does not know your tool \u2014 axe, pa11y, lighthouse, a linter \u2014 it requires that one fails.",
    );
  }
}

/**
 * Refuses an imported profile until its thresholds are measured again.
 *
 * A profile carries bounds calibrated on another project's code. Taken as
 * they are, they are either too loose, and the gate stops refusing anything,
 * or too tight, and the first run gets them loosened. The framework asks
 * everywhere else that thresholds be calibrated on observed code; an imported
 * profile is precisely the case where that step is skipped unnoticed.
 *
 * The way out is one line: set `calibration_required` to `false`. That is not
 * a formality, it is a claim that someone measured. A gate with no
 * satisfiable exit gets deleted the next day.
 *
 * @param config - host project configuration
 */
function checkCalibration(config) {
  const path = join(config.profiles_dir, config.profile, "profile.json");
  if (!existsSync(path)) return;
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  if (manifest.calibration_required === true) {
    fail(
      `${path} carries calibration_required: true. The thresholds in this profile were measured on ` +
        "another codebase, not on yours: too loose and the gate stops refusing anything, too tight and " +
        "the first run gets it loosened. Measure them here, adjust the tool files, then set the flag to " +
        "false to state that you did.",
    );
  }
}

/**
 * Refuses a project that mentions the decisions journal without placing it.
 *
 * `CLAUDE.md` sends any session to it before touching a past decision, and
 * Product is told to read it and never to edit it. Three instructions
 * pointing at a document that had no path, no key and no command: the one
 * shape of rule this framework exists to refuse, sitting in its own prompts.
 *
 * The directory is required to exist, empty or not. A journal with no entry
 * is honest on a new project; a journal nobody can find is an instruction
 * nobody can follow.
 *
 * What this does not do is check that a decision was actually written down
 * when one was taken. Nothing here can: the judgement of what counts as a
 * decision worth recording is the operator's, and pretending otherwise would
 * be worse than saying so.
 *
 * @param config - host project configuration
 */
function checkDecisionsJournal(config) {
  const journal = config.decisions_dir;
  if (typeof journal !== "string" || journal.length === 0) {
    fail(
      "decisions_dir missing: CLAUDE.md sends every session to the decisions journal before touching a " +
        "past decision, and Product is told to read it and never edit it. Those three instructions point " +
        "at a document with no path, so they point at nothing. Name the directory.",
    );
  }
  if (!existsSync(journal)) {
    fail(
      `not found: ${journal}\n` +
        "The journal is named but does not exist, so the instruction to read it cannot be followed. " +
        "Create it, empty: a new project has decided nothing yet, and that is worth recording as such.",
    );
  }
}

/**
 * Refuses a page language the framework does not ship.
 *
 * The pages are the one thing here written for a person rather than a model,
 * and a person has a language. Declaring one the framework cannot render
 * would fail at the first page, hours after the configuration was written,
 * and look like a broken script rather than a typo.
 *
 * @param config - host project configuration
 */
function checkLanguage(config) {
  if (config.language === undefined) return;
  // Resolved from this script, never from the host project: it is the
  // framework that ships the languages, and a project that has not copied
  // them yet would look like a project asking for an unknown one.
  const pages = join(dirname(fileURLToPath(import.meta.url)), "..", "pages");
  const shipped = readdirSync(pages)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.replace(".json", ""));
  if (typeof config.language !== "string" || !shipped.includes(config.language)) {
    fail(
      `language "${config.language}" is not one the framework ships. Available: ${shipped.join(", ")}. ` +
        "Omit the key to render the pages in English.",
    );
  }
}

/**
 * Refuses a configuration where the generated map has no honest place.
 *
 * Two things must hold, and each one alone is useless. The map must be
 * regenerable by a command, or the orchestrator can only observe that it is
 * stale. And the orchestrator's file policy must let it write the map, or
 * the one role allowed to regenerate it is refused by the scope check the
 * moment it does.
 *
 * Deferring the map's gate is not asked of anyone: the framework knows the
 * map is stale on the branch by construction, so `deferredGates` defers it
 * whether or not `closure_gates` mentions it. What the operator declares
 * there is the rest — the gates they judge too slow to run on every push.
 *
 * @param config - the project configuration
 * @returns nothing; fails the process on an incoherent declaration
 */
function checkGeneratedTargets(config) {
  for (const key of config.closure_gates ?? []) {
    if (typeof config.commands?.[key] !== "string") {
      fail(
        `closure_gates names "${key}", which no command declares. A gate nobody can run is not deferred, it is absent.`,
      );
    }
  }

  const out = config.project_map?.out;
  if (typeof out !== "string") return;

  if (typeof config.project_map?.regenerate !== "string") {
    fail(
      "project_map.regenerate missing: name the command that WRITES the map, not the one that checks it. " +
        "The orchestrator regenerates the map after each issue closes; with only a check it can observe " +
        "the staleness it is supposed to repair. It stays out of `commands` on purpose: a CI running the " +
        "regeneration before the check would make the check pass whatever the code says.",
    );
  }

  const policy = config.file_policy?.orchestrator;
  if (policy != null && !pathAllowed(out, policy)) {
    fail(
      `file_policy.orchestrator forbids ${out}, the generated map it is the only role allowed to write. ` +
        "Allow it there, or no role can regenerate what every role is forbidden to edit.",
    );
  }
}

/**
 * Refuses a configuration that does not declare how the code is laid out.
 *
 * `render-architecture` explains the options and the operator decides, but a
 * choice that stays in a rendered page binds nobody: the agent installing the
 * profile lays the code out as it sees fit, and the next one lays it out
 * differently. The choice only exists once it is written somewhere a gate
 * reads back.
 *
 * The core does not judge the architecture retained: `custom` is a valid
 * answer. It requires that one be named, and that it apply to the declared
 * project type. Offering ports and adapters to a web interface is a catalogue
 * copied out, not a decision.
 *
 * @param config - host project configuration
 */
function checkArchitecture(config) {
  const chosen = config.architecture;
  if (chosen == null || typeof chosen !== "object") {
    fail(
      "architecture missing: declare { id, project_type }. The framework does not choose for you, " +
        "but a choice that lives only in a rendered page binds no agent: each will lay the code out " +
        "its own way, and drift stays invisible because nothing states what it drifts from. " +
        "Run render-architecture.mjs to decide, then write the result here.",
    );
  }
  if (typeof chosen.project_type !== "string" || !PROJECT_TYPES.includes(chosen.project_type)) {
    fail(
      `architecture.project_type invalid: expected one of ${PROJECT_TYPES.join(", ")}. ` +
        "The project type changes the answer, not just the vocabulary.",
    );
  }
  if (typeof chosen.id !== "string" || chosen.id.length === 0) {
    fail("architecture.id missing: name the layout you retained, or \"custom\" if it is in no catalogue.");
  }
  if (chosen.id === "custom") {
    if (typeof chosen.note !== "string" || chosen.note.trim().length === 0) {
      fail("architecture.id is \"custom\": the note describing the layout becomes the only reference. It is required.");
    }
    return;
  }
  const known = ARCHITECTURES.find((item) => item.id === chosen.id);
  if (known == null) {
    fail(
      `architecture.id unknown: "${chosen.id}". Known: ${ARCHITECTURES.map((item) => item.id).join(", ")}, ` +
        "or \"custom\" with a note.",
    );
  }
  if (!known.applies.includes(chosen.project_type)) {
    fail(
      `architecture "${chosen.id}" does not apply to a ${chosen.project_type} project ` +
        `(it applies to: ${known.applies.join(", ")}). A choice outside the project type is a name copied out, not a decision.`,
    );
  }
}

/**
 * Applies the profile to the repository: file_policy injected into the rules,
 * `AGENTS.md` rendered from its template and the profile invariants,
 * `CLAUDE.md` rendered from its template and the project context, the CI
 * workflow rendered from the template and the profile commands, and the role
 * prompts rendered into prompts_dir with the briefs path.
 *
 * In --check mode it compares without writing, exiting 1 on drift. Any
 * command added to the configuration automatically becomes a CI step.
 */
function main() {
  const checkMode = process.argv.includes("--check");
  const config = loadConfig();

  for (const key of ["check", "lint", "build", "test_unit", "audit", "secrets_scan", "project_map"]) {
    if (typeof config.commands[key] !== "string") fail(`commands.${key} missing or invalid`);
  }
  if (typeof config.commands.design_limits !== "string") {
    fail(
      "commands.design_limits missing: the core does not know your tool, but it requires a gate bounding " +
        "borne complexity, function length, parameter count and nesting depth. " +
        "These are measurable approximations of what single responsibility and KISS protect; " +
        "with no gate they apply to nothing, and the code is only as good as the model.",
    );
  }
  // A finding routed to the framework needs somewhere outside this project
  // to land, or it is lost at closure — which is how a product backlog ends
  // up carrying the pipeline's own defects.
  if (typeof config.findings_path !== "string") {
    fail(
      'findings_path missing: name the file where findings about the pipeline land, outside the ' +
        'product\'s backlog. `"findings_path": "pipeline/findings.md"`.',
    );
  }
  if (config.risk != null) {
    for (const lane of ["high", "low"]) {
      const patterns = config.risk[lane];
      if (patterns != null && !Array.isArray(patterns)) fail(`risk.${lane} must be a list of path patterns`);
    }
    for (const key of Object.keys(config.risk)) {
      if (["high", "low"].includes(key)) continue;
      fail(`risk.${key} is not a lane: only "high" and "low" are declared, everything else is normal.`);
    }
  }
  if (config.workflow?.gates != null) {
    const eligible = new Set(perIssueGates(config));
    for (const lane of ["low", "normal", "high"]) {
      const value = config.workflow.gates[lane];
      if (value == null || value === "all") continue;
      if (!Array.isArray(value)) fail(`workflow.gates.${lane} must be "all" or a list of command keys`);
      for (const key of value) {
        if (typeof config.commands?.[key] !== "string") {
          fail(`workflow.gates.${lane} names ${key}, which commands does not declare`);
        }
        if (!eligible.has(key)) {
          fail(`workflow.gates.${lane} names ${key}, but that gate is reserved for final closure`);
        }
      }
    }
  }
  if (
    config.workflow?.max_transitions_per_run != null &&
    (!Number.isInteger(config.workflow.max_transitions_per_run) || config.workflow.max_transitions_per_run < 1)
  ) {
    fail("workflow.max_transitions_per_run must be a positive integer");
  }
  if (config.agent_runtime != null) {
    const interval = config.agent_runtime.progress_interval_seconds;
    if (interval != null && (typeof interval !== "number" || !Number.isFinite(interval) || interval <= 0)) {
      fail("agent_runtime.progress_interval_seconds must be a positive number");
    }
    if (config.agent_runtime.command != null) {
      if (typeof config.agent_runtime.command !== "string" || config.agent_runtime.command.trim().length === 0) {
        fail("agent_runtime.command must be a non-empty executable name");
      }
      if (!Array.isArray(config.agent_runtime.args) || config.agent_runtime.args.some((arg) => typeof arg !== "string")) {
        fail("agent_runtime.args must be a list of strings when command is configured");
      }
    }
    if (
      config.agent_runtime.interactive_input != null &&
      typeof config.agent_runtime.interactive_input !== "boolean"
    ) {
      fail("agent_runtime.interactive_input must be a boolean");
    }
    if (
      config.agent_runtime.runs_dir != null &&
      (typeof config.agent_runtime.runs_dir !== "string" || config.agent_runtime.runs_dir.trim().length === 0)
    ) {
      fail("agent_runtime.runs_dir must be a non-empty path");
    }
  }
  if (config.issue_tracker != null && config.issue_tracker.enabled !== false) {
    const tracker = config.issue_tracker;
    if (tracker.provider !== "sudocode") fail("issue_tracker.provider must be sudocode");
    for (const key of ["root", "issues_file", "specs_file", "command", "managed_tag"]) {
      if (typeof tracker[key] !== "string" || tracker[key].trim().length === 0) {
        fail(`issue_tracker.${key} must be a non-empty string`);
      }
    }
    if (!Array.isArray(tracker.args) || tracker.args.some((arg) => typeof arg !== "string")) {
      fail("issue_tracker.args must be a list of strings");
    }
    if (typeof config.commands.tracker_sync !== "string") {
      fail("commands.tracker_sync missing: a configured issue tracker needs a gate that refuses drift");
    }
    const trackerRoot = resolve(tracker.root);
    const controlRoot = resolve(config.store_dir);
    if (
      trackerRoot === controlRoot ||
      trackerRoot.startsWith(`${controlRoot}${sep}`) ||
      controlRoot.startsWith(`${trackerRoot}${sep}`)
    ) {
      fail("issue_tracker.root and store_dir must be separate directories");
    }
    const statuses = new Set(["open", "in_progress", "blocked", "needs_review", "closed"]);
    for (const phase of [
      "planned",
      "in_progress",
      "ready_for_qa",
      "qa_in_progress",
      "closed",
      "blocked_*",
      "operator_escalation",
    ]) {
      if (!statuses.has(tracker.status_map?.[phase])) {
        fail(`issue_tracker.status_map.${phase} must be a valid Sudocode status`);
      }
    }
    const trackerProbe = join(tracker.root, tracker.issues_file).replaceAll("\\", "/");
    for (const role of ["product", "orchestrator"]) {
      if (!pathAllowed(trackerProbe, config.file_policy?.[role])) {
        fail(
          `file_policy.${role} forbids ${trackerProbe}, but ${role} must mutate Sudocode through its CLI`,
        );
      }
    }
  }
  // A directory declared and empty exists on one machine and nowhere else:
  // git does not version empty directories. Observed on a real port, where
  // `docs/stack` was declared, empty, and present locally — `sync-briefs
  // --check` died on the runner with a path its author could see. A file
  // that is not a document does not save it either: the directory was
  // declared to be read, and a `.gitkeep` carries nothing to read.
  for (const dir of config.docs_dirs ?? []) {
    const documents = existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(".md")) : null;
    if (documents == null) {
      fail(`docs_dirs names ${dir}, which does not exist. A directory declared and absent is read by nobody.`);
    }
    if (documents.length === 0) {
      fail(
        `docs_dirs names ${dir}, which carries no document. Git does not version an empty directory, so it ` +
          "exists on your machine and nowhere else — the failure lands on the runner, on a path you can see. " +
          "Put the documents there, or stop declaring it.",
      );
    }
  }
  // The operator answers « pipeline or direct » once. Every later session
  // asked again, because the answer lived in a conversation rather than in
  // the project. A mode nobody implements is refused rather than assumed.
  if (config.default_mode != null && !["pipeline", "direct"].includes(config.default_mode)) {
    fail(`default_mode "${config.default_mode}" is neither "pipeline" nor "direct".`);
  }
  // A handoff inside the diff is a file the scope check flags and a reviewer
  // reads by mistake. The prompt said « outside the repository », which gave
  // it no home at all — and a file with no home is a file nobody cleans up.
  if (typeof config.handoffs_dir === "string") {
    let ignored = false;
    try {
      execFileSync("git", ["check-ignore", "-q", config.handoffs_dir], { stdio: "ignore" });
      ignored = true;
    } catch {
      ignored = false;
    }
    if (!ignored) {
      fail(
        `handoffs_dir ${config.handoffs_dir} is not ignored by git. A handoff committed lands in the diff, ` +
          "where verify-scope flags it and a reviewer reads it as work. Add it to .gitignore.",
      );
    }
  }
  checkArchitecture(config);
  checkLanguage(config);
  checkDecisionsJournal(config);
  // After calibration: an imported profile carries values nobody has read
  // yet, and "this profile is not calibrated" is the answer worth printing
  // first. Any missing key it names is downstream of that one sentence.
  checkCalibration(config);
  // Thirteen gates green while every form answered 403: the origin was never
  // configured, no criterion foresaw it, and it was found by starting the
  // server. Nothing in a static battery starts anything.
  if (typeof config.commands.smoke !== "string") {
    fail(
      "commands.smoke missing: name the command that STARTS the built application and exercises one real " +
        "path end to end — a request that goes through, a form that posts, a command that runs. Not another " +
        "unit test: the failure this catches is every gate green while the product refuses everything.",
    );
  }
  checkGeneratedTargets(config);
  checkDesignSystem(config);
  for (const role of Object.keys(config.file_policy)) {
    if (!ROLES.includes(role)) fail(`file_policy: unknown role "${role}"`);
  }
  if (typeof config.commands.duplication !== "string") {
    fail(
      "commands.duplication missing: the core does not know your tool, but it requires a gate that " +
        "refuses a block repeated across the codebase. Every prompt already demands a reuse note, and " +
        "that note is judged in review against the project map \u2014 which means it is judged when someone " +
        "remembers to look. A copy-paste detector is to reuse what design_limits is to single " +
        "responsibility: an approximation that refuses something. agent-pipeline/scripts/duplication.mjs " +
        "is one implementation, and any other is fine.",
    );
  }
  for (const role of ["implementer"]) {
    if (config.file_policy[role] == null) fail(`file_policy.${role} is required`);
  }

  const RULES_PATH = config.rules_path;
  if (!existsSync(RULES_PATH)) {
    if (checkMode) {
      fail(
        `absent : ${RULES_PATH}\n` +
          `The rules file was never seeded. Run apply-profile without --check: ` +
          `it seeds it from ${RULES_SRC}.`,
      );
    }
    if (!existsSync(RULES_SRC)) fail(`not found: ${RULES_SRC}`);
    mkdirSync(dirname(RULES_PATH), { recursive: true });
    writeFileSync(RULES_PATH, readFileSync(RULES_SRC));
    console.log(`seeded: ${RULES_PATH} (from ${RULES_SRC})`);
  }

  const rules = loadRules(RULES_PATH);
  const sourceRules = JSON.parse(readFileSync(RULES_SRC, "utf8"));
  const wantedRules = { ...sourceRules, file_policy: config.file_policy };
  const currentRules = JSON.stringify(rules);
  const renderedRules = JSON.stringify(wantedRules);
  const ciEnabled = config.ci.provider !== "none";

  let ci = "";
  if (ciEnabled) {
  if (!existsSync(CI_TEMPLATE)) fail(`not found: ${CI_TEMPLATE}`);
  ci = readFileSync(CI_TEMPLATE, "utf8");
  const vars = {
    profile: config.profile,
    install: config.ci.install,
    "runtime.uses": config.ci.runtime_setup.uses,
    "runtime.with": Object.entries(config.ci.runtime_setup.with)
      .map(([k, v]) => `          ${k}: ${v}`)
      .join("\n"),
    steps: Object.entries(config.commands)
      .map(([key, cmd]) => {
        // A closure gate judges the spec, not the commit. Run on every push
        // it would be red for the whole branch — the map is stale until the
        // orchestrator regenerates it — and a job red by design is a job
        // people stop reading.
        const deferred = deferredGates(config).has(key)
          ? "\n        if: ${{ github.event_name == 'pull_request' }}"
          : "";
        return `      - name: ${key.replaceAll("_", "-")}${deferred}\n        run: ${cmd}`;
      })
      .join("\n\n"),
  };
  for (const [key, value] of Object.entries(vars)) ci = ci.replaceAll(`{{${key}}}`, value);
  const unresolved = ci.match(/\{\{[a-z._]+\}\}/);
  if (unresolved) fail(`${CI_TEMPLATE}: unresolved variable ${unresolved[0]}`);
  }

  let adapter;
  try {
    adapter = promptAdapter(config);
  } catch (error) {
    fail(error.message);
  }
  const prompts = renderPrompts(config, adapter);
  const agents = renderAgents(config);
  const claude = rendersClaudeEntry(adapter) ? renderClaude(config) : null;

  if (checkMode) {
    let drift = false;
    const currentAgents = existsSync(AGENTS_OUT) ? readFileSync(AGENTS_OUT, "utf8") : "";
    if (currentAgents !== agents) {
      console.error(`out of sync: ${AGENTS_OUT}`);
      drift = true;
    }
    if (claude != null) {
      const currentClaude = existsSync(CLAUDE_OUT) ? readFileSync(CLAUDE_OUT, "utf8") : "";
      if (currentClaude !== claude) {
        console.error(`out of sync: ${CLAUDE_OUT}`);
        drift = true;
      }
    }
    for (const [file, text] of prompts) {
      const outPath = join(config.prompts_dir, file);
      const current = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";
      if (current !== text) {
        console.error(`out of sync: ${outPath}`);
        drift = true;
      }
    }
    if (currentRules !== renderedRules) {
      console.error(`out of sync: ${RULES_PATH} (machine rules or file_policy)`);
      drift = true;
    }
    if (ciEnabled) {
      const currentCi = existsSync(CI_OUT) ? readFileSync(CI_OUT, "utf8") : "";
      if (currentCi !== ci) {
        console.error(`out of sync: ${CI_OUT}`);
        drift = true;
      }
    } else if (existsSync(CI_OUT)) {
      console.error(`out of sync: ${CI_OUT} present while ci.provider is "none"`);
      drift = true;
    }
    if (applySkills(config, true)) drift = true;
    if (drift) fail("Profile not applied.");
    console.log("Profile applied and in sync.");
  } else {
    writeFileSync(RULES_PATH, JSON.stringify(wantedRules, null, "\t") + "\n");
    console.log(`written: ${RULES_PATH} (machine rules + file_policy of profile ${config.profile})`);
    writeFileSync(AGENTS_OUT, agents);
    console.log(`written: ${AGENTS_OUT} (invariants of profile ${config.profile})`);
    if (claude != null) {
      writeFileSync(CLAUDE_OUT, claude);
      console.log(`written: ${CLAUDE_OUT} (context from ${config.project_context})`);
    }
    if (ciEnabled) {
      mkdirSync(dirname(CI_OUT), { recursive: true });
      writeFileSync(CI_OUT, ci);
      console.log(`written: ${CI_OUT}`);
    } else {
      console.log(`ci.provider "none" : no workflow rendered; the proof of closure is QA's full local battery`);
    }
    mkdirSync(config.prompts_dir, { recursive: true });
    for (const [file, text] of prompts) {
      writeFileSync(join(config.prompts_dir, file), text);
    }
    console.log(
      `written: ${config.prompts_dir}/ (${prompts.size} prompts, adapter ${adapter}, briefs -> ${config.briefs_dir})`,
    );
    applySkills(config, false);
  }
}

main();
