# Installing the pipeline in a new project

This document addresses the agent configuring the pipeline in a repository that does not know it yet. It assumes `agent-pipeline/` has just been copied to the project root and nothing else has been done.

It is not an introduction to the pipeline. For what it does and why, read `AGENTS.md` **after** rendering it, then `state-machine.md` and `quality-gates.md`.

Throughout this document, **a gate** means a command that either passes or fails. If it fails, the work does not move on. Gates are named by key — `check`, `lint`, `test_unit` — in `pipeline.config.json`; the key stays the same across projects, the command behind it changes with the stack. That is what lets these documents point at a gate without knowing your tools.

## What you configure, and what you do not touch

`agent-pipeline/scripts/` is **agnostic**: those scripts know no language, no framework, no package manager. They read the store, compute the schedule, validate handoffs. You do not touch them, and you introduce no stack dependency there — the same rule holds for `agent-pipeline/prompts/`, `agent-pipeline/docs/` and `agent-pipeline/templates/`.

Everything that speaks of the stack or of this repository lives in six places, and those are the six you write:

| What | Where | What it carries |
| --- | --- | --- |
| The configuration | `pipeline.config.json` | commands, `file_policy`, directories, human-review surfaces, CI |
| The invariants | `<profiles_dir>/<profile>/invariants.md` | section 9 of `AGENTS.md`: what is forbidden in this language |
| The stack skills | `<profiles_dir>/<profile>/skills/` | what a skill knows about this stack and that has no place in the core |
| The repository context | the `project_context` file | the three `CLAUDE.md` blocks: what the project is, its local commands, its accepted limits |
| The project tools | `scripts/` | the project map, the comment policy |
| The standards | `docs/stack/` | conventions reviewed by QA |

Skills are sorted by a single question: **would this skill still be right in a project on another stack?** If yes it belongs to `agent-pipeline/skills/` and travels with the pipeline. Otherwise it belongs to the profile. A web-interface skill in the core would make the core wrong for a Go project; `apply-profile` refuses the same name on both sides.

`AGENTS.md`, `CLAUDE.md`, the `rules_path` file, the rendered prompts and the skills installed into `skills_dir` are **generated** by `apply-profile`. Never write them by hand: your change will be overwritten at the next render, and `apply-profile --check` will report it as drift before that.

`CLAUDE.md` is loaded on every session and carries the obligation to ask "pipeline or direct" before acting. A repository without it starts with no entry point: that obligation then happens for nobody, and nothing reports it — which is why it is rendered rather than left to your good will.

## The order, and the check after each step

### 1. Name the profile and write its invariants

Choose a short descriptive identifier: `api-fastapi`, `web-svelte`, `cli-go`. Write `<profiles_dir>/<profile>/invariants.md` — `profiles_dir` is declared in your config and lives at the project root, never inside `agent-pipeline/` — as a bullet list, each bullet checkable, each specific to the language.

A useful invariant forbids something precise that the language makes easy. "Write clean code" is not an invariant; "no `any`" and "no bare `except:`" are.

For every bullet, ask: **which gate makes it fail?** If the answer is "none", either you add the gate at step 3 or you remove the bullet. If no command can refuse it, the rule never applies — that is this pipeline's most expensive lesson, and it is relearned in every project.

### 2. Write `pipeline.config.json`

Start from the origin project's file and replace every value. The `commands` keys are a contract: prompts and documents designate gates **by their key**, never by the command. `check` must remain type checking whatever tool provides it.

Mandatory keys, refused if absent: `check`, `lint`, `build`, `test_unit`, `audit`, `secrets_scan`, `project_map`, `design_limits`.

Also mandatory, outside `commands`: an `architecture` block, `{ id, project_type }`. The operator chooses it — `render-architecture.mjs` lays out the options for their project type — but the choice has to be **written down**, because a decision that lives only in a rendered page binds nobody. The agent installing the profile lays the code out one way, the next agent lays it out another, and drift is undetectable because nothing states what it drifts from.

`apply-profile` refuses an unknown id, and refuses an id that does not apply to the declared `project_type`: hexagonal ports and adapters proposed for a browser interface is a catalogue copied out, not a decision. `"custom"` is a valid answer and requires a `note` — that note then **is** the reference.

Mandatory paths, refused if absent: `profiles_dir`, `docs_dirs`, `briefs_dir`, `prompts_dir`, `skills_dir`, `rules_path`, `project_context`, `store_dir`.

You are free to place them where you want, and that is the point: none of it is fixed in the core. Grouping the machinery under a single directory — `pipeline/profiles`, `pipeline/briefs`, `pipeline/store`, `pipeline/rules.json` — avoids fighting the host project for names it wants for itself, `docs/` and `scripts/` first among them. Only `AGENTS.md`, `CLAUDE.md`, the prompts directory and `pipeline.config.json` stay at the root: the platform looks for them there.

`rules_path` is **seeded** at the first render from `agent-pipeline/schemas/rules.json`, then completed with the profile's `file_policy`. You do not copy it yourself.

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

### 7. Seed the store

The store is `<store_dir>/issues.jsonl` and `<store_dir>/specs.jsonl`. Two empty files are enough to start.

```
node agent-pipeline/scripts/store-verify.mjs
node agent-pipeline/scripts/next-step.mjs
```

The first must report the invariants respected, the second that there is no step to run. The pipeline is ready.

## The final checkpoint

Before handing back, answer these questions with a command, never with a reading:

1. Do `apply-profile --check`, `sync-briefs --check` and the map `--check` all exit 0?
2. **Did you write the map generator, and does it really cite the code?** Count the files under `roots` against the rendered entries. A green `--check` on an empty map is green.
3. Has every gate in `commands` failed at least once, on a deliberate break?
4. Does `preflight` confirm that **every declared gate is executable**? An unrunnable gate fails instead of protecting.
5. Are the hooks installed and do they fire?
6. Is `store-verify` green?
7. Does every profile invariant have a gate that makes it fail?

**An "I think so" to any of these seven questions is a no.**

## What you do not decide

Three things stay with the human operator, in every profile: **installing a dependency**, **editing `pipeline.config.json`** once the pipeline is running, and **merging**. During the initial installation you write the configuration — that is its purpose — but as soon as the pipeline runs, it passes into the operator's hands.

Report, do not invent: an unavailable command is escalated, never replaced by a substitute pretending to prove the real system.

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
