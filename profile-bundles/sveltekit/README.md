# Reproducible SvelteKit setup

This bundle is an executable setup adapter, like `profile-bundles/nest`, for the
official minimal TypeScript SvelteKit scaffold (ESLint, Prettier, unit Vitest,
Playwright, Node adapter). Run it from the root of such a repository, with its
dependencies installed and the framework at `agent-pipeline/`:

```sh
node agent-pipeline/scripts/setup.mjs
```

Detection reads `package.json` and `svelte.config.js`; `--profile sveltekit`
selects this adapter explicitly when several could match. Use
`--runtime claude-code` for Claude Code role prompts instead of portable
Markdown.

## Before running

Admission is restricted to the combination declared in
[compatibility.json](compatibility.json): the sv@0.17.0 scaffold, Node 22, npm
11 and the listed package ranges, checked against installed `node_modules`
versions — a declared range does not prove which tool is installed. Monorepos,
workspaces, pnpm/Yarn/Bun, a missing root page (`src/routes/+page.svelte`), a
non-`adapter-node` configuration and unrecognized `eslint.config.js` /
`playwright.config.ts` shapes are refused before any write. A scaffold file
whose content already differs from what the adapter installs is kept and
reported, never overwritten; a `package.json` script name the host already uses
for another command is a refusal, not a clobber.

Two prerequisites sit outside the manifest:

- **The design system decision.** A SvelteKit project has screens, and
  `apply-profile` refuses a screens project with no `design_system` block.
  Setup will not invent one: record `design_system` — `{ tokens, primitives,
  direction: { genre, because }, decided_at }` — in `pipeline.bootstrap.json`
  first (`render-design-system.mjs` lays out the decision), then run setup.
  The same record carries the bootstrap architecture (`frontend` or
  `fullstack`).
- **A `gitleaks` binary on PATH** for the `secrets_scan` gate. Its built-in
  rule set was measured inert on 2026-09-10, so the installed `.gitleaks.toml`
  carries explicit AWS/GitHub/PEM/generic rules; re-verify after any upgrade.

Inspect the plan without writing or running tools:

```sh
node agent-pipeline/scripts/setup.mjs --dry-run
```

## What the command does

1. Detect the adapter, validate the layout and the installed toolchain against
   the manifest, refuse conflicts before writes.
2. Check the registry for each declared setup dependency (knip,
   `@axe-core/playwright`): the resolved release must exist, must not be
   deprecated and must admit the running Node.
3. Write configuration, profile, invariants, context and the gate tooling
   (`scripts/smoke.mjs`, `eslint.design-limits.config.js`, `e2e/a11y.e2e.ts`,
   `.gitleaks.toml`, `knip.json`); merge the gate scripts
   (`check:dead-code`, `check:design-limits`, `test:a11y`, `test:smoke`,
   `scan:secrets`) and dev dependencies into `package.json`; add the pipeline
   ignores to `eslint.config.js` and `.prettierignore`; widen the Playwright
   `testMatch` so both `*.e2e.ts` and the scaffold's own `*.test.ts` run.
4. Initialize the tracker if absent, generate the project map, then run each
   declared gate once with live output and a per-step deadline.
5. Replay a negative proof per added gate — an unused file, an unused export
   and an unused dependency for knip; a five-parameter function for
   design-limits; a removed root route for smoke (with a rebuild afterwards);
   an image without alt text for accessibility; a planted token for
   secrets — each isolated, each required to fail, each restored in `finally`.
6. Record successful validation with the detected toolchain, generate policy,
   roles and briefs, install hooks and verify generated targets and store
   invariants.

`pipeline/setup-report.json` records exit codes, durations, the applied host
edits, the kept declarations, the negative proofs and the failed step. It is
ignored by Git. On a rerun, files the host already carries unchanged are listed
as `kept_files` rather than rewritten.

## Failure recovery

A failed gate or proof stops the installation with a nonzero exit; fix the
reported problem and rerun the same command — prerequisites, gates and proofs
are checked again, and no success cache hides changed sources. If the process
was forcibly killed, confirm it is stopped before removing
`.pipeline-setup.lock`. A probe interrupted between planting and restoring can
leave a `pipeline-install-probe*` file or a renamed `+page.svelte` behind;
remove the probe artifact (the name is always `pipeline-install-probe`) before
rerunning.

## What the preset does not do

It does not configure CI, does not decide the product scope, and does not
calibrate `knip.json` beyond the official scaffold — the exclusions it ships
say so in their own comments, and a growing project re-measures them. Secrets
scanning detects the declared token formats, not all secrets. The map, the
duplication gate and the static security scan are heuristic. Widening a
compatibility range requires a fresh official scaffold probe; see
[VALIDATION.md](VALIDATION.md) for the measured evidence.
