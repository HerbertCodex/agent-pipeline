import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadConfig, loadRules, fail } from "./lib.mjs";
import { ARCHITECTURES, PROJECT_TYPES } from "./architectures.mjs";

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

  const invariants = readFileSync(invariantsPath, "utf8").trim();
  if (invariants.length === 0) fail(`${invariantsPath} is empty`);

  let text = readFileSync(AGENTS_TEMPLATE, "utf8")
    .replaceAll("{{profile}}", config.profile)
    .replaceAll("{{profile_invariants}}", invariants);

  const unresolved = text.match(/\{\{[a-z._]+\}\}/);
  if (unresolved) fail(`${AGENTS_TEMPLATE}: variable non resolue ${unresolved[0]}`);
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
  const open = `<!-- claude:${name} -->\n`;
  const start = text.indexOf(open);
  if (start === -1) fail(`${source}: bloc <!-- claude:${name} --> absent`);
  const from = start + open.length;
  const end = text.indexOf("\n<!-- /claude -->", from);
  if (end === -1) fail(`${source}: claude block ${name} not closed`);
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
    .replaceAll("{{project_summary}}", projectBlock(source, "summary", contextPath))
    .replaceAll("{{project_commands}}", projectBlock(source, "commands", contextPath))
    .replaceAll("{{project_context}}", projectBlock(source, "context", contextPath));

  const unresolved = text.match(/\{\{[a-z._]+\}\}/);
  if (unresolved) fail(`${CLAUDE_TEMPLATE}: variable non resolue ${unresolved[0]}`);
  return text;
}

/**
 * Renders the role prompts from their sources, with the briefs path injected
 * from the configuration.
 *
 * @param config - project configuration
 * @returns the rendered content, keyed by prompt file name
 */
function renderPrompts(config) {
  if (!existsSync(PROMPTS_SRC)) fail(`not found: ${PROMPTS_SRC}`);
  const rendered = new Map();
  for (const file of readdirSync(PROMPTS_SRC).filter((f) => f.endsWith(".md")).sort()) {
    const text = readFileSync(join(PROMPTS_SRC, file), "utf8").replaceAll("{{briefs_dir}}", config.briefs_dir);
    const unresolved = text.match(/\{\{[a-z._]+\}\}/);
    if (unresolved) fail(`${PROMPTS_SRC}/${file}: variable non resolue ${unresolved[0]}`);
    rendered.set(file, text);
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
    if (PROJECT_TYPES[type] == null) {
      fail(
        `${source}: applies_to names "${type}", which is no known project type. ` +
          `Known: ${Object.keys(PROJECT_TYPES).join(", ")}. A typo here hides the skill on every project.`,
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
  if (typeof chosen.project_type !== "string" || PROJECT_TYPES[chosen.project_type] == null) {
    fail(
      `architecture.project_type invalid: expected one of ${Object.keys(PROJECT_TYPES).join(", ")}. ` +
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
  checkArchitecture(config);
  checkCalibration(config);
  checkDesignSystem(config);
  for (const role of Object.keys(config.file_policy)) {
    if (!ROLES.includes(role)) fail(`file_policy: role inconnu "${role}"`);
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
  const currentPolicy = JSON.stringify(rules.file_policy ?? null);
  const wantedPolicy = JSON.stringify(config.file_policy);
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
      .map(([key, cmd]) => `      - name: ${key.replaceAll("_", "-")}\n        run: ${cmd}`)
      .join("\n\n"),
  };
  for (const [key, value] of Object.entries(vars)) ci = ci.replaceAll(`{{${key}}}`, value);
  const unresolved = ci.match(/\{\{[a-z._]+\}\}/);
  if (unresolved) fail(`${CI_TEMPLATE}: variable non resolue ${unresolved[0]}`);
  }

  const prompts = renderPrompts(config);
  const agents = renderAgents(config);
  const claude = renderClaude(config);

  if (checkMode) {
    let drift = false;
    const currentAgents = existsSync(AGENTS_OUT) ? readFileSync(AGENTS_OUT, "utf8") : "";
    if (currentAgents !== agents) {
      console.error(`out of sync: ${AGENTS_OUT}`);
      drift = true;
    }
    const currentClaude = existsSync(CLAUDE_OUT) ? readFileSync(CLAUDE_OUT, "utf8") : "";
    if (currentClaude !== claude) {
      console.error(`out of sync: ${CLAUDE_OUT}`);
      drift = true;
    }
    for (const [file, text] of prompts) {
      const outPath = join(config.prompts_dir, file);
      const current = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";
      if (current !== text) {
        console.error(`out of sync: ${outPath}`);
        drift = true;
      }
    }
    if (currentPolicy !== wantedPolicy) {
      console.error(`out of sync: ${RULES_PATH} file_policy`);
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
    rules.file_policy = config.file_policy;
    writeFileSync(RULES_PATH, JSON.stringify(rules, null, "\t") + "\n");
    console.log(`written: ${RULES_PATH} (file_policy of profile ${config.profile})`);
    writeFileSync(AGENTS_OUT, agents);
    console.log(`written: ${AGENTS_OUT} (invariants of profile ${config.profile})`);
    writeFileSync(CLAUDE_OUT, claude);
    console.log(`written: ${CLAUDE_OUT} (contexte de ${config.project_context})`);
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
    console.log(`written: ${config.prompts_dir}/ (${prompts.size} prompts, briefs -> ${config.briefs_dir})`);
    applySkills(config, false);
  }
}

main();
