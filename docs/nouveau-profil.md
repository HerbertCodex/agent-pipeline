# Installing the pipeline in a new project

This document addresses the agent configuring the pipeline in a repository that does not know it yet. It assumes `agent-pipeline/` has just been copied to the project root and nothing else has been done.

It is not an introduction to the pipeline. For what it does and why, read `AGENTS.md` **after** rendering it, then `state-machine.md` and `quality-gates.md`.

Throughout this document, **a gate** means a command that either passes or fails. If it fails, the work does not move on. Gates are named by key — `check`, `lint`, `test_unit` — in `pipeline.config.json`; the key stays the same across projects, the command behind it changes with the stack. That is what lets these documents point at a gate without knowing your tools.

## Starting from a profile that already exists

If a project of the same stack already runs this pipeline, do not rewrite its gates. Export them there:

```
node agent-pipeline/scripts/export-profile.mjs <bundle-dir> [tool-file...]
```

The bundle carries the **stack half** of the configuration — `commands`, `project_map`, `doc_policy`, `comment_policy`, `secrets_scan`, `file_policy` — plus the invariants, the profile skills, and the tool files the commands name. It deliberately leaves behind `store_dir`, `ci` and `architecture.id`: those describe where that project keeps its state, which forge it lives on, and a layout decided for it. Carrying them would install decisions the new project never took.

Then, in the new repository:

```
node agent-pipeline/scripts/import-profile.mjs <bundle-dir> [host-dir]
```

It seeds the profile directory and writes `pipeline.config.json` **only when there is none**. If the project already has one, it refuses and prints the block to merge — that file belongs to the operator and is never rewritten by a script. Tool files that already exist are kept, and named in the output.

**The imported profile does not run yet.** `apply-profile` refuses while `calibration_required` is `true` in the profile's `profile.json`. That flag is not ceremony: the thresholds in those tool files were measured on another codebase. Too loose and the gate stops refusing anything; too tight and the first run gets it loosened, and a gate loosened once loosens again. Measure them here, adjust the files, then set the flag to `false` — which is a claim that you did.

You still write the invariants and the pitfalls document yourself. `apply-profile` refuses a profile without `pitfalls.md`, empty or not: it is what `store-verify` requires an escaped defect to leave behind, and a file that does not exist cannot receive anything. A profile carries what a stack does; it does not know what this repository has already learned.

## What you configure, and what you do not touch

`agent-pipeline/scripts/` is **agnostic**: those scripts know no language, no framework, no package manager. They read the store, compute the schedule, validate handoffs. You do not touch them, and you introduce no stack dependency there — the same rule holds for `agent-pipeline/prompts/`, `agent-pipeline/docs/` and `agent-pipeline/templates/`.

Everything that speaks of the stack or of this repository lives in six places, and those are the six you write:

| What | Where | What it carries |
| --- | --- | --- |
| The configuration | `pipeline.config.json` | commands, `file_policy`, directories, human-review surfaces, CI |
| The invariants | `<profiles_dir>/<profile>/invariants.md` | section 9 of `AGENTS.md`: what is forbidden in this language |
| The stack skills | `<profiles_dir>/<profile>/skills/` | what a skill knows about this stack and that has no place in the core |
| The repository context | the `project_context` file | three generic `agent` blocks (legacy `claude` markers accepted): summary, local commands, accepted limits |
| The project tools | `scripts/` | the project map, the comment policy |
| The standards | `docs/stack/` | conventions reviewed by QA |

Skills are sorted by a single question: **would this skill still be right in a project on another stack?** If yes it belongs to `agent-pipeline/skills/` and travels with the pipeline. Otherwise it belongs to the profile. A web-interface skill in the core would make the core wrong for a Go project; `apply-profile` refuses the same name on both sides.

`AGENTS.md`, the `rules_path` file, the rendered prompts and the skills installed into `skills_dir` are **generated** by `apply-profile`. With the `claude-code` adapter, `CLAUDE.md` is generated too. Never write generated targets by hand: `apply-profile --check` reports drift.

The harness entry point belongs to its adapter. Claude Code receives `CLAUDE.md` and YAML role metadata; the portable adapter emits plain Markdown prompts and leaves startup wiring to the configured CLI. The role contract itself stays identical.

## The order, and the check after each step

### 1. Name the profile and write its invariants

Choose a short descriptive identifier: `api-fastapi`, `web-svelte`, `cli-go`. Write `<profiles_dir>/<profile>/invariants.md` — `profiles_dir` is declared in your config and lives at the project root, never inside `agent-pipeline/` — as a bullet list, each bullet checkable, each specific to the language.

A useful invariant forbids something precise that the language makes easy. "Write clean code" is not an invariant; "no `any`" and "no bare `except:`" are.

For every bullet, ask: **which gate makes it fail?** If the answer is "none", either you add the gate at step 3 or you remove the bullet. If no command can refuse it, the rule never applies — that is this pipeline's most expensive lesson, and it is relearned in every project.

### 2. Write `pipeline.config.json`

Start from the origin project's file and replace every value. The `commands` keys are a contract: prompts and documents designate gates **by their key**, never by the command. `check` must remain type checking whatever tool provides it.

Mandatory keys, refused if absent: `check`, `lint`, `build`, `test_unit`, `audit`, `secrets_scan`, `project_map`, `design_limits`, `duplication`.

Also mandatory, outside `commands`: an `architecture` block, `{ id, project_type }`. The operator chooses it — `render-architecture.mjs` lays out the options for their project type — but the choice has to be **written down**, because a decision that lives only in a rendered page binds nobody. The agent installing the profile lays the code out one way, the next agent lays it out another, and drift is undetectable because nothing states what it drifts from.

`apply-profile` refuses an unknown id, and refuses an id that does not apply to the declared `project_type`: hexagonal ports and adapters proposed for a browser interface is a catalogue copied out, not a decision. `"custom"` is a valid answer and requires a `note` — that note then **is** the reference.

Mandatory paths, refused if absent: `profiles_dir`, `docs_dirs`, `briefs_dir`, `prompts_dir`, `skills_dir`, `rules_path`, `project_context`, `store_dir`. New installations also configure `issue_tracker` for Sudocode; its `root` must stay distinct from `store_dir`.

`agent_runtime` is the harness boundary. `prompt_adapter` is `portable` or `claude-code`; `command` is the chosen CLI executable; `args` is its argument vector using exact `{role}` and `{package}` placeholders; `progress_interval_seconds` defaults to 20. `runs_dir` receives one durable JSON record per child process: role, package digest, PID, timestamps and exit status, never the potentially sensitive output. The driver uses no shell, streams both output channels, emits heartbeats and propagates interruption. Do not put Codex, Claude Code or Kilo Code flags in a core script — only in this project configuration.

Once that command runs, `node agent-pipeline/dashboard/server.mjs` provides the local live surface over the same NDJSON events. It launches `dispatch.mjs`; it does not schedule, persist pipeline state or replace the store. Binding stays on the loopback interface, and a server restart deliberately forgets runtime output.

`workflow.max_transitions_per_run` bounds one orchestration context; four lets a nominal issue traverse its complete cycle while preventing a session from swallowing a spec. `workflow.gates.low|normal|high` is either `"all"` or a list of declared command keys. Low and normal lanes buy fast feedback; commands omitted from normal are replayed in the final closure battery. High-risk paths should stay `"all"`.

`findings_path` remains the legacy destination for exported framework notes. Product findings themselves live once, in `discoveries_declared`; `findings.mjs` computes the inbox from that store data.

The mechanism they leave behind is worth knowing before you read a store. A role that notices something real outside its issue declares it in `discoveries`, and the framework refuses to let the issue close until the finding reached somewhere. That part was right. What was wrong was having a single somewhere: every finding became a `planned` issue in the product's backlog. Measured on a real port — **32 findings for 3 issues closed, eleven new issues for every one finished**. A backlog growing faster than it drains never converges, and the operator watches a day of work produce nothing they asked for.

A finding now defaults to `parking`, with no phase and no reservation. Only `criterion`, `regression` and `delivery_blocker` can block the current closure, because they name a contradiction or obstacle in the accepted delivery. `framework` stays outside product scope. Once a spec is active, its planned issue list is frozen; adding work requires `scope_change { approved_by: "operator", reason, approved_at }`.

**A document may not prescribe a gate you do not have.** The briefs are compiled from these documents, and these documents describe gates a given project may never declare. Measured on a real port: nine rules across the four briefs named commands nothing answered for — in the very pages that teach the rules. A reader cannot tell such a rule from one that binds them, so they invent the gate, skip it in silence, or stop trusting the document; the third is the expensive one.

`sync-briefs` therefore refuses to compile a brief naming a gate neither declared in `commands` nor shipped as a core script. The way out is not to delete the teaching but to condition it: wrap the passage in `<!-- gate:NAME -->` … `<!-- /gate -->` and it is dropped for projects without that gate, kept for the others.

**The workflow pins one action, and you pin the other.** `actions/checkout` is named by the framework's template and nothing else is: the runtime setup comes from your `ci.runtime_setup.uses`. When GitHub deprecates a runner, the warning names both, and only the first is ours to bump — a test asserts the pinned major so the bump is deliberate rather than forgotten. Yours is a line in the configuration, which is why the framework does not touch it.

**The project type is a decision, so the command helps make it.** Run `render-architecture.mjs` without a type and it answers with the four, each with what it is, in the operator's language — rather than four bare words. What decides between a web interface and a full-stack repository is the data: a web interface reads data it does not own, so a project holding its own database is `fullstack`. That is the distinction a real bootstrap got wrong.

**The project type filters the catalogue, and it says when that costs you something.** An option the analysis RECOMMENDS and the declared type removes is a contradiction between the two things the operator said, and the page reports it — observed on a real bootstrap, where a project declared `frontend` while its analysis carried a database it expected to replace, and hexagonal disappeared without a word. Only recommendations surface: `possible` is not a contradiction, and listing it would offer MVVM to a back-end service, which is the catalogue review the page exists to replace.

**The architecture page starts from a description, never from a form.** Give the agent what the product is, in your own words — what it does, for whom, what it refuses. It draws an analysis from that, and the page then asks only what your description left open, judging each option on what you said.

The distinction that makes this work is between an answer and a silence. An analysis with `integrations: []` says « we integrate with nothing »; an analysis with no `integrations` field says nobody asked. The framework once read the second as the first, reported « no integration to replace » about a project it had never questioned, and declared hexagonal excessive on that ground. An option whose verdict turns on an unanswered question is now left **to determine**, naming the question, rather than judged on an absence.

Running the page with no analysis at all asks the eight questions in full. That is the degraded mode, not the intended one.

`project_map` needs three values, not one: `out` (where the map lives), `regenerate` (the command that WRITES it) and `commands.project_map` (the one that verifies it). Declaring only the verification is the state every project started in, and it leaves the map with no writer but the agents themselves — which is what serialised whole waves. `apply-profile` refuses a `project_map.out` with no `regenerate` beside it, and refuses a `file_policy.orchestrator` forbidding the path the Orchestrator is the only role allowed to write.

`closure_gates` names the gates run once on the pull request rather than on every push — what is too slow to replay per commit. The map's gate is deferred whether or not it appears there: it is stale on the branch by construction, and that is not the operator's call to make.

`language` decides which language the rendered pages are written in. `en` and `fr` ship; anything else is refused at configuration time rather than at the first page, hours later, where a typo looks like a broken script. Omit the key and the pages are English.

Everything else here is written in English because models follow it more reliably. **The pages are the exception, and deliberately so**: they are the one artefact read by a person rather than by an agent, which is the same reason this repository's README is not in English either. The structure of the catalogue — ids, layers, allowed directions — stays in the code whatever the language, so a translation is added without touching a rule, and a rule changes without touching a translation. A test refuses a key present in one language and missing from the other, because a missing key renders as a blank space nobody notices. A second one renders **every** page on a French project and refuses any English left standing in the result: parity alone would pass a renderer that never reads the dictionary at all. That is what the six pages cost to keep honest — a sentence written straight into a renderer is caught by a run, not by a review.

`decisions_dir` is required, and the directory must exist. The rendered harness entry point and Product prompt send sessions to the decisions journal before touching a past decision. Until 2026-08-19 those instructions pointed at no configured path. The path now reaches every adapter's rendered prompt.

An empty journal is accepted: a new project has decided nothing yet, and that is worth recording as such. What no command can check is whether a decision that was taken got written down — that judgement is the operator's, and pretending to enforce it would be worse than saying so.

`pages_dir` is optional and worth setting on the first day. The renderers write the pages an operator reads — architecture, design system, tokens, arbitration queue — and a bare file name lands there rather than wherever the command was run. Without it they accumulate at the project root, next to the source, and nothing ever says where they belonged. Add the directory to `.gitignore` too: those pages are artefacts of a decision, not sources.

A name carrying a directory is still taken as given. And `render-architecture` runs before any configuration exists, since it produces the decision the configuration then records — it therefore asks where to write without depending on the answer.

You are free to place them where you want, and that is the point: none of it is fixed in the core. Grouping the machinery under a single directory — `pipeline/profiles`, `pipeline/briefs`, `pipeline/store`, `pipeline/rules.json` — avoids fighting the host project for names it wants for itself, `docs/` and `scripts/` first among them. Only `AGENTS.md`, the harness entry point when its adapter needs one, the prompts directory and `pipeline.config.json` stay at the root.

`rules_path` is rendered from `agent-pipeline/schemas/rules.json`, then completed with the profile's `file_policy`. Later renders update machine rules as well as policy; `--check` refuses either kind of drift.

For a Python project, `check` becomes `mypy .`, `lint` becomes `ruff check . && ruff format --check .`, `test_unit` becomes `pytest`. For a Svelte project, `check` becomes `svelte-check`, `test_unit` becomes `vitest run`.

Also adapt:

- `file_policy` — the `deny` globs must cover the project's real paths; the `implementer` entry is mandatory;
- `human_review_paths` — authentication, migrations, anything that must never be approved by a machine alone;
- `project_map.roots` and `project_map.skip` — the roots to map and the test-file pattern;
- `ci.provider` — `"none"` if you install no CI, and know then that QA will actually run every gate instead of reading a run.

### 3. Write the project tools

Two scripts live in `scripts/` and are specific to the stack.

#### The project map: you must write it, and this is not negotiable

**The inherited map generator will not work in your project, and you must write one.** This is the step this guide asks for most explicitly, because it is the one whose omission is the quietest.

The origin project's script imports a language-specific parser and collects only that language's files. In a project of another stack it will not even start — that is the **happy** case: the failure is loud. The unhappy case is a project where it starts, finds no matching file, writes an empty map, and where `--check` compares empty to empty and **exits 0**.

**What the pipeline loses if you skip this step.** The project map is the answer to "does this already exist?", read before creating a module, a service, a helper or a test harness. The **reuse note required of every addition is judged against it**: without an accurate map, that note is judgeable by nobody, and the gate demanding it becomes a formality. Agents then recreate what already exists, each on their own, without any gate noticing — and the pipeline loses the memory of what it has built.

So this is not a convenience tool. It is the only mechanism by which the pipeline knows what it contains.

**What the core requires, and nothing more**: an output path, a regeneration, and a `--check` that exits 1 when the map is stale. The generator's language is free — write it in the project's own. In Python the standard `ast` module is enough; in Go, `go/ast`; in JavaScript or TypeScript, the compiler API.

**What it must produce**: every public export with its nature and the role its documentation gives it, test harnesses included.

**How to prove it works, by a command and not by reading:**

```
node agent-pipeline/scripts/map-coverage.mjs
```

It counts the source files under `project_map.roots`, removes those `skip` excludes, and requires that **each one** is cited in the rendered map. It knows neither your language nor your map format: it matches on file name. Exit 1 if a single one is missing, exit 1 as well if no source file is found — which catches a misconfigured `roots`.

That check is what distinguishes an empty map from an up-to-date one. The `project_map` gate compares the map to its regeneration: it catches a **stale** map, never an **empty** one. Both go green when the generator collects nothing.

Run it after every regeneration, and make it a gate of your configuration if you want it to block on its own.

**If you decide not to port the map**, delete the inherited script instead of leaving it in place. A dead script bearing the name of a gate is worse than a missing one: the next agent will read its name in the config and believe it active.

**The comment policy** forbids narration and accepts only contracts on exports. Comment syntax changes with the language; so do the scanned roots.

### 4. Render, then check that the render is real

`apply-profile` refuses to render without the `project_context` file and gives you the missing path. Write its three blocks — `<!-- claude:summary -->`, `<!-- claude:commands -->`, `<!-- claude:context -->` — before running the command; an empty block is refused like a missing file.

```
node agent-pipeline/scripts/apply-profile.mjs
node agent-pipeline/scripts/sync-briefs.mjs
node <your map script>
```

Then, and this is the step nobody skips:

```
node agent-pipeline/scripts/apply-profile.mjs --check
node agent-pipeline/scripts/sync-briefs.mjs --check
node <your map script> --check
```

All three must exit 0. These three `--check` are the generated targets: a repository where one of them drifts is working on a stale policy without knowing it.

### 5. Prove that every gate really refuses something

**Do not settle for running the gates and seeing them green.** A green gate on a healthy repository proves nothing: it may be green because it measures nothing.

For every command in `commands`, deliberately break what it is meant to catch and check that it fails:

| Gate | What you break | What you expect |
| --- | --- | --- |
| `check` | an obvious type error | exit ≠ 0 |
| `lint` | a badly formatted file | exit ≠ 0 |
| `test_unit` | invert an assertion | exit ≠ 0 |
| `design_limits` | a function with one parameter too many | exit ≠ 0 |

And check the `architecture` block the same way: change its `id` to `hexagonal` on a `frontend` project and confirm `apply-profile --check` refuses. A key nobody validates is a key that will be wrong one day without anyone noticing.
| `coverage` | check that it runs **all** the suites it measures | a file proven only end to end must not count as uncovered |
| `mutation` | check it has not reused its cache | a report saying "n of n reused" measured nothing |
| `project_map` | add an export without regenerating | exit ≠ 0 |
| `secrets_scan` | add a fake key | exit ≠ 0 |

Restore after each attempt.

**And check that your break actually breaks.** A replacement pattern that matches nothing leaves the gate green and proves nothing — this has happened three times on the origin project in a single day, each time producing a reassuring green.

Two lines of that table come from defects actually found on the origin project, gates green: `coverage` collected over all source files but ran only one suite, and `mutation` reused its cache — its own report announced "31 of 31 mutant result(s) are reused". Both were fixed there.

The `project_map` line is of another nature, and the distinction matters to you. The origin project's map is **accurate** there, and there is nothing to fix. The trap appears only at porting time, when the stack changes and an inherited script keeps looking for files that no longer exist. It is the hardest defect to see, because it comes from a tool that was right somewhere else.

### 6. Install the hooks

`pre-commit` runs the formatter, `lint` and `secrets_scan`. `pre-push` runs `check`, `lint` and the three generated-target `--check`. Without them, the rules of step 4 are triggered by nothing.

Check they are **installed**, not merely written: a `.git/hooks/` containing only `.sample` files means no hook runs.

### 7. Initialize Sudocode and seed the control store

Sudocode is the issue/spec source. Initialize it at `issue_tracker.root` through its CLI; do not fabricate its files:

```
sudocode init
```

The separate pipeline control store is `<store_dir>/issues.jsonl` and `<store_dir>/specs.jsonl`. Two empty files are enough to start. Never place it under `.sudocode`, whose exports may discard pipeline-only fields.

```
node agent-pipeline/scripts/tracker-sync.mjs
node agent-pipeline/scripts/store-verify.mjs
node agent-pipeline/scripts/next-step.mjs
```

The tracker check and store invariants must pass; `next-step` must report that there is no step to run. The pipeline is ready.

## The final checkpoint

Before handing back, answer these questions with a command, never with a reading:

1. Do `apply-profile --check`, `sync-briefs --check` and the map `--check` all exit 0?
2. **Did you write the map generator, and does it really cite the code?** Count the files under `roots` against the rendered entries. A green `--check` on an empty map is green.
3. Has every gate in `commands` failed at least once, on a deliberate break?
4. Does `preflight` confirm that **every declared gate is executable**? An unrunnable gate fails instead of protecting.
5. Are the hooks installed and do they fire?
6. Are `tracker-sync` and `store-verify` green against the real Sudocode files?
7. Does every profile invariant have a gate that makes it fail?

**An "I think so" to any of these seven questions is a no.**

## What you do not decide

Three things stay with the human operator, in every profile: **installing a dependency**, **editing `pipeline.config.json`** once the pipeline is running, and **merging**. During the initial installation you write the configuration — that is its purpose — but as soon as the pipeline runs, it passes into the operator's hands.

Report, do not invent: an unavailable command is escalated, never replaced by a substitute pretending to prove the real system.

## Seeing the tokens before drawing anything with them

```
node agent-pipeline/scripts/render-tokens.mjs <output.html>
```

This is the one part of the visual work the framework can render honestly. A spec page lays out fields somebody already wrote; a screen mockup has no such source, because the drawing **is** the content — a script that rendered one would be inventing it, and an invented design is the average of everything the model has seen. The tokens do have a source, and it is declared.

The page puts them side by side, which catches in one look what no reading of the file catches:

```
--ink     / --accent     3.28:1  too weak for text (needs 4.5:1)
--paper   / --grey-1     1.03:1  nearly indistinguishable
--space-3 15px                   a step away from --space-4, which is no step at all
```

Contrast is computed for every pair, using the formula the accessibility guidelines define — reproduced in the script rather than installed, since the core depends on nothing and a ratio nobody can compute is a ratio nobody checks.

Two colours a reader cannot tell apart are **named, not refused**: a hover state may legitimately sit that close. The page shows the distance and the operator decides. What the accessibility command refuses is a separate question, and it belongs to the project's tool.

## The mockup is checked against the tokens, not drawn beside them

The design-system page states the order that holds: tokens, then primitives, then a finished mockup built from the primitives that exist, then screens. It also states what a mockup is — *an assembly of things that exist, not an image to reproduce*. Nothing made that true until `mockup-check.mjs` existed.

**The form is fixed even though the drawing is not.** A mockup is a self-contained HTML page, handed over like every other page: published if the harness can host it, otherwise by its path. That is not a taste — the check reads token references out of the file, so a form carrying none cannot be checked at all. A real run pointed the field at a `.svelte` component and the check read it happily; a component is also the code, which is what made the check circular.

```
node agent-pipeline/scripts/mockup-check.mjs <mockup-file>
```

It reads every colour, length and font the file states and refuses each one that traces back to no declared token. A reference through `var(--token)` counts as a value stated correctly, so a mockup built the right way passes while a mockup with no styling at all is refused — the two look alike to a naive counter and mean opposite things.

**This is also where the machine-made look is caught.** An agent asked for a screen reaches for a plausible value, and plausible converges: the same near-black, the same blue, the same font. Run against a mockup carrying the usual tells, it names all of them:

```
colour  #0a0a0f — nearest declared token: --ink
colour  #3b82f6
length  13px
font    Inter, sans-serif
```

The nearest token is only offered when there is a real neighbour. Suggesting the cream token for a blue would be followed, and a hint that lies is worse than no hint.

## Projects with screens declare their design system

A project with screens also declares `commands.accessibility`. It sits here rather than in the general list because a service with no screen has nothing to check. The reason it is a command at all, when the rest of interface design is not, is that it is the measurable half: contrast ratio, focus order, keyboard reachability, what a screen reader announces. Everything else a design skill says is judgement, and judgement is argued in review.

For a TypeScript frontend, `agent-pipeline/profile-bundles/frontend-typescript` is the reference contract. Importing it names the required surfaces without choosing a UI framework: compiler, architecture boundaries, tokens, accessibility, browser flows, visual regression, dead code, duplication and production smoke. Its npm script names are interfaces, not implementations. Replace each with the selected project's real tool, make it fail on purpose, and only then clear `calibration_required`.

`apply-profile` refuses a `frontend`, `mobile` or `fullstack` project that has no `design_system` block. A back-end project is never asked: putting a question where there is no screen produces an empty key that people learn to skip, and a question people learn to skip ends up hiding the ones that matter.

The reason is the architecture's reason, one level down. Tokens, primitives, product components and screens form an order that cannot be reversed afterwards: primitives written before tokens carry hardcoded values, and a finished mockup drawn before tokens invents a scale the code then copies. Left undeclared, the agent taking the first issue settles all of it alone — it needs a colour and a spacing to write anything — and every issue after inherits a decision nobody approved.

```
node agent-pipeline/scripts/render-design-system.mjs <output.html> <frontend|mobile|fullstack> [analysis.json]
```

The page lays out the four layers in the order they constrain each other, answers the "do we draw the mockup first?" question rather than dodging it, and weighs the three honest options for the primitives — a full component library, an unstyled one, or writing them yourself — with accessibility named as the criterion that decides. A library that handles neither focus nor the keyboard nor screen reader announcements is a set of styles, and the hard work is still ahead.

Declare `{ tokens, primitives, direction, decided_at }`.

`direction` is `{ genre, because }`, and it is the key that keeps two of your projects from looking alike. Not because the framework picks differently each time — it picks nothing — but because a genre nobody had to justify was picked by habit, and habit is what makes two products converge. The design skill refuses the framework defaults by name; left to itself it then converges on its own examples instead, which is the second template its own reference file describes: an interface recognisable as "an agent that read an anti-generic guide". Finishing the sentence "this genre suits the product because ___" is what breaks that. The core does not judge the system: `own` and a library name are equally valid answers. It requires **one** source of truth for the tokens, because two drift apart in silence and the drift is only found in a screenshot.

## The project map, and the generator the framework ships

`commands.project_map` is required, and the map it produces is what the reuse note is judged against. The generator, however, has to know something about your language, which the core does not.

So the framework ships one that knows none: `agent-pipeline/scripts/project-map.mjs`. It recognises declarations by **pattern** across the shapes several ecosystems share — `export function`, `export class`, `pub fn`, `def`, `func`, `export const` — and reads the documentation line above each one. It walks the roots and extensions declared in the `project_map` block.

**It is deliberately weaker than a real parser.** A re-export through an index, a name assembled at runtime, a class member and anything shaped differently are invisible to it. The map says so about itself rather than implying completeness, because a map trusted beyond its worth is worse than an obviously partial one.

Point `commands.project_map` at a generator that parses your language the day you want roles, routes and types in the map. This repository's own profile does exactly that, and its map reads `CatalogController — controller — POST /books` where the shipped generator reads `CatalogController — class`.

**The failure it guards against is not a missing map, it is an empty one.** A generator written for another stack walks a tree it does not recognise, produces a near-empty document, and `--check` then compares empty with empty and exits 0 — a green gate asserting nothing, worse than no gate since checking stops. Hence two refusals: no file found under the roots and extensions, and not one declaration recognised. Both name the setting to fix, because a reader who sees a bare failure concludes the framework is broken.

## The `duplication` gate, required of every profile

Every prompt already demands a **reuse note** for any new component, module or helper, and that note is judged against the project map. Judged by a human, in review — which means judged when someone remembers to look. On a codebase with two hundred small components, nobody looks.

`apply-profile` therefore refuses a configuration without `commands.duplication`. The gate refuses a block repeated across the codebase, and it is to reuse what `design_limits` is to single responsibility: an approximation that actually refuses something.

The framework ships one implementation, `agent-pipeline/scripts/duplication.mjs`, so that no project is blocked waiting for a tool. It is deliberately crude: it compares **significant lines with indentation normalised**, because a paste is almost always reindented on arrival, and it does not strip comments — that would mean knowing the language, and the core knows none. Point the key at `jscpd`, `pmd cpd` or anything else the moment you want a token-level analysis.

It reads a `duplication` block: `roots` (required, because a scan of the wrong tree is green for the wrong reason), `min_lines` (default 6) and `skip`. Below about six lines you are not finding rewrites, you are finding shared conventions, and a gate that cries wolf gets ignored.

**Expect it to be red on its first run**, and read what it found before touching the threshold. On this repository it found three real clones on day one: the whole e2e bootstrap copied across three suites — while the project map advertised nine reusable test harnesses — and the same fixture literal asserted in a unit spec and an e2e spec. Loosening the threshold would have hidden all three. A threshold loosened once loosens again.

## The `design_limits` gate, required of every profile

`apply-profile` refuses a configuration without `commands.design_limits`. The core does not know your tool, but it requires a gate bounding four things:

| Bound | What it approximates |
| --- | --- |
| cyclomatic complexity | KISS, and a proxy for single responsibility |
| function length | single responsibility |
| parameter count | interface segregation |
| nesting depth | KISS |

**These are not SOLID.** They are measurable approximations of what SOLID protects: a two-hundred-line function almost always violates single responsibility, the converse is not true. An imperfect gate that really refuses something beats a principle nobody checks — and without it, single responsibility applies to nothing, the code being good only if the model is.

**Open-closed and Liskov are partly approximable**, and the two forms worth catching are visible in the syntax alone:

| Form | Which principle | Why it is a real signal |
| --- | --- | --- |
| a method of a derived class that throws unconditionally | Liskov | a caller holding the base breaks on the subclass; the inheritance is a lie |
| a chain of `instanceof` deciding behaviour | open-closed | adding a case forces reopening that function |

In an ESLint profile they are two `no-restricted-syntax` selectors: `ClassDeclaration[superClass] MethodDefinition > FunctionExpression > BlockStatement > ThrowStatement`, and `IfStatement > IfStatement.alternate > BinaryExpression[operator='instanceof']`. Transpose them to whatever your ecosystem uses to query a syntax tree.

**They do not prove the principles.** A Liskov violation through a narrowed precondition, or through a return that no longer honours the contract, is invisible to any syntax query — that part stays in human review, and the profile invariants should say so rather than let anyone believe the gate covers it. What these two buy is the same thing the four bounds above buy: the cases where the violation is written down plainly stop passing.

Three requirements of form, learned while putting this gate in place:

- **Calibrate on real code before freezing the thresholds.** Measure the observed maxima, set the bound above them. A round number chosen in advance breaks on the first run, then gets loosened — and a gate loosened once loosens again.
- **Separate it from the style gate.** A function that has become too complex is not a formatting fault; confusing the two makes both read the same way, which is to say inattentively.
- **Exempt test blocks from the length limit.** A long scenario describes a journey, it is not debt.

The tool is free: `eslint` for TypeScript, `pylint` with `max-complexity` for Python, `gocyclo` for Go. The core sees only a key and an exit code.

## What the agnosticism gate refuses

Porting the pipeline to another stack reveals the couplings nobody saw while writing it. Five of them are now refused by `agent-pipeline/test/agnosticite.test.mjs`, and therefore found before the port rather than during it:

- no core script invokes an ecosystem's task runner — a Python, Go or Rust project has no `package.json`, and the core depends only on Node;
- no core script imports an installed package: native modules and relative siblings only, because the core does not install;
- no core script hard-codes a path the configuration owns (`rules_path`, `store_dir`, `briefs_dir`, `profiles_dir`);
- every core CI step runs through `node` directly, never through the project's stack;
- the stack's steps stay a placeholder in the template, never a written command.

The comparison is made on the code stripped of its comments: a piece of guidance may legitimately quote a tool in prose, only an invocation is a coupling. The gate's own file excludes itself, and that is named rather than worked around — a pattern twisted so as not to see itself ends up not seeing what it looks for either.

## Choosing the architecture, at configuration time

```
node agent-pipeline/scripts/render-architecture.mjs <output.html> <backend|frontend|mobile|fullstack> [analysis.json]
```

With no analysis attached, the page first asks **eight questions in plain language** — a kind of non-final brief. The order is what matters: presenting eight options to someone who has not yet described their product is a catalogue, not a decision aid.

**B3 is the question that detects the domain**: *are there situations where the system must REFUSE something?* Not a required field nor a format — a real refusal, "this book is already out", "this account does not have enough". A system that never refuses anything for a reason coming from the real world has no domain, it has a schema. **B4 checks** that the refusals cited really are refusals: would a professional of the trade understand them without anyone mentioning computers?

The answers become a structured analysis, attached as the third argument. The page then renders **reasoned advice**: each option gets a verdict and its reasons, drawn from the analysis and quoted. "No declared integration is replaceable: the ports would be insurance whose payout you will never collect" can be argued with; a ranking with no reason is simply accepted.

The analysis must carry `business_rules`, even empty: saying there are none is a conclusion, not an oversight, and the validator refuses a missing field.

The framework **does not choose** the architecture: that would impose an answer to a question that depends on the product. It makes the choice explainable, then enforceable.

The project type filters the catalogue, and that is not cosmetic — it changes the answer. A back-end service sees hexagonal and Clean; a web interface sees feature slices and MVVM, and does not see ports, which answer a constraint it does not have. A full-stack repository additionally receives the only question that really matters there: **what crosses the boundary between the two sides**, because that is what decides what breaks when one side moves.

The page opens on the **questions that decide**, before any architecture name. The first eliminates the most options on its own: *how many adapters will you actually replace?* If the answer is zero — and for a database it almost always is — ports are a ceremony every new route pays for.

Each option publishes **the declaration the configuration will carry**: its layers and the allowed direction of dependencies. The operator therefore reads exactly what the gate will enforce, instead of choosing a name and discovering the constraint at implementation time.

The profile then translates that declaration into a gate for its stack — import zones for TypeScript, the equivalent elsewhere — and the rule joins `invariants.md`, where each bullet names the gate that refuses it. An architecture written only in a document would not be an architecture: it would be an intention.

## Knowing when the architecture no longer holds

```
node agent-pipeline/scripts/architecture-drift.mjs <graph.json>
```

The initial choice does not have to be final; you still need to know when it has stopped fitting. The detector confronts the dependency graph with the signs written in the catalogue: a module importing three others, two modules importing each other, a shared file with a single consumer, a shared directory turned catch-all, a module three times bigger than the others. Every signal says what it **means** and what to **look at next** — a signal with no follow-up is an alarm, not a diagnosis.

**The framework judges, it does not extract.** Reading imports requires knowing a language; the core knows none. The project therefore supplies the graph in a neutral form — `modules` with their `files` and `imports`, the `shared` files with their consumers, and the `composition_root` — and that boundary is what makes the detector portable. The extractor belongs to the project: it knows the language, so it cannot live in the framework.

Two precautions are worth knowing, because they decide whether the detector gets read or ignored:

- **it stays quiet on a young project.** Below four modules and twenty files, a shared file with a single consumer fires systematically and wrongly — the second module simply does not exist yet. It announces the fact instead of going silent;
- **the composition root is excluded.** The file assembling the application legitimately imports everyone; counting it as coupling would produce a permanent alarm, and a permanent alarm stops being read.

What it **does not see**, and writes on every run: two modules applying the **same business rule** with different code. An import graph does not see meaning. That trigger is found by reading, never by computing, and claiming it covered would be worse than not looking for it.
