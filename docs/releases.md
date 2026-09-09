# Releases and updates

agent-pipeline follows semantic versioning from `VERSION`. A Git tag with the same value, prefixed by `v`, identifies the exact framework revision installed in a project.

Prefer a pinned submodule for an updatable installation:

```sh
git submodule add https://github.com/HerbertCodex/agent-pipeline.git agent-pipeline
git -C agent-pipeline checkout v0.4.0
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
