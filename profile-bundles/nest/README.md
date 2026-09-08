# Reproducible Nest setup

This is an executable setup adapter, separate from the manually calibrated export/import bundles. Run it from an existing, single-application Nest Git repository with its dependencies already installed and the framework at `agent-pipeline/`:

```sh
node agent-pipeline/scripts/setup.mjs --runtime claude-code
```

Use `--runtime portable` for plain Markdown role prompts. The runtime flag selects generated instructions; it does not install an agent CLI or configure automatic dispatch. Omitting it uses portable on the first run and preserves the selected runtime on subsequent runs.

The setup command is available in the development checkout; the earlier `v0.1.0` release does not include it.

## Before running

The adapter detects `nest-cli.json`, the dependency manifest and one lockfile. Its tooling recognizes the standard single-application layout with Jest/Vitest and ESLint/Oxlint, but **admission is restricted to the combinations declared in [compatibility.json](compatibility.json)**. Currently that is Nest 11, Node 22, npm 11, TypeScript 5, Jest 30 and ESLint 9, starting at the exact minimum versions in the manifest. Node 24 is excluded because Sudocode 0.2.0's native SQLite dependency aborts during process cleanup. pnpm, Yarn and Nest 12 are not yet admitted despite the available command-routing code. Workspaces, monorepos, Yarn PnP and custom runner flags require a dedicated adapter or the manual guide.

The check reads installed `node_modules` versions, the running Node version and the package-manager executable. A declared dependency range does not prove which tool is installed. Unknown majors, stable versions below the validated floor and prereleases are refused before writes. Preview can report an otherwise matching stack on an unsupported Node runtime, but an actual installation refuses it before writes. Missing dependencies remain `unverified`; an actual installation requires a fully compatible toolchain. Supported ranges admit updates inside the declared contract, and the real gates still run on each installation. They are not a claim that every possible version combination was measured.

Git and the Sudocode CLI must be installed. Setup checks prerequisites before creating configuration and initializes a missing tracker through `sudocode init`. Existing tracker data and control-store records are retained. No product issues are created.

Inspect the plan without writing or running tools:

```sh
node agent-pipeline/scripts/setup.mjs --dry-run --runtime claude-code
```

## What the command does

1. Detect the adapter and validate existing files for conflicts.
2. Write configuration, tools, invariants, context and an installation decision; extend `.gitignore` with generated output paths.
3. Initialize the tracker if absent and generate the source/test map.
4. Run each declared gate once with live output and a per-step deadline.
5. Record successful preset validation, generate policy, roles and briefs, install hooks and verify generated targets and store invariants.

The default deadline is 120 seconds per step; change it with `--timeout-seconds 60`. Commands stay sequential because build outputs and tests may share resources. On POSIX, timeout and interruption terminate the command's process group. On Windows only direct-child termination is guaranteed.

`pipeline/setup-report.json` records exit codes, durations and the failed step. It is ignored by Git and contains no captured command output. A failed gate returns a nonzero exit and stops installation. Fix the reported problem, then rerun the same command; prerequisites and gates are checked again. No success cache hides changed sources. If the process was forcibly killed, confirm it is stopped before removing `.pipeline-setup.lock`.

Setup preserves application files, package scripts, dependencies and lockfiles. Lint runs without automatic fixes. Existing bootstrap architecture decisions are retained; otherwise the preset records that the existing Nest layout is preserved, without deciding product scope. Existing custom pipeline configuration, agent instructions, hooks and `ci.yml` are conflicts to review, not files to overwrite. An installed adapter fingerprint prevents silently upgrading its tools through an ordinary setup invocation.

## Updating an installed adapter

The adapter has its own `adapter_version`, independent of Nest's version. Its manifest is included in the installation fingerprint. New installations retain `setup-baseline.json` with the original configuration and supplied files, and `setup-targets.json` with generated-policy hashes. Keep these files in version control.

After updating the framework checkout, preview the adapter migration:

```sh
node agent-pipeline/scripts/setup.mjs --update
```

This prints before/after changes to configuration and supplied files, plus the generated targets that will be regenerated. It writes nothing and does not run the application. Independent local changes are retained using a three-way merge against the installed baseline. A field or tool changed differently on both sides is a conflict; arrays are treated as complete choices. Modified generated instructions are refused rather than overwritten.

After reviewing the preview, apply and verify it:

```sh
node agent-pipeline/scripts/setup.mjs --update --apply
```

The command rechecks compatibility, applies the merged inputs, reruns the actual gates and regenerates policy and hooks. A caught failure or handled interruption restores managed installation files and hooks and leaves a failed report with `rolled_back: true`. Application build outputs are not rolled back. An uncatchable process kill or machine crash cannot run the in-memory rollback; recover the tracked installation from Git before retrying. Neither command installs new Nest or tool dependencies.

Ordinary setup remains strict about custom configuration. Use the update path when retaining local adaptations. Moving configured directories or migrating a legacy installation without a baseline requires manual review; setup does not invent the missing original version. Export/import profiles retain their separate manual calibration workflow.

## Continuous compatibility checks

`.github/workflows/adapter-compatibility.yml` derives its reference matrix from the manifest. Pull requests and pushes to `main` run the core suite and, for each supported case, generate an official Nest project, install the pipeline, exercise negative proofs, rerun it and test an adapter migration preserving a local language preference.

Every Monday, and on manual workflow dispatch, an additional job resolves the latest published CLI and tests its fresh scaffold. Admission is temporarily extended to the exact observed versions **only in a disposable framework copy**. The real checks still run, a failure fails the job, and no successful probe automatically edits the released manifest. Its report is explicitly marked `candidate_only`.

Artifacts include actual installed versions, the generated package manifest and lockfile, setup results and migration preview. These distinguish a dependency-resolution change from an adapter defect. The workflow becomes active when this change reaches GitHub; no remote run is claimed by local tests.

To add support, review a successful probe, add a bounded manifest case and its reference versions, record evidence and bump `adapter_version`. Then rerun the supported matrix. Runtime dependencies and their admitted Node ranges are part of the same manifest contract, so a stack case cannot claim a Node range wider than its setup prerequisites. The CI prerequisite installer is separate from host setup and installs the manifest-pinned tracker CLI only on the test runner.

## Fixed policy and actual coverage

The preset supplies executable checks instead of asking an agent to implement them. Production functions have fixed bounds: complexity 12, length 80 lines, 5 parameters, nesting 4. These are policy defaults, never thresholds silently recalculated to make a project pass. Tests are exempt from function-size measurement.

Type checking covers the host TypeScript project, including tests included by its configuration. Unit and HTTP integration tests use the installed runners. Smoke starts the compiled application on a temporary port, requests `/`, requires HTTP 200, then terminates it. A customized application needing credentials, databases, another route or environment configuration must adapt the reviewed profile explicitly.

The map, duplication and static security scan reuse the generic framework tools. Secrets scanning checks tracked and non-ignored untracked text files for private keys and common AWS, GitHub and Slack token shapes, excluding dependencies, compiled output, coverage and the framework itself. It does not detect every credential. Dependency audit includes development dependencies; npm and pnpm fail at high severity, while Yarn Classic fails for any reported severity. Advisory availability depends on the registry.

No coverage threshold, mutation, dead-code, documentation or architecture-semantic enforcement is claimed. Setup does not configure the host project's CI. Role file policies provide detection unless the agent platform actually enforces them.

## Maintaining the adapter

The reviewed preset is checked centrally; setup runs its real commands on each host before clearing `calibration_required`. It does not ask an agent to rewrite tools or manually invent negative examples for every installation. Exported profiles remain subject to the existing manual calibration rule.

In a **disposable** installed Nest host, run the shipped negative proofs:

```sh
node agent-pipeline/profile-bundles/nest/verify.mjs
node agent-pipeline/scripts/setup.mjs --runtime claude-code
```

The verifier adds temporary deliberate defects, asserts nonzero gate exits and removes its probes in `finally`. It exercises type checking, lint, build, unit and integration assertions, all four design bounds, secrets, duplication, stale maps and HTTP status rejection. The second command rebuilds and verifies the healthy host. Dependency advisories and generic core tools also retain their own upstream/core tests; no fake registry result is used as proof.

The standard Nest 12 CLI template uses Vitest and imports `supertest/types` from its HTTP test. The adapter's strict test check now uses TypeScript's bundler resolution for that Vitest test graph, while `nest build` continues to verify the production NodeNext build. With that correction, type checking, lint, build, unit, HTTP integration, smoke, design and static security checks pass. The current scaffold still fails `npm audit --audit-level high` through transitive `tmp` and `undici` advisories from `@nestjs/mau`, so Nest 12 remains outside released support. A generated scaffold is not assumed to pass every check.

## Adding another stack

Add `profile-bundles/<name>/installer.mjs` exporting `detect(root)`, `plan(root, defaults)` and `prerequisites(root, plan)`. `plan` returns a complete `config`, a map of relative file paths to content, and optional `ignored` entries. Adapter-specific inspection data may also travel to its prerequisite function. Keep detection and planning read-only; prerequisites must fail before writes. The current setup lifecycle expects the shared Sudocode tracker configuration and generic apply-profile contract.

Place stack tooling beside the adapter and include its content in `plan.files`. The core discovers shipped adapters, requires exactly one match, handles conflicts, persistence, process supervision and rendering, and never invokes a stack package manager directly. `--profile <name>` selects among shipped compatible adapters. Add fixture tests and an actual generated-host validation before claiming support.
