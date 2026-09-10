# Releases and updates

agent-pipeline follows semantic versioning from `VERSION`. A Git tag with the same value, prefixed by `v`, identifies the exact framework revision installed in a project.

Prefer a pinned submodule for an updatable installation:

```sh
git submodule add https://github.com/HerbertCodex/agent-pipeline.git agent-pipeline
git -C agent-pipeline checkout v0.6.3
git add .gitmodules agent-pipeline
```

The host repository records the submodule commit. To update, fetch tags inside the submodule, review the release notes and diff, check out the chosen tag, rerun the framework tests and commit the new submodule pointer. Never track a moving branch implicitly in production.

An update does not automatically activate relational governance v2. Existing
`data_model` declarations retain their legacy behavior. After the framework update,
the operator reviews the project-owned contract and explicitly runs
`configure-data-model.mjs`; this keeps unresolved historical modeling, audit,
performance, authorization or restoration gaps visible instead of rewriting the
application during a framework upgrade.

Vendoring remains possible from a release archive, but the host must retain the version in a committed `agent-pipeline.version` file. Removing the nested `.git` without recording the source tag makes provenance and upgrades unverifiable, so it is no longer the recommended installation.

A release is published only after the release commit is merged, `VERSION` matches the intended tag, and the complete core test suite passes on that exact SHA. The tag and GitHub release are external publication steps requiring the operator's approval.

## Unreleased

No unreleased changes.

## v0.6.3

Three defects a host project measured while running the pipeline, not while
reading it.

**A proof the prompts promised QA never arrived.** The QA task package filled
`proofs.scope` from context blocks headed `## verify-scope `, and nothing
writes such a block: the orchestrator runs the command. The field was empty
three times running, on v0.5.2 and v0.5.3, while the record's transition said
the check was green. QA re-ran the command by hand each time. `verify-scope`
now takes `--record <path>` and hands its verdict back; `store-update` accepts
`scope_proof`, refusing one that names neither the commit it verified nor what
the command said; and the package reads `scope_proofs` from the record. A
proof a package announces and cannot carry is worse than an absent one,
because it reads as done.

**A classification blocked closures while no document named it.** The QA
prompt listed five values for `lands` and said three of them block; the
validator accepted eight and blocked four, including `spec`, which appeared
nowhere a role could read. An implementer declared exactly that value in a real
run. The table now carries the eight, marks the four that block, and says why
it grew. Two tests confront the validator's own lists with the prompt, so the
two cannot drift apart again.

**An issue that edits a build script could not replay its own red proof.**
`prepareWorkspace` compared each `dependency_inputs` file byte for byte, so a
changed `scripts.build` line read as a dependency change while the lockfile and
every dependency field were identical. The comparison now reduces a manifest to
the fields that decide an install; a manifest it cannot parse is still compared
whole, because refusing to read a file is not a reason to stop checking it.

Updating from v0.6.2 needs no project action beyond re-pinning. An orchestrator
that wants the scope proof to reach QA passes `--record` and persists it.

## v0.6.2

The README handed out a dispatch command that stops. Since v0.6.1 `dispatch`
refuses a phase the orchestrator still holds and names `transition.mjs`; the
README, in both languages, printed the dispatch alone — the same defect
`next-step` carried until v0.6.1, where the prose said transition-then-dispatch
and only the second half was printed. Both now print the move first and say why
it is a step of its own.

Three gates the core ships were absent from the list a reader consults to know
what they need not write: `secrets-scan.mjs`, `css-ownership.mjs`, and the
dependency-free floor for duplication, dead code, documentation contracts and
static analysis. Five guides existed and nothing linked them.

Nothing checked any of this. `test/readme-commands.test.mjs` now refuses a
README naming a script the framework does not ship, one printing a dispatch
before the move it requires, one omitting a shipped gate, and one leaving a
guide unreachable. Documentation drifts because no command refuses it.

## v0.6.1

This patch release settles what v0.5.2 got wrong. That release made `dispatch`
write the transition a held phase owes, which closed a real trap — a package
built on a phase the orchestrator still holds carries that record's hash, the
agent computes its handoff basis from it, and the move owed afterwards
invalidates it, stranding the issue — but broke an invariant the framework
rests on: the store is committed before a worktree starts from it. A dispatch
that writes the store dirties the tree it is about to require clean, and
refuses itself. v0.5.3 patched a first consequence, the tracker left on the
old status; the second had no patch.

The move is now a step of its own. `transition.mjs <issue> <role>` writes it
and projects it, refusing a phase that owes nothing and a project with no
tracker is not asked to project one. `dispatch` writes nothing and **refuses**
a phase the orchestrator still holds, naming that command: the trap stays
closed without the invariant being broken. `next-step` prints the move before
the dispatch it must precede, which is the piece that was missing all along —
its own reason said the orchestrator transitions then dispatches, and it
printed only the dispatch.

Eight tests, written first, all red; with either guard removed the tests that
measure it fall again. Updating from v0.6.0 needs no project action beyond
re-pinning: `transition.mjs` replaces a step dispatch used to take on its own.

## v0.6.0

This minor release turns one measured SvelteKit installation (2026-09-10) into
framework behavior, and repairs three gates found green for the wrong reason.

The SvelteKit bundle is now an **executable adapter**: `setup.mjs` discovers its
`installer.mjs` the way it always discovered Nest's, and a compatible official
scaffold goes from clone to verified pipeline in one command — dependencies
checked against the registry, gate tooling placed without ever overwriting a
host file, formatter ignores written, real checks run, and seven negative
proofs recorded in `setup-report.json` before `calibration_required` may fall.
The core gains no stack logic: only four generic hooks (the adapter may declare
its project types, a `prove` step, remediations beyond `package.json`, and
reported `kept_files`). `import-profile` now descends tooling subdirectories
file by file; a host that already had `e2e/` saw the whole directory kept and
the accessibility spec never landed.

A dependency-free **`secrets-scan.mjs`** ships in the core and is the template's
default `secrets_scan`: `secrets_scan` was mandatory with no shipped floor, and
a host gitleaks binary was measured with an inert built-in rule set — a scanner
that finds nothing is indistinguishable from a green gate without a negative
proof. It reads tight patterns, redacts what it reports, and says so.

**`preflight` no longer runs deferred gates**: it executed every declared
command, including `dast_active`, which installation policy forbids — the
installer had to bypass the control entirely. Closure and `ci.gate_events`
keys are reported `deferred`, off the exit code; `--include-deferred` replays
them. **`tracker-sync` refuses a vanished provider**: a deleted Sudocode
directory read as an empty, synchronized tracker.

`skip` now accepts the list-of-globs form the frontend bundle ships — five
scripts compiled it with a string-or-null guard and silently excluded nothing,
staying green over trees the configuration had excluded. The project map learns
`.svelte` and `.vue`. `security-scan.mjs probe` starts the disposable
environment and proves container-to-target reachability with one GET from the
pinned ZAP image before any scan traffic, with a diagnosis for dead or
VM-namespaced bridge gateways (Docker Desktop, WSL2). Docs gain stack recipes
(Rust, JVM, Go, Python — knowledge, not adapters), a timed demonstration
runbook, the k6 flat summary format, and the generated-targets formatter rule.

Deferred, and written in the bundle's VALIDATION.md: the end-to-end replay of
the SvelteKit installer on a fresh official scaffold is not yet automated.

## v0.5.3

This patch release completes v0.5.2. Dispatch now writes the transition a held
phase owes, but it left the tracker on the old status, and `task-package`
refuses a tracker whose status no longer matches the phase: the dispatch that
had just created the drift then reported it and stopped. The write and its
projection are now one step, in that order, before the package is built. A
dispatch that owes no transition still projects nothing.

## v0.5.2

This patch release closes a trap that stranded an issue in a real run. A phase
the orchestrator holds is a phase where nothing has started, and `next-step`
prints the dispatch command for it while saying, correctly, that the
orchestrator transitions *then* dispatches. Nothing performed that transition.
Dispatching anyway built the task package on the held phase, so the agent
computed its handoff basis on that record; the transition owed afterwards
changed the hash, `store-update` refused the handoff as stale, and
`dispatch-preflight` then refused every later dispatch for the issue because
that handoff was never consumed. Two rules, each right, and an issue nobody
could move. `dispatch.mjs` now writes the owed transition before it packages
the task, so the basis matches when the handoff comes back.

An attempt whose handoff can no longer be consumed is now recorded rather than
hidden: `store-update` accepts `abandon_handoff { sha256, reason }`, refuses a
blank reason and a digest it cannot read as one, refuses a digest already on
the record, and writes the abandonment on the issue with its date. The
preflight message names that route alongside consumption. Updating from v0.5.1
needs no project action beyond re-pinning; an issue stranded by the old order
is unblocked by one `abandon_handoff` naming why.

## v0.5.1

This patch release lets the core test suite pass on the Node a host project
runs, and lets the baseline scan write its evidence on a CI runner. The Codex
adapter added in v0.5.0 refuses any Node outside its manifest before it reads a
task package, which is what the manifest is for; but the test proving its
sandbox behaviour spawned it on the suite's own Node, so a host on Node 24 read
one red that described its runtime rather than the framework, and the generated
CI replays the suite on exactly that Node. The sandbox test now skips outside
the manifest and says why, and a second test, skipped inside it, proves the
refusal instead. The ZAP evidence directory is now world-writable when created:
the scanner image runs as its own user with its own home, a CI runner creates
the directory as an account the container does not share, and the scan then
completed every job and failed on the report it could not write.

A new `css_ownership` gate ships in the core and in the frontend bundle. It
refuses a class name claimed by two stylesheets unless the sheet named by
`design_system.primitives_sheet` owns it; see docs/quality-gates.md. A frontend
project adopts it by declaring that sheet and a `check:css-ownership` script;
a project that does not is unaffected. Updating from v0.5.0 needs no other
project action beyond re-pinning.

## v0.5.0

Runtime controls now fail closed instead of accepting declarations the core does
not honour. `attempt_isolation.root` selects the real worktree location, its
supported keys are validated, and `handoffs.mjs --prune` also removes integrated
worktrees and their `agent/<attempt>` branches for closed issues. Evidence-retention
destinations must match the store, run and handoff paths the core actually writes;
unsupported retention keys are refused.

Cleanup preview applies the same ancestry proof as cleanup itself. An unintegrated
branch is reported as retained before `--prune`, never advertised as removable.

QA gate runs reuse a valid exact-SHA CI proof already carried by their task package.
They query the provider only when that proof is absent or stale. Imported CI step
durations are retained when available; missing timing is recorded as `null` with
`duration_status: not_imported`, never as an invented zero.

Runtime prerequisites travel in the bounded task package and are no longer run by
the orchestrator as though host reachability proved reachability in an agent
sandbox. The Codex adapter machine-executes them through `codex sandbox` before the
agent starts. An adapter declaring prerequisites must explicitly state that it
executes them inside the agent environment. Finally, closing an issue whose reservation
overlaps `human_review_paths` requires a dated, durable operator-review receipt.

A vendor-neutral runtime boundary now ships a bounded Codex CLI adapter, and the
SvelteKit bundle ships an executable compatibility contract measured against the
official `sv 0.17.0` minimal TypeScript scaffold on Node 22.23.2. Both refuse
versions outside their manifests instead of treating a nearby major as compatible.

## v0.4.0

> **Breaking.** This release refuses an installation that v0.3.0 accepted.

`apply-profile` now refuses a profile that clears `calibration_required` while
recording nothing. The flag was already documented as a claim that someone
measured; nothing checked that the claim carried what it measured, so an
imported reference contract and a profile proven against the host repository
read the same a month later.

**Migration, one line.** A profile that cleared the flag must now say against
what. Record the stack under `detected` — `materialize.mjs` writes that block,
and a setup adapter now carries its own observation — or state it in one
sentence under `calibration_note`. A profile with no `profile.json` is
untouched: nothing was claimed there.

The Nest adapter records the runtime, package manager, test runner, linter and
installed versions it observed, and setup attaches them when it declares the
calibration done. It had them and discarded them.

## v0.3.0

This minor release repairs three generation defects found while installing v0.2.0
in a real project, and admits Nest 12 into the supported contract.

The derived platform permissions no longer refuse a path some role must write:
`**` was reported as globally refusable, and applying it stopped every write for
every role. Configuring a deep security control no longer shrinks the CI job it
adds work to. The generated workflow no longer writes a condition the workflow
always satisfies, so the conditions that do select stay visible.

The Nest adapter admits Nest 12 alongside Nest 11, both on Node 22 with npm
11.19.0. The official scaffold fails `npm audit --audit-level high` in either
version, on a `multer` pin its own dependencies carry, so the manifest now
declares the remediations that repair it: the vulnerable release is replaced by
its corrected one, and the deploy helper whose advisory chain has no fix is
removed. Setup applies and reports them.

Setup's contract changes accordingly: it installs no dependency **except to make
effective a declared remediation it just applied and reported**. An override only
reaches the audit through a regenerated lockfile.

Node 24 remains outside the contract. An isolated tracker initialization returns 0
on Node 24.21.0, but the complete setup still aborts in better-sqlite3's statement
destructor; see the Nest adapter's VALIDATION.md.

Updating from v0.2.x regenerates `.github/workflows/ci.yml` on the next
`apply-profile`, and `--check` reports the drift until then. What the workflow
executes does not change.

## v0.2.1

This patch release makes the core test suite independent of the working
directory. Four suites resolved shipped templates, adapter tools and the
durable run store against it, so running them from a host repository — which
the installation guide and the generated CI both do — read the host's files
and reported 13 failures that said nothing about the framework. A guard now
runs the whole suite from an unrelated directory, so the same drift fails
instead of reaching an installation. No behavior outside the tests changed;
updating from v0.2.0 needs no project action beyond re-pinning.

## v0.2.0

This minor release adds reproducible Nest setup and updates, project-owned dynamic
frontend and security profiles, authenticated ZAP and load-test controls, richer
dashboard evidence, and stack-neutral relational database governance. Existing
installations keep their current data-model behavior until governance v2 is
explicitly configured from a reviewed project contract.
