# Execution isolation and evidence

Dispatch checks generated configuration, role permissions, issue phase, dependencies,
and unapplied handoff receipts before starting a model. Reservations must be writable
by the implementer. `verify-scope` checks the observed commit diff against both the
role policy and the issue reservations, including both sides of renames.

Each dispatch creates a unique attempt and Git worktree. The host must be committed
and clean. QA starts at the implementation commit. Builds, indexes and seeded
`agent_runtime.workspace_paths` belong to the attempt. Declare `dependency_inputs`
(package manifest and lockfile) before seeding dependencies; their bytes must match
the selected commit. No dependency installation happens implicitly.

Worktrees and `agent/<attempt-id>` branches remain available for inspection. After
validating the receipt and scope, the orchestrator explicitly integrates the selected
branch with `git merge --no-ff <branch>` before applying its state transition. Resolve
conflicts and rerun affected checks before continuing. Remove a retained worktree only
after integration and evidence review. A crashed dispatch may leave its issue lock
under `handoffs_dir/dispatch-locks`; check that no process remains before removing it.

Dispatch requires a complete handoff with the package's `attempt_id`. Its archive is
immutable and addressed by SHA-256. Supply `handoff_path` to `store-update.mjs` so the
transition consumes that exact receipt and retains its context. An unconsumed valid
receipt blocks redispatch of the same issue. Historical manual handoffs remain
supported; they do not gain provenance retroactively. Context blocks are retained
unless a newer block explicitly names their IDs in `supersedes`.

Run the required gates after committing source and policy:

```sh
node agent-pipeline/scripts/run-gates.mjs <task-package.json>
node agent-pipeline/scripts/run-gates.mjs <task-package.json> --closure
```

Successful CI steps can replace local gates only for the same commit, with matching
commands and workflow bytes. Missing access, skipped steps and policy drift fall back
to local execution. Reports persist under `agent_runtime.runs_dir/gates` and appear
in the dashboard. This avoids replaying an already proven battery; it does not replace
QA's criterion review, scope checks or negative proofs.

New implementation claims name `source_sha` and a literal reproducible command:

```sh
node agent-pipeline/scripts/replay-proof.mjs <literal-source-sha> node scripts/example-proof.mjs
```

The command executes in a detached temporary worktree. Dependency seeding requires
matching declared inputs. A negative proof should reference the commit containing the
failing case; a positive proof references the repaired commit. The wrapper records no
invented result: failure stays failure.

Findings can be grouped without turning every observation into new work:

```sh
node agent-pipeline/scripts/findings.mjs --group
node agent-pipeline/scripts/triage-findings.mjs triage.json
node agent-pipeline/scripts/triage-findings.mjs triage.json --apply
```

The input is a list of `{ source_issue, title, status, group, evidence }`. Status is
`parked`, `resolved`, `duplicate` or `promoted`; all except `parked` require evidence
or a named target. Preview before applying. Each issue update uses an optimistic hash;
a conflict can stop a multi-issue application after earlier issues were updated.
No issue is automatically created or scheduled.

Elapsed agent time includes its commands and waits. Cumulative agent time can exceed
wall-clock delivery time when agents overlap. Gate time is a subset, not an extra
cost to add. Incomplete historical records stay incomplete after dashboard restart.
